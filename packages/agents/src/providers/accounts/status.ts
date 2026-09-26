import type { AgentKind } from '@ruimte/agent-contracts';
import { withTimeout } from '../../async.ts';
import { CodexTransport, type CodexClientInfo } from '../../chat/codex-transport.ts';
import { runProcess } from '../../run-process.ts';

/* A CLI that has not said who is signed in by now is not going to; the next pass asks again. */
const ASK_TIMEOUT_MS = 20_000;

/* Who a CLI says is signed in, from the CLI itself; the daemon never opens a credential. */
export interface AccountReading {
    signedIn: boolean;
    email: string | null;
    plan: string | null;
    organization: string | null;
}

export type AskAccount = (kind: AgentKind, command: readonly string[], env: Record<string, string | undefined>) => Promise<AccountReading>;

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/* `claude auth status --json`, as Claude Code 2.1.282 prints it: `loggedIn`, `email`, `orgName`, `subscriptionType`. */
export const readClaudeAuthStatus = (output: string): AccountReading => {
    let status: unknown;
    try {
        status = JSON.parse(output);
    } catch {
        throw new Error('Claude Code did not say who is signed in');
    }
    if (!isRecord(status) || typeof status.loggedIn !== 'boolean') {
        throw new Error('Claude Code did not say who is signed in');
    }
    return {
        signedIn: status.loggedIn,
        email: text(status.email),
        plan: text(status.subscriptionType),
        organization: text(status.orgName)
    };
};

/*
 * The app-server's `account/read`, as Codex 0.157 answers it: `account` is null while nobody signed in,
 * `{ type: 'chatgpt', email, planType }` for a plan and `{ type: 'apiKey' }` for a key. A model
 * provider without OpenAI's login needs no account at all, which `requiresOpenaiAuth` says.
 */
export const readCodexAccount = (answer: unknown): AccountReading => {
    if (!isRecord(answer)) {
        throw new Error('Codex did not say who is signed in');
    }
    const account = answer.account;
    if (!isRecord(account)) {
        return { signedIn: answer.requiresOpenaiAuth === false, email: null, plan: null, organization: null };
    }
    return { signedIn: true, email: text(account.email), plan: text(account.planType), organization: null };
};

const askClaude = async (command: readonly string[], env: Record<string, string | undefined>): Promise<AccountReading> => {
    const { stdout } = await runProcess([...command, 'auth', 'status', '--json'], {
        env,
        timeoutMs: ASK_TIMEOUT_MS,
        timeoutMessage: 'Claude Code did not answer in time'
    });
    // Signed out exits 1 and still prints the status, so the output decides and the exit code does not.
    return readClaudeAuthStatus(stdout);
};

const askCodex = async (command: readonly string[], env: Record<string, string | undefined>, client: CodexClientInfo): Promise<AccountReading> => {
    const transport = new CodexTransport({
        command: [...command],
        cwd: process.cwd(),
        env: env as Record<string, string>,
        onFrame: () => undefined,
        onExit: () => undefined
    });
    try {
        await withTimeout(
            transport.request('initialize', { clientInfo: client, capabilities: { experimentalApi: true } }),
            ASK_TIMEOUT_MS,
            'Codex did not answer in time'
        );
        transport.notify('initialized', {});
        const answer = await withTimeout(transport.request('account/read', { refreshToken: false }), ASK_TIMEOUT_MS, 'Codex did not answer in time');
        return readCodexAccount(answer);
    } finally {
        transport.end();
        transport.kill();
    }
};

/* Starts the CLI in the account's environment and asks it; only Claude Code and Codex can say. */
export const askAccountAs =
    (client: CodexClientInfo): AskAccount =>
    (kind, command, env) => {
        if (kind === 'claude') {
            return askClaude(command, env);
        }
        if (kind === 'codex') {
            return askCodex(command, env, client);
        }
        return Promise.reject(new Error(`${kind} cannot say who is signed in`));
    };

import { CodedError } from '@adecore/agents';
import { buildTitlePrompt, parseTitle, type ChatTitleInput } from '@adecore/agents/chat';
import { cliExecutable, type ProviderAccountsService } from '@adecore/agents/providers';
import { EditorAssistProviderSchema, type AgentKind, type EditorAssistAgent, type TextModelChoice } from '@ruimte/contracts';
import { assistEnvironment, selectAssistAgent, type AssistProviders, type AssistSelection, type AssistWording } from '../editor-assist/selection.ts';
import { oneShotRun, type TextWriter } from '../git/one-shot.ts';
import { GitError, streamWithTimeout } from '../git/run.ts';

// A title nobody waits for; a CLI this slow is not worth keeping a process around for.
const TITLE_TIMEOUT_MS = 45_000;

const WORDING: AssistWording = {
    chosenUnavailable: 'The text model of this machine is unavailable. Choose another in Settings, Agents, or set it to Automatic.',
    noneAvailable: 'No text model is available on this machine.'
};

interface ShortTextHost extends AssistProviders {
    accounts: AssistProviders['accounts'] & Partial<Pick<ProviderAccountsService, 'launched'>>;
    /* The machine's pick; null is Automatic. */
    choice(): TextModelChoice | null;
    /* Where a CLI runs for a folder, so a checkout that is not to be trusted never lends it its configuration. */
    cwdFor(folder: string): Promise<string>;
    run?: typeof streamWithTimeout;
}

/*
 * The one place the machine's text model is read, for a commit message, a conflict proposal and a chat
 * title. Its pick is held to the same provider, model and account rules as the editor's model, and
 * an explicit pick never falls back on another provider. Automatic leaves each caller's own choice alone.
 */
export class ShortTextModels {
    private readonly host: ShortTextHost;

    constructor(host: ShortTextHost) {
        this.host = host;
    }

    choice(): TextModelChoice | null {
        return this.host.choice();
    }

    /* Generated titles replace the CLIs' own only while the machine has a pick. */
    titlePolicy(): 'native' | 'generated' {
        return this.choice() === null ? 'native' : 'generated';
    }

    /* Throws a `CodedError` when this machine cannot write with the pick now. */
    async validate(choice: TextModelChoice): Promise<void> {
        await this.select(choice);
    }

    /*
     * The writer for the pick, or null under Automatic. A request that names another provider than the
     * pick is refused, since the machine's setting wins over a client's hint.
     */
    async prepare(hint?: AgentKind): Promise<TextWriter | null> {
        const choice = this.choice();

        if (choice === null) {
            return null;
        }

        if (hint !== undefined && hint !== choice.provider) {
            throw new GitError(
                'git-failed',
                `This machine writes short texts with ${this.host.registry.get(choice.provider).name}, which is not ${this.host.registry.get(hint).name}. Reopen the view and try again.`
            );
        }

        try {
            return await this.writerFor(choice);
        } catch (error) {
            throw error instanceof CodedError ? new GitError('git-failed', error.message) : error;
        }
    }

    /*
     * A title from the pick, or whatever `automatic` gives while there is none. A pick that cannot write
     * names nothing, so the title the client derived from the prompt stays.
     */
    async title(input: ChatTitleInput, automatic: () => Promise<string | null>): Promise<string | null> {
        if (this.choice() === null) {
            return await automatic();
        }

        try {
            const writer = await this.prepare();
            const result = await writer?.run(input.cwd, buildTitlePrompt(input.prompt, input.answer), TITLE_TIMEOUT_MS);

            return result !== undefined && result.code === 0 ? parseTitle(result.stdout) : null;
        } catch {
            return null;
        }
    }

    private async select(choice: TextModelChoice): Promise<AssistSelection> {
        const provider = EditorAssistProviderSchema.safeParse(choice.provider);

        if (!provider.success) {
            throw new CodedError('unavailable', WORDING.chosenUnavailable);
        }

        const agent: EditorAssistAgent = { provider: provider.data, model: choice.model, ...(choice.account === undefined ? {} : { account: choice.account }) };

        return await selectAssistAgent(this.host, agent, WORDING);
    }

    private async writerFor(choice: TextModelChoice): Promise<TextWriter> {
        const selection = await this.select(choice);
        const { provider, model, account } = selection;
        const { accounts } = this.host;
        // An account this machine cannot start refuses here, before anything runs under another one.
        const env = assistEnvironment(accounts, selection, process.env);

        return {
            provider,
            run: async (cwd, prompt, timeoutMs, onSpawn) => {
                const run = oneShotRun(provider, prompt, model);

                if (run === null) {
                    throw new GitError('git-failed', `${provider.name} cannot write short texts.`);
                }

                return await (this.host.run ?? streamWithTimeout)(cliExecutable(provider), run.args, await this.host.cwdFor(cwd), timeoutMs, {
                    env,
                    stdin: run.stdin,
                    onSpawn: (kill) => {
                        accounts.launched?.(provider.kind, account);
                        onSpawn?.(kill);
                    }
                });
            }
        };
    }
}

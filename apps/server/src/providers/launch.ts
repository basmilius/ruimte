import { resumeCommandFor, type AgentKind, type AgentLaunch, type RuntimeMode } from '@ruimte/contracts';
import { ANTIGRAVITY_CLI, COPILOT_ALLOW_CONTEXT, GROK_ALLOW_CONTEXT } from './acp-providers.ts';
import { CLAUDE_ALLOW_CONTEXT } from './claude-provider.ts';
import { providerFor } from './registry.ts';

/*
 * The flags each CLI takes for Ruimte's runtime modes, verified against the installed CLIs. A CLI or mode
 * without flags launches bare, which leaves that CLI's own default in place: a missing flag is always the
 * safer of the two mistakes.
 *
 * Codex 0.153 takes only `on-request` and `never` on `--ask-for-approval`, so the three modes that still
 * ask share one policy; the sandbox is what full access widens.
 */
const RUNTIME_FLAGS: Partial<Record<AgentKind, Record<RuntimeMode, string[]>>> = {
    // Supervised names `default`, since a bare launch takes the `defaultMode` from a person's settings, which can be `auto`.
    claude: {
        supervised: ['--permission-mode', 'default'],
        'auto-accept-edits': ['--permission-mode', 'acceptEdits'],
        auto: ['--permission-mode', 'auto'],
        'full-access': ['--permission-mode', 'bypassPermissions']
    },
    codex: {
        supervised: ['--ask-for-approval', 'on-request', '--sandbox', 'workspace-write'],
        'auto-accept-edits': ['--ask-for-approval', 'on-request', '--sandbox', 'workspace-write'],
        auto: ['--ask-for-approval', 'on-request', '--sandbox', 'workspace-write'],
        'full-access': ['--ask-for-approval', 'never', '--sandbox', 'danger-full-access']
    },
    // Grok's own `--permission-mode` values (xai-org/grok-build); `bypassPermissions` is its always-approve.
    grok: {
        supervised: ['--permission-mode', 'default'],
        'auto-accept-edits': ['--permission-mode', 'acceptEdits'],
        auto: ['--permission-mode', 'auto'],
        'full-access': ['--permission-mode', 'bypassPermissions']
    },
    // Antigravity CLI 1.4 has no `--mode` for `auto`, so it shares the narrower accept-edits; plan mode widens nothing.
    antigravity: {
        supervised: [],
        'auto-accept-edits': ['--mode=accept-edits'],
        auto: ['--mode=accept-edits'],
        'full-access': ['--dangerously-skip-permissions']
    }
};

// The executable a terminal of a CLI starts where its provider's command is a chat server instead.
const TERMINAL_EXECUTABLES: Partial<Record<AgentKind, string>> = { antigravity: ANTIGRAVITY_CLI };

/* The executable a terminal of this kind starts. */
export function terminalExecutable(kind: AgentKind): string {
    return TERMINAL_EXECUTABLES[kind] ?? providerFor(kind).command[0]!;
}

// The flag that names a model, for the CLIs whose catalog the client can pick from.
const MODEL_FLAG: Partial<Record<AgentKind, string>> = {
    claude: '--model',
    codex: '--model'
};

// What a terminal agent starts in when nobody said otherwise; the same default a new chat has.
export const DEFAULT_RUNTIME_MODE: RuntimeMode = 'full-access';

/*
 * The widest mode a terminal agent can be running in, as far as the daemon started it: a fresh launch
 * without a mode got the default, while a resume without one and a CLI a person typed into a plain
 * shell run with whatever that CLI decides, which the daemon cannot know and so takes as the strictest.
 */
export function launchedMode(launch: AgentLaunch | null): RuntimeMode {
    if (launch === null) {
        return 'supervised';
    }
    return launch.runtimeMode ?? (launch.resume ? 'supervised' : DEFAULT_RUNTIME_MODE);
}

export function quote(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

/*
 * Codex 0.157 runs a session in a shared background server unless told not to, and that server runs
 * the hooks with the environment of whichever terminal started it: another node's token, or one a
 * restarted daemon no longer knows. An older Codex refuses the flag, so it rides only once `--help` names it.
 */
let codexNoDaemon = false;

// A hanging CLI must not hold its terminal launch indefinitely.
const CODEX_PROBE_TIMEOUT_MS = 5_000;

async function codexHelp(signal: AbortSignal): Promise<string> {
    const proc = Bun.spawn(['codex', '--help'], { stdout: 'pipe', stderr: 'ignore', signal });
    return await new Response(proc.stdout).text();
}

/* Asks the installed Codex once whether it takes `--no-daemon`; a Codex that is not there, or does not answer in time, takes nothing. */
export async function probeCodexNoDaemon(
    help: (signal: AbortSignal) => Promise<string> = codexHelp,
    timeoutMs: number = CODEX_PROBE_TIMEOUT_MS
): Promise<void> {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    process.once('exit', abort);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const timedOut = new Promise<string>((resolve) => controller.signal.addEventListener('abort', () => resolve(''), { once: true }));
    try {
        codexNoDaemon = (await Promise.race([help(controller.signal).catch(() => ''), timedOut])).includes('--no-daemon');
    } finally {
        process.off('exit', abort);
        clearTimeout(timer);
        controller.abort();
    }
}

// The flag that lets `ruimte-context` run without a prompt, for the CLIs that take one on the line.
const ALLOW_CONTEXT: Partial<Record<AgentKind, string>> = {
    claude: CLAUDE_ALLOW_CONTEXT,
    copilot: COPILOT_ALLOW_CONTEXT,
    grok: GROK_ALLOW_CONTEXT
};

// What a CLI gets on every line, fresh or resumed, whatever the mode.
function alwaysFlags(kind: AgentKind): string[] {
    const allow = ALLOW_CONTEXT[kind];
    if (allow !== undefined) {
        return [quote(allow)];
    }
    return kind === 'codex' && codexNoDaemon ? ['--no-daemon'] : [];
}

/*
 * How a CLI is told about `ruimte-context` on its launch line, where it takes one: a note there sits with the
 * session's instructions rather than in the conversation, and its `SessionStart` hook leaves it out. Codex parses a
 * `-c` value as TOML, and a JSON string is a valid TOML basic string. Only a fresh launch carries it:
 * Codex 0.154 ignores developer instructions on a resume (measured) and keeps those the session started with.
 */
const NOTE_FLAGS: Partial<Record<AgentKind, (note: string) => string[]>> = {
    codex: (note) => ['-c', quote(`developer_instructions=${JSON.stringify(note)}`)]
};

/* Whether a launch line of this kind carries the verbs note, so a hook must not say it a second time. */
export function takesNoteOnLine(kind: AgentKind): boolean {
    return NOTE_FLAGS[kind] !== undefined;
}

/*
 * What a launch puts on a CLI's line beside the command itself: the permission mode and, where the
 * CLI takes one, the model. A launch that names no mode gets no mode flag; only a fresh launch fills
 * that gap with `DEFAULT_RUNTIME_MODE`, because a resume of a CLI nobody chose a mode for would
 * otherwise be handed full access.
 */
function launchFlags(launch: AgentLaunch, runtimeMode: RuntimeMode | undefined): string[] {
    const flags = [...alwaysFlags(launch.kind), ...(runtimeMode === undefined ? [] : (RUNTIME_FLAGS[launch.kind]?.[runtimeMode] ?? []))];
    const modelFlag = MODEL_FLAG[launch.kind];
    if (launch.model && modelFlag) {
        flags.push(modelFlag, quote(launch.model));
    }
    return flags;
}

/*
 * Put the first prompt on the launch command because CLIs expose no reliable ready-for-input signal.
 * Building the line in the daemon also keeps flags out of the wire protocol.
 */
export function terminalCommand(launch: AgentLaunch, firstPrompt?: string, note?: string): string {
    const provider = providerFor(launch.kind);
    if (!provider.capabilities.terminal) {
        throw new Error(`${provider.name} is only available as a chat.`);
    }
    if (launch.resume) {
        return resumeCommand(launch, launch.resume);
    }
    // Only the executable: the arguments on a provider are the ones its chat backend needs.
    const parts = [terminalExecutable(launch.kind), ...launchFlags(launch, launch.runtimeMode ?? DEFAULT_RUNTIME_MODE)];
    const noteFlags = NOTE_FLAGS[launch.kind];
    if (note && noteFlags) {
        parts.push(...noteFlags(note));
    }
    if (firstPrompt) {
        parts.push(...provider.firstPromptArgs(firstPrompt).map(quote));
    }
    return parts.join(' ');
}

/*
 * How each CLI is told to pick its session up again; the template is the provider's own. The mode
 * and the model ride along, so a node comes back the way it was started whether its CLI resumes or
 * starts fresh. Claude Code 2.1.270 reads both out of the transcript it resumes (measured), and is
 * then told the same thing twice; Codex takes its sandbox and its approval policy from the line
 * alone, so without this a `full-access` node would come back sandboxed.
 */
export function resumeCommand(launch: AgentLaunch, agentSessionId: string): string {
    return resumeCommandFor(providerFor(launch.kind).resumeCommand, agentSessionId, launchFlags(launch, launch.runtimeMode));
}

/* The line a CLI starts fresh with, whatever the launch it was recorded with asked to resume. */
export function freshCommand(launch: AgentLaunch, note?: string): string {
    return terminalCommand({ ...launch, resume: undefined }, undefined, note);
}

/*
 * A resume the daemon has no evidence for, in one line. The CLI exits non-zero when the session it
 * was handed is not there, so the shell then starts a fresh one itself.
 */
export function resumeOrFreshCommand(launch: AgentLaunch, agentSessionId: string, note?: string): string {
    return `${resumeCommand(launch, agentSessionId)} || ${freshCommand(launch, note)}`;
}

import { resumeCommandFor, type AgentKind, type AgentLaunch, type RuntimeMode } from '@ruimte/contracts';
import { CLAUDE_ALLOW_CONTEXT } from './claude-provider.ts';
import { providerFor } from './registry.ts';

/*
 * The flags each CLI takes for Ruimte's runtime modes, verified against the installed CLIs where
 * there is one on this machine. A mode a CLI has no flag for launches bare, which leaves that
 * CLI's own default in place: a missing flag is always the safer of the two mistakes.
 *
 * Codex 0.153 takes only `on-request` and `never` on `--ask-for-approval`, so the three modes that
 * still ask share one policy and differ in nothing; the sandbox is what full access widens.
 */
const RUNTIME_FLAGS: Record<AgentKind, Record<RuntimeMode, string[]>> = {
    apple: { supervised: [], 'auto-accept-edits': [], auto: [], 'full-access': [] },
    claude: {
        supervised: [],
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
    gemini: {
        supervised: [],
        'auto-accept-edits': ['--approval-mode', 'auto_edit'],
        auto: [],
        'full-access': ['--approval-mode', 'yolo']
    },
    copilot: {
        supervised: [],
        'auto-accept-edits': [],
        auto: [],
        'full-access': []
    }
};

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
export const launchedMode = (launch: AgentLaunch | null): RuntimeMode => {
    if (launch === null) {
        return 'supervised';
    }
    return launch.runtimeMode ?? (launch.resume ? 'supervised' : DEFAULT_RUNTIME_MODE);
};

const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/*
 * Codex 0.157 runs a session in a shared background server unless told not to, and that server runs
 * the hooks with the environment of whichever terminal started it: another node's token, or one a
 * restarted daemon no longer knows. An older Codex refuses the flag, so it rides only once `--help` names it.
 */
let codexNoDaemon = false;

const codexHelp = async (): Promise<string> => {
    const proc = Bun.spawn(['codex', '--help'], { stdout: 'pipe', stderr: 'ignore' });
    return await new Response(proc.stdout).text();
};

/* Asks the installed Codex once whether it takes `--no-daemon`; a Codex that is not there takes nothing. */
export const probeCodexNoDaemon = async (help: () => Promise<string> = codexHelp): Promise<void> => {
    codexNoDaemon = (await help().catch(() => '')).includes('--no-daemon');
};

// What a CLI gets on every line, fresh or resumed, whatever the mode.
const alwaysFlags = (kind: AgentKind): string[] => {
    if (kind === 'claude') {
        return [quote(CLAUDE_ALLOW_CONTEXT)];
    }
    return kind === 'codex' && codexNoDaemon ? ['--no-daemon'] : [];
};

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
export const takesNoteOnLine = (kind: AgentKind): boolean => NOTE_FLAGS[kind] !== undefined;

/*
 * What a launch puts on a CLI's line beside the command itself: the permission mode and, where the
 * CLI takes one, the model. A launch that names no mode gets no mode flag; only a fresh launch fills
 * that gap with `DEFAULT_RUNTIME_MODE`, because a resume of a CLI nobody chose a mode for would
 * otherwise be handed full access.
 */
const launchFlags = (launch: AgentLaunch, runtimeMode: RuntimeMode | undefined): string[] => {
    const flags = [...alwaysFlags(launch.kind), ...(runtimeMode === undefined ? [] : RUNTIME_FLAGS[launch.kind][runtimeMode])];
    const modelFlag = MODEL_FLAG[launch.kind];
    if (launch.model && modelFlag) {
        flags.push(modelFlag, quote(launch.model));
    }
    return flags;
};

/*
 * Put the first prompt on the launch command because CLIs expose no reliable ready-for-input signal.
 * Building the line in the daemon also keeps flags out of the wire protocol.
 */
export const terminalCommand = (launch: AgentLaunch, firstPrompt?: string, note?: string): string => {
    const provider = providerFor(launch.kind);
    if (!provider.capabilities.terminal) {
        throw new Error(`${provider.name} is only available as a chat.`);
    }
    if (launch.resume) {
        return resumeCommandFor(provider.resumeCommand, launch.resume, launchFlags(launch, launch.runtimeMode));
    }
    // Only the executable: the arguments on a provider are the ones its chat backend needs.
    const parts = [provider.command[0]!, ...launchFlags(launch, launch.runtimeMode ?? DEFAULT_RUNTIME_MODE)];
    const noteFlags = NOTE_FLAGS[launch.kind];
    if (note && noteFlags) {
        parts.push(...noteFlags(note));
    }
    if (firstPrompt) {
        parts.push(...provider.firstPromptArgs(firstPrompt).map(quote));
    }
    return parts.join(' ');
};

/*
 * How each CLI is told to pick its session up again; the template is the provider's own. The mode
 * and the model ride along, so a node comes back the way it was started whether its CLI resumes or
 * starts fresh. Claude Code 2.1.270 reads both out of the transcript it resumes (measured), and is
 * then told the same thing twice; Codex takes its sandbox and its approval policy from the line
 * alone, so without this a `full-access` node would come back sandboxed.
 */
export const resumeCommand = (launch: AgentLaunch, agentSessionId: string): string =>
    resumeCommandFor(providerFor(launch.kind).resumeCommand, agentSessionId, launchFlags(launch, launch.runtimeMode));

/* The line a CLI starts fresh with, whatever the launch it was recorded with asked to resume. */
export const freshCommand = (launch: AgentLaunch, note?: string): string => terminalCommand({ ...launch, resume: undefined }, undefined, note);

/*
 * A resume the daemon has no evidence for, in one line. The CLI exits non-zero when the session it
 * was handed is not there, so the shell starts a fresh one itself: the node ends up with its CLI
 * either way and the shell still reads a single line, which is what typing two of them cost before.
 */
export const resumeOrFreshCommand = (launch: AgentLaunch, agentSessionId: string, note?: string): string =>
    `${resumeCommand(launch, agentSessionId)} || ${freshCommand(launch, note)}`;

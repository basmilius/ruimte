import { resumeCommandFor, type AgentKind, type AgentLaunch, type RuntimeMode } from '@ruimte/contracts';
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
const DEFAULT_RUNTIME_MODE: RuntimeMode = 'full-access';

const quote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/*
 * What a launch puts on a CLI's line beside the command itself: the permission mode and, where the
 * CLI takes one, the model. A launch that names no mode gets no mode flag; only a fresh launch fills
 * that gap with `DEFAULT_RUNTIME_MODE`, because a resume of a CLI nobody chose a mode for would
 * otherwise be handed full access.
 */
const launchFlags = (launch: AgentLaunch, runtimeMode: RuntimeMode | undefined): string[] => {
    const flags = runtimeMode === undefined ? [] : [...RUNTIME_FLAGS[launch.kind][runtimeMode]];
    const modelFlag = MODEL_FLAG[launch.kind];
    if (launch.model && modelFlag) {
        flags.push(modelFlag, quote(launch.model));
    }
    return flags;
};

/*
 * The line a terminal types to start one agent CLI. The daemon builds it, so every client (and a
 * node restored from a project file) launches a CLI the same way and a flag never travels the wire.
 *
 * A first prompt rides on that same line as the CLI's own prompt argument, rather than being typed
 * into the CLI once it is up: nobody can tell when a CLI is ready for input, and the line is built
 * here at `session.create`, so a node made on a daemon that restarts before any client mounts it
 * still starts on its prompt. It also means the person sees the prompt in the shell, as a line they
 * could have typed themselves.
 */
export const terminalCommand = (launch: AgentLaunch, firstPrompt?: string): string => {
    const provider = providerFor(launch.kind);
    if (launch.resume) {
        return resumeCommandFor(provider.resumeCommand, launch.resume, launchFlags(launch, launch.runtimeMode));
    }
    // Only the executable: the arguments on a provider are the ones its chat backend needs.
    const parts = [provider.command[0]!, ...launchFlags(launch, launch.runtimeMode ?? DEFAULT_RUNTIME_MODE)];
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
export const freshCommand = (launch: AgentLaunch): string => terminalCommand({ ...launch, resume: undefined });

/*
 * A resume the daemon has no evidence for, in one line. The CLI exits non-zero when the session it
 * was handed is not there, so the shell starts a fresh one itself: the node ends up with its CLI
 * either way and the shell still reads a single line, which is what typing two of them cost before.
 */
export const resumeOrFreshCommand = (launch: AgentLaunch, agentSessionId: string): string =>
    `${resumeCommand(launch, agentSessionId)} || ${freshCommand(launch)}`;

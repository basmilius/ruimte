import type { ModelSelection, ProviderCapabilities, RuntimeMode } from '@ruimte/contracts';

// Base arguments for a chat process; the session adds what the selection and the modes ask for.
const CLAUDE_CHAT_ARGS = [
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompt-tool',
    'stdio'
];

// Effort values the CLI takes on its flag; anything else is asked for in the prompt instead.
const FLAG_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

const PERMISSION_MODE: Record<RuntimeMode, string | null> = {
    supervised: null,
    'auto-accept-edits': 'acceptEdits',
    auto: 'auto',
    'full-access': 'bypassPermissions'
};

interface ClaudeLaunch {
    selection: ModelSelection;
    runtimeMode: RuntimeMode;
    resume: string | null;
}

/* The argument list for one Claude Code chat process. */
export const claudeArgs = (launch: ClaudeLaunch): string[] => {
    const args = [...CLAUDE_CHAT_ARGS];
    const contextWindow = launch.selection.options.contextWindow;
    args.push('--model', `${launch.selection.model}${contextWindow === '1m' ? '[1m]' : ''}`);
    const effort = launch.selection.options.effort;
    if (typeof effort === 'string' && FLAG_EFFORTS.has(effort)) {
        args.push('--effort', effort);
    }
    /*
     * Fast mode has no flag of its own; the CLI reads it from the settings blob, which is also the
     * opt-in the init frame asks for (without it the frame answers `sdk_opt_in_required`). It only
     * takes on a model that offers it, so the catalog puts the option on those models alone.
     */
    if (launch.selection.options.fastMode === true) {
        args.push('--settings', JSON.stringify({ fastMode: true }));
    }
    const permissionMode = PERMISSION_MODE[launch.runtimeMode];
    if (permissionMode) {
        args.push('--permission-mode', permissionMode);
    }
    if (permissionMode === 'bypassPermissions') {
        args.push('--allow-dangerously-skip-permissions');
    }
    if (launch.resume) {
        args.push('--resume', launch.resume);
    }
    return args;
};

// What the CLI can do, as far as a client has to know.
export const CLAUDE_CAPABILITIES: ProviderCapabilities = {
    chat: true,
    terminal: true,
    hooks: true,
    streamsToolOutput: false,
    diffs: 'before-after',
    attachments: true,
    mentions: true,
    denyReason: true,
    allowAlways: true,
    asyncQuestions: false,
    compaction: 'prompt',
    reportsCost: true,
    reportsContextWindow: true,
    reportsThinking: true,
    slashCommands: true
};

// Claude Code takes its flags before `--resume`, which takes the id.
export const CLAUDE_RESUME_COMMAND = 'claude {flags} --resume {id}';

/* Words the model reads as instructions, prepended to the prompt for options the CLI has no flag for. */
export const promptPrefix = (selection: ModelSelection): string => (selection.options.effort === 'ultrathink' ? 'ultrathink\n\n' : '');

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

/*
 * Lets every `ruimte-context` call through without a prompt, in every mode: the daemon already enforces each
 * verb (mode ceiling, depth, cwd), so a prompt adds no protection. The `=` form matters, since the flag is
 * variadic and would swallow a prompt argument after it (measured on Claude Code 2.1.274).
 */
export const CLAUDE_ALLOW_CONTEXT = '--allowedTools=Bash(ruimte-context *)';

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
    const args = [...CLAUDE_CHAT_ARGS, CLAUDE_ALLOW_CONTEXT];
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

/*
 * Leaving out `[1m]` does not cap a model the CLI runs natively on 1M on a subscription (Fable,
 * Opus 5.5, Sonnet 5), and `autoCompactWindow` in `--settings` is ignored under `-p`: only this
 * variable holds a 200k pick (measured on Claude Code 2.1.280).
 */
export const claudeEnv = (selection: ModelSelection): Record<string, string> =>
    selection.options.contextWindow === '200k' ? { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '200000' } : {};

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
    /*
     * The CLI's `modelUsage.contextWindow` is the model's maximum, not the window a 200k pick compacts at:
     * a run started without `[1m]` reports 1000000 too (measured on Claude Code 2.1.274). The catalog
     * knows what the pick asked for, so the meter reads that and nothing here reports a window.
     */
    reportsContextWindow: false,
    reportsThinking: true,
    slashCommands: true
};

// Claude Code takes its flags before `--resume`, which takes the id.
export const CLAUDE_RESUME_COMMAND = 'claude {flags} --resume {id}';

/* Words the model reads as instructions, prepended to the prompt for options the CLI has no flag for. */
export const promptPrefix = (selection: ModelSelection): string => (selection.options.effort === 'ultrathink' ? 'ultrathink\n\n' : '');

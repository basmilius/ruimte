import type { InteractionMode, ProviderCapabilities, RuntimeMode } from '@ruimte/contracts';

// The app-server speaks JSON-RPC on stdio; the session adds nothing to the command line.
export const CODEX_CHAT_ARGS = ['app-server'];

export type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never';
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface CodexThreadOptions {
    approvalPolicy: CodexApprovalPolicy;
    sandbox: CodexSandboxMode;
}

/*
 * Codex has two knobs, when it asks and where it may write, and no "ask for commands but not for
 * edits" policy. `untrusted` inside a writable workspace comes closest: edits within the workspace
 * pass the sandbox without a prompt, commands still ask unless Codex knows them as safe.
 * `on-request` with the same sandbox is Codex's own default and stands in for `auto`.
 */
const THREAD_OPTIONS: Record<RuntimeMode, CodexThreadOptions> = {
    supervised: { approvalPolicy: 'untrusted', sandbox: 'read-only' },
    'auto-accept-edits': { approvalPolicy: 'untrusted', sandbox: 'workspace-write' },
    auto: { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
    'full-access': { approvalPolicy: 'never', sandbox: 'danger-full-access' }
};

/*
 * Plan mode is not settable over the app-server protocol of 0.153 (the collaboration mode is only
 * reported, never taken), so it is a read-only sandbox plus the instruction in `codexPromptPrefix`.
 */
export const codexThreadOptions = (runtimeMode: RuntimeMode, interactionMode: InteractionMode): CodexThreadOptions => {
    const options = THREAD_OPTIONS[runtimeMode];
    return interactionMode === 'plan' ? { ...options, sandbox: 'read-only' } : options;
};

export const codexPromptPrefix = (interactionMode: InteractionMode): string =>
    interactionMode === 'plan'
        ? 'Plan mode: do not change files or run commands that change state. Investigate, then answer with a plan for me to approve.\n\n'
        : '';

// What the app-server can do, as far as a client has to know.
export const CODEX_CAPABILITIES: ProviderCapabilities = {
    streamsToolOutput: true,
    diffs: 'unified',
    attachments: false,
    mentions: false,
    denyReason: false,
    allowAlways: true,
    asyncQuestions: true,
    compaction: 'native',
    planMode: 'prompt',
    reportsCost: false,
    reportsContextWindow: true,
    slashCommands: false
};

export const CODEX_RESUME_COMMAND = 'codex resume {id}';

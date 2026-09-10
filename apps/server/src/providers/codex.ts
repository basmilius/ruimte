import type { ProviderCapabilities, RuntimeMode } from '@ruimte/contracts';

// The app-server speaks JSON-RPC on stdio; the session adds nothing to the command line.
export const CODEX_CHAT_ARGS = ['app-server'];

type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never';
type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

interface CodexThreadOptions {
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

export const codexThreadOptions = (runtimeMode: RuntimeMode): CodexThreadOptions => THREAD_OPTIONS[runtimeMode];

// What the app-server can do, as far as a client has to know.
export const CODEX_CAPABILITIES: ProviderCapabilities = {
    chat: true,
    terminal: true,
    hooks: true,
    streamsToolOutput: true,
    diffs: 'unified',
    attachments: false,
    mentions: false,
    denyReason: false,
    allowAlways: true,
    asyncQuestions: true,
    compaction: 'native',
    reportsCost: false,
    reportsContextWindow: true,
    slashCommands: false
};

export const CODEX_RESUME_COMMAND = 'codex resume {id}';

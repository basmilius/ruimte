import type { AgentKind, AgentStatus, RuntimeMode } from '@ruimte/contracts';

interface HookOutcome {
    agentSessionId: string;
    transcriptPath: string | null;
    // Null means the agent has left the shell.
    status: AgentStatus | null;
    // The CLI's own name for its permission mode, on the events that carry one.
    permissionMode: string | null;
}

// What each hook event means for the person watching the node. Claude Code and Codex share the
// event names, so one table serves both; the few events only one of them fires are harmless for the other.
const EVENT_STATUS: Record<string, AgentStatus | 'gone'> = {
    SessionStart: 'idle',
    UserPromptSubmit: 'running',
    PreToolUse: 'running',
    PostToolUse: 'running',
    PostToolUseFailure: 'running',
    PostToolBatch: 'running',
    PermissionRequest: 'needs-you',
    PermissionDenied: 'running',
    Elicitation: 'needs-you',
    ElicitationResult: 'running',
    SubagentStart: 'running',
    SubagentStop: 'running',
    PreCompact: 'running',
    PostCompact: 'running',
    Stop: 'idle',
    StopFailure: 'error',
    Interrupt: 'idle',
    SessionEnd: 'gone'
};

// Tools that stop and wait for the person, even though they arrive as a plain tool call.
const ASKING_TOOLS = new Set(['AskUserQuestion']);

// Notification types that mean the CLI is blocked on the person; the others are informational.
const NOTIFICATION_STATUS: Record<string, AgentStatus> = {
    permission_prompt: 'needs-you',
    elicitation_dialog: 'needs-you',
    idle_prompt: 'idle'
};

const asString = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

// Events to install a hook for; the receiver ignores anything else, so an extra event costs nothing but a POST.
// A kind without an entry has no normalizer yet: it launches in a terminal and reports no agent status.
export const HOOK_EVENTS: Partial<Record<AgentKind, string[]>> = {
    claude: [
        'SessionStart',
        'UserPromptSubmit',
        'PreToolUse',
        'PostToolUse',
        'PostToolUseFailure',
        'PermissionRequest',
        'Notification',
        'Elicitation',
        'ElicitationResult',
        'SubagentStop',
        'Stop',
        'StopFailure',
        'SessionEnd'
    ],
    codex: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'SubagentStop', 'Stop', 'Interrupt', 'SessionEnd']
};

/* Whether the daemon understands this CLI's hooks at all; the receiver turns the others away. */
export const hasHooks = (kind: AgentKind): boolean => HOOK_EVENTS[kind] !== undefined;

/*
 * Whether a hook's answer reaches this CLI's model. Claude Code and Codex 0.154 both fold
 * `hookSpecificOutput.additionalContext` on `SessionStart` and `UserPromptSubmit` into the turn
 * (Codex as a developer message, measured); any other CLI's hooks are one way, so anything meant
 * for the agent itself has to go on the screen instead of waiting for a turn that cannot carry it.
 */
export const takesHookContext = (kind: AgentKind): boolean => kind === 'claude' || kind === 'codex';

/* Turns one hook payload into a status; null when the payload says nothing about status or is not a hook at all. */
export const normalizeHook = (body: unknown): HookOutcome | null => {
    if (typeof body !== 'object' || body === null) {
        return null;
    }
    const hook = body as Record<string, unknown>;
    const agentSessionId = asString(hook.session_id);
    const event = asString(hook.hook_event_name);
    if (!agentSessionId || !event) {
        return null;
    }
    const transcriptPath = asString(hook.transcript_path);

    let status: AgentStatus | 'gone' | undefined;
    if (event === 'Notification') {
        status = NOTIFICATION_STATUS[asString(hook.notification_type) ?? ''];
    } else if (event === 'PreToolUse' && ASKING_TOOLS.has(asString(hook.tool_name) ?? '')) {
        status = 'needs-you';
    } else {
        status = EVENT_STATUS[event];
    }
    if (status === undefined) {
        return null;
    }
    return { agentSessionId, transcriptPath, status: status === 'gone' ? null : status, permissionMode: asString(hook.permission_mode) };
};

/*
 * Claude Code 2.1.273 names its modes on `UserPromptSubmit`, `Stop` and the tool events (measured; not
 * on `SessionStart`). `plan` and `dontAsk` both leave the person every decision a tool asks for, so
 * they are as narrow as `default`.
 */
const PERMISSION_MODES: Record<string, RuntimeMode> = {
    default: 'supervised',
    plan: 'supervised',
    dontAsk: 'supervised',
    acceptEdits: 'auto-accept-edits',
    auto: 'auto',
    bypassPermissions: 'full-access'
};

/*
 * The mode a terminal agent runs in by what its hook reported, null when the hook named none. A name
 * this table does not know counts as the strictest. Codex 0.154 reports only `default` or
 * `bypassPermissions` (measured), and launches every asking mode with the same flags, so its
 * `default` cannot tell those apart: the mode it was launched in stands, unless that was full access.
 */
export const modeOfHook = (kind: AgentKind, permissionMode: string | null, launched: RuntimeMode): RuntimeMode | null => {
    if (permissionMode === null) {
        return null;
    }
    if (kind === 'codex' && permissionMode === 'default') {
        return launched === 'full-access' ? 'supervised' : launched;
    }
    return PERMISSION_MODES[permissionMode] ?? 'supervised';
};

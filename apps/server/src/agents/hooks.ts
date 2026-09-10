import type { AgentKind, AgentStatus } from '@ruimte/contracts';

interface HookOutcome {
    agentSessionId: string;
    transcriptPath: string | null;
    // Null means the agent has left the shell.
    status: AgentStatus | null;
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
    return { agentSessionId, transcriptPath, status: status === 'gone' ? null : status };
};

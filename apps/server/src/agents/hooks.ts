import type { AgentKind, AgentRequest, AgentStatus, RuntimeMode } from '@ruimte/contracts';

interface HookOutcome {
    agentSessionId: string;
    transcriptPath: string | null;
    // Null means the agent has left the shell; `unchanged` says nothing about the agent the person talks to.
    status: AgentStatus | 'unchanged' | null;
    // The CLI's own name for its permission mode, on the events that carry one.
    permissionMode: string | null;
    event: string;
    // The subagent the hook fired in, null for the agent the person talks to.
    subagentId: string | null;
}

// What each hook event means for the person watching the node. Claude Code, Codex, Grok and Copilot share the
// event names, so one table serves them all; the few events only one of them fires are harmless for the others.
const EVENT_STATUS: Record<string, AgentStatus | 'unchanged' | 'gone'> = {
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
    // Claude Code 2.1.296 also fires it for the recap it writes on its own after a finished turn.
    SubagentStop: 'unchanged',
    PreCompact: 'running',
    PostCompact: 'running',
    Stop: 'idle',
    StopFailure: 'error',
    // Grok's turn that ended without completing: an interrupt, a declined prompt, a limit on turns.
    StopCancelled: 'idle',
    Interrupt: 'idle',
    SessionEnd: 'gone'
};

// Tools that stop and wait for the person, even though they arrive as a plain tool call.
const ASKING_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion', 'request_user_input']);

function optionLabel(option: unknown): string | null {
    if (typeof option === 'string') {
        return option;
    }
    return typeof option === 'object' && option !== null ? asString((option as Record<string, unknown>).label) : null;
}

/* The questions of an asking tool as text: each question with its options under it as bullets. */
function questionsText(questions: unknown): string {
    if (!Array.isArray(questions)) {
        return '';
    }
    return questions
        .map((entry: unknown) => {
            if (typeof entry !== 'object' || entry === null) {
                return '';
            }
            const item = entry as Record<string, unknown>;
            const options = Array.isArray(item.options) ? item.options.map(optionLabel).filter(Boolean) : [];
            return [asString(item.question) ?? asString(item.title), ...options.map((option) => `• ${option}`)].filter(Boolean).join('\n');
        })
        .filter(Boolean)
        .join('\n\n');
}

export function requestOfHook(body: unknown, createdAt: number): AgentRequest | null {
    if (typeof body !== 'object' || body === null) {
        return null;
    }
    const hook = body as Record<string, unknown>;
    const toolName = asString(hook.tool_name);
    // In bypass Claude Code still asks for an asking tool's permission after its PreToolUse, and that request takes the question's place.
    const question = (hook.hook_event_name === 'PreToolUse' || hook.hook_event_name === 'PermissionRequest') && toolName !== null && ASKING_TOOLS.has(toolName);
    if (!toolName || (!question && hook.hook_event_name !== 'PermissionRequest')) {
        return null;
    }
    const input = typeof hook.tool_input === 'object' && hook.tool_input !== null ? (hook.tool_input as Record<string, unknown>) : {};
    const text = question ? questionsText(input.questions) : (asString(input.command) ?? JSON.stringify(input, null, 2));
    const source = asString(hook.agent_id) ?? '';
    return {
        id: `${source}:${asString(hook.tool_use_id) ?? asString(hook.turn_id) ?? String(hook.hook_event_name)}:${toolName}`,
        source,
        kind: question ? 'question' : 'approval',
        toolName,
        title: asString(input.description),
        text: text.slice(0, 16_000),
        createdAt
    };
}

// Notification types that mean the CLI is blocked on the person; the others are informational.
const NOTIFICATION_STATUS: Record<string, AgentStatus> = {
    permission_prompt: 'needs-you',
    elicitation_dialog: 'needs-you',
    idle_prompt: 'idle',
    // Copilot's.
    agent_idle: 'idle'
};

/* A field a CLI wrote in its hook payload; an empty one says as little as a missing one. */
function asString(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

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
    codex: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'SubagentStop', 'Stop', 'Interrupt', 'SessionEnd'],
    // Grok 1.0.62 asks for a permission through `Notification` only (`~/.grok/docs/user-guide/10-hooks.md`).
    grok: [
        'SessionStart',
        'UserPromptSubmit',
        'PreToolUse',
        'PostToolUse',
        'PostToolUseFailure',
        'Notification',
        'SubagentStop',
        'Stop',
        'StopFailure',
        'StopCancelled',
        'SessionEnd'
    ],
    // Copilot sends a Claude Code payload (snake_case, `hook_event_name`) only to an event named in PascalCase.
    copilot: [
        'SessionStart',
        'UserPromptSubmit',
        'PreToolUse',
        'PostToolUse',
        'PostToolUseFailure',
        'PermissionRequest',
        'Notification',
        'SubagentStop',
        'Stop',
        'SessionEnd'
    ],
    // Antigravity's CLI has no event for a permission or a prompt, and names neither the event nor the session the Claude Code way.
    antigravity: ['Stop']
};

/* Whether the daemon understands this CLI's hooks at all; the receiver turns the others away. */
export function hasHooks(kind: AgentKind): boolean {
    return HOOK_EVENTS[kind] !== undefined;
}

/*
 * Whether a hook's answer reaches this CLI's model. Claude Code and Codex 0.154 both fold
 * `hookSpecificOutput.additionalContext` on `SessionStart` and `UserPromptSubmit` into the turn
 * (Codex as a developer message, measured); any other CLI's hooks are one way, so anything meant
 * for the agent itself has to go on the screen instead of waiting for a turn that cannot carry it.
 */
export function takesHookContext(kind: AgentKind): boolean {
    return kind === 'claude' || kind === 'codex';
}

/*
 * Antigravity sends only the hook it was given (`Stop`), camelCase and without the event's name
 * (antigravity.google/docs/hooks): its `conversationId` is the session that `agy --conversation` resumes.
 */
function antigravityHook(hook: Record<string, unknown>): Record<string, unknown> {
    return { session_id: hook.conversationId, transcript_path: hook.transcriptPath, hook_event_name: 'Stop' };
}

/* Turns one hook payload into a status; null when the payload says nothing about status or is not a hook at all. */
export function normalizeHook(body: unknown, kind: AgentKind = 'claude'): HookOutcome | null {
    if (typeof body !== 'object' || body === null) {
        return null;
    }
    const hook = kind === 'antigravity' ? antigravityHook(body as Record<string, unknown>) : (body as Record<string, unknown>);
    const agentSessionId = asString(hook.session_id);
    const event = asString(hook.hook_event_name);
    if (!agentSessionId || !event) {
        return null;
    }
    const transcriptPath = asString(hook.transcript_path);
    // Claude Code 2.1.282 and Codex 0.157 name the subagent on every hook fired inside one, under the parent's session id (measured);
    // Grok 1.0.62 runs a subagent's hooks in a session of its own and names only its type.
    const subagentId = asString(hook.agent_id) ?? asString(hook.subagentType);

    let status: AgentStatus | 'unchanged' | 'gone' | undefined;
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
    if (status === 'gone') {
        // A subagent's session that ends leaves the agent the person talks to running.
        status = subagentId === null ? 'gone' : 'unchanged';
    }
    return {
        agentSessionId,
        transcriptPath,
        status: status === 'gone' ? null : status,
        permissionMode: asString(hook.permission_mode),
        event,
        subagentId
    };
}

/*
 * Grok and Copilot also run the hooks in Claude Code's settings, so Ruimte's own Claude hook fires inside them
 * and posts to `/hooks/claude`. Such a hook speaks for that CLI, which reports through hooks of its own, and never
 * for Claude Code. Grok's payload says so itself: beside Claude's `hook_event_name` it carries `hookEventName`,
 * which Claude Code never sends (`~/.grok/docs/user-guide/10-hooks.md`). Copilot's reads like Claude's, so it is
 * known by its session, once Copilot's own hook named that session for its kind.
 */
export function borrowedHook(kind: AgentKind, body: unknown, current: { kind: AgentKind; agentSessionId: string } | null): boolean {
    if (kind !== 'claude' || typeof body !== 'object' || body === null) {
        return false;
    }
    const hook = body as Record<string, unknown>;
    if (hook.hookEventName !== undefined) {
        return true;
    }
    return current !== null && current.kind !== 'claude' && current.agentSessionId === asString(hook.session_id);
}

// The agent the person talks to, as a key beside the subagents' ids.
const MAIN_AGENT = '';

// Events of the main agent after which nothing on screen still waits: a new or ended conversation, a prompt the person typed, Escape.
const SETTLING_EVENTS: ReadonlySet<string> = new Set(['SessionStart', 'UserPromptSubmit', 'Interrupt', 'SessionEnd']);

/*
 * The status a hook leaves, given who was still waiting on the person before it and the status it
 * found. A hook only settles a wait of its own agent: a background subagent working on does not
 * answer the question the main agent asked, and the main agent's tools do not answer a subagent's approval.
 */
export function settleWaiting(
    waiting: ReadonlySet<string>,
    outcome: HookOutcome,
    previous: AgentStatus | null
): { waiting: Set<string>; status: AgentStatus | null } {
    const source = outcome.subagentId ?? MAIN_AGENT;
    const next = new Set(source === MAIN_AGENT && SETTLING_EVENTS.has(outcome.event) ? [] : waiting);
    if (outcome.status === 'needs-you') {
        next.add(source);
    } else {
        next.delete(source);
    }
    if (outcome.status === null) {
        return { waiting: new Set(), status: null };
    }
    if (next.size > 0) {
        return { waiting: next, status: 'needs-you' };
    }
    if (outcome.status !== 'unchanged') {
        return { waiting: next, status: outcome.status };
    }
    // A wait that just ended was the only thing the previous status said, so the main agent works on.
    return { waiting: next, status: previous === 'idle' || previous === 'error' ? previous : 'running' };
}

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
export function modeOfHook(kind: AgentKind, permissionMode: string | null, launched: RuntimeMode): RuntimeMode | null {
    if (permissionMode === null) {
        return null;
    }
    if (kind === 'codex' && permissionMode === 'default') {
        return launched === 'full-access' ? 'supervised' : launched;
    }
    return PERMISSION_MODES[permissionMode] ?? 'supervised';
}

import type { AgentStatus } from '@ruimte/contracts';
import { describe, expect, test } from 'bun:test';
import { borrowedHook, modeOfHook, normalizeHook, requestOfHook, settleWaiting } from './hooks.ts';

function hook(event: string, extra: Record<string, unknown> = {}) {
    return {
        session_id: 'abc',
        transcript_path: '/tmp/t.jsonl',
        cwd: '/tmp',
        hook_event_name: event,
        ...extra
    };
}

describe('normalizeHook', () => {
    test('recognizes the native Codex question tool and keeps its questions readable', () => {
        const body = hook('PreToolUse', {
            tool_name: 'request_user_input',
            tool_input: { questions: [{ id: 'color', question: 'Which color?', options: [{ label: 'Blue' }, { label: 'Red' }] }] }
        });
        expect(normalizeHook(body)?.status).toBe('needs-you');
        expect(requestOfHook(body, 1)).toMatchObject({ kind: 'question', text: 'Which color?\n• Blue\n• Red', createdAt: 1 });
        expect(requestOfHook(hook('PostToolUse'), 2)).toBeNull();
    });

    test('the permission request a bypass session still sends for a question stays that question', () => {
        const body = hook('PermissionRequest', {
            tool_name: 'AskUserQuestion',
            tool_input: { questions: [{ question: 'Which database?', options: [{ label: 'SQLite' }, { label: 'Postgres' }] }] }
        });

        expect(requestOfHook(body, 1)).toMatchObject({ kind: 'question', toolName: 'AskUserQuestion', text: 'Which database?\n• SQLite\n• Postgres' });
        expect(requestOfHook(hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'bun test' } }), 2)).toMatchObject({
            kind: 'approval',
            text: 'bun test'
        });
    });

    test('maps the lifecycle to running, needs-you, idle and gone', () => {
        expect(normalizeHook(hook('SessionStart'))?.status).toBe('idle');
        expect(normalizeHook(hook('UserPromptSubmit'))?.status).toBe('running');
        expect(normalizeHook(hook('PreToolUse', { tool_name: 'Bash' }))?.status).toBe('running');
        expect(normalizeHook(hook('PermissionRequest', { tool_name: 'Bash' }))?.status).toBe('needs-you');
        expect(normalizeHook(hook('Stop'))?.status).toBe('idle');
        expect(normalizeHook(hook('StopFailure'))?.status).toBe('error');
        expect(normalizeHook(hook('SessionEnd', { reason: 'other' }))?.status).toBeNull();
    });

    test('a question to the person counts as needs-you', () => {
        expect(normalizeHook(hook('PreToolUse', { tool_name: 'AskUserQuestion' }))?.status).toBe('needs-you');
        expect(normalizeHook(hook('Notification', { notification_type: 'permission_prompt' }))?.status).toBe('needs-you');
        expect(normalizeHook(hook('Notification', { notification_type: 'elicitation_dialog' }))?.status).toBe('needs-you');
    });

    test('ignores notifications that say nothing about status, unknown events and junk', () => {
        expect(normalizeHook(hook('Notification', { notification_type: 'auth_success' }))).toBeNull();
        expect(normalizeHook(hook('FileChanged'))).toBeNull();
        expect(normalizeHook({ hook_event_name: 'Stop' })).toBeNull();
        expect(normalizeHook('Stop')).toBeNull();
        expect(normalizeHook(null)).toBeNull();
    });

    test('carries the session id and transcript path', () => {
        expect(normalizeHook(hook('Stop'))).toEqual({
            agentSessionId: 'abc',
            transcriptPath: '/tmp/t.jsonl',
            status: 'idle',
            permissionMode: null,
            event: 'Stop',
            subagentId: null
        });
        expect(normalizeHook(hook('Stop', { transcript_path: undefined }))?.transcriptPath).toBeNull();
    });
});

describe('the permission mode a hook reports', () => {
    test('is read off the payload as the CLI names it', () => {
        expect(normalizeHook(hook('UserPromptSubmit', { permission_mode: 'acceptEdits' }))?.permissionMode).toBe('acceptEdits');
        expect(normalizeHook(hook('SessionStart'))?.permissionMode).toBeNull();
    });

    test("maps Claude Code's modes onto Ruimte's order, anything unknown as the strictest", () => {
        const claude = (mode: string) => modeOfHook('claude', mode, 'full-access');
        expect(claude('default')).toBe('supervised');
        expect(claude('plan')).toBe('supervised');
        expect(claude('dontAsk')).toBe('supervised');
        expect(claude('acceptEdits')).toBe('auto-accept-edits');
        expect(claude('auto')).toBe('auto');
        expect(claude('bypassPermissions')).toBe('full-access');
        expect(claude('somethingNew')).toBe('supervised');
        expect(modeOfHook('claude', null, 'full-access')).toBeNull();
    });

    test("keeps a Codex launch among the asking modes, since Codex's default cannot tell them apart", () => {
        expect(modeOfHook('codex', 'default', 'auto')).toBe('auto');
        expect(modeOfHook('codex', 'default', 'full-access')).toBe('supervised');
        expect(modeOfHook('codex', 'bypassPermissions', 'supervised')).toBe('full-access');
    });
});

describe('settleWaiting', () => {
    const settle = (waiting: string[], event: string, extra: Record<string, unknown> = {}, previous: AgentStatus | null = 'running') => {
        const outcome = normalizeHook(hook(event, extra));
        if (!outcome) {
            throw new Error(`${event} is not a status hook`);
        }
        const settled = settleWaiting(new Set(waiting), outcome, previous);
        return { waiting: [...settled.waiting].sort(), status: settled.status };
    };
    const subagent = { agent_id: 'a1' };

    test('a subagent at work does not settle the question the main agent asked', () => {
        expect(settle([''], 'PreToolUse', { tool_name: 'Bash', ...subagent })).toEqual({ waiting: [''], status: 'needs-you' });
        expect(settle([''], 'SubagentStop', subagent)).toEqual({ waiting: [''], status: 'needs-you' });
        expect(settle([''], 'PostToolUse', { tool_name: 'AskUserQuestion' })).toEqual({ waiting: [], status: 'running' });
    });

    test('the main agent at work does not settle an approval a subagent waits on', () => {
        expect(settle([], 'PermissionRequest', { tool_name: 'Bash', ...subagent })).toEqual({ waiting: ['a1'], status: 'needs-you' });
        expect(settle(['a1'], 'PreToolUse', { tool_name: 'Read' })).toEqual({ waiting: ['a1'], status: 'needs-you' });
        expect(settle(['a1'], 'PostToolUse', { tool_name: 'Bash', ...subagent })).toEqual({ waiting: [], status: 'running' });
    });

    test('a prompt, Escape, a new conversation or its end settle every wait', () => {
        expect(settle(['', 'a1'], 'UserPromptSubmit')).toEqual({ waiting: [], status: 'running' });
        expect(settle(['a1'], 'Interrupt')).toEqual({ waiting: [], status: 'idle' });
        expect(settle(['a1'], 'SessionStart')).toEqual({ waiting: [], status: 'idle' });
        expect(settle(['a1'], 'SessionEnd')).toEqual({ waiting: [], status: null });
    });

    test('a Codex subagent is told apart the same way, under the session of its parent', () => {
        const codex = (event: string, extra: Record<string, unknown> = {}) =>
            normalizeHook({ session_id: 'thread-1', turn_id: 'turn-2', hook_event_name: event, permission_mode: 'default', ...extra });
        const pre = codex('PreToolUse', { tool_name: 'Bash', agent_id: 'thread-2', agent_type: 'default' });
        expect(pre).toMatchObject({ agentSessionId: 'thread-1', subagentId: 'thread-2' });
        expect(settleWaiting(new Set(['']), pre!, 'needs-you').status).toBe('needs-you');
    });

    test('a subagent that stops leaves the status of the main agent as it was', () => {
        expect(settle([], 'SubagentStop', {}, 'idle')).toEqual({ waiting: [], status: 'idle' });
        expect(settle([], 'SubagentStop', subagent, 'running')).toEqual({ waiting: [], status: 'running' });
        expect(settle(['a1'], 'SubagentStop', subagent, 'needs-you')).toEqual({ waiting: [], status: 'running' });
    });

    test('the end of the main turn leaves a subagent that still waits', () => {
        expect(settle(['', 'a1'], 'Stop')).toEqual({ waiting: ['a1'], status: 'needs-you' });
    });
});

describe('the hooks of Grok, Copilot and Antigravity', () => {
    // Grok 1.0.62 sends its own camelCase keys beside Claude's snake_case ones (`~/.grok/docs/user-guide/10-hooks.md`).
    function grok(event: string, extra: Record<string, unknown> = {}) {
        return { hookEventName: event.toLowerCase(), sessionId: 'grok-1', ...hook(event, { session_id: 'grok-1', ...extra }) };
    }

    test("Grok's turn that was cancelled leaves it idle, and a permission prompt waits on the person", () => {
        expect(normalizeHook(grok('StopCancelled'), 'grok')?.status).toBe('idle');
        expect(normalizeHook(grok('Notification', { notification_type: 'permission_prompt' }), 'grok')?.status).toBe('needs-you');
        expect(normalizeHook(grok('Notification', { notification_type: 'idle_prompt' }), 'grok')?.status).toBe('idle');
    });

    test("a Grok subagent's session that ends leaves the agent running, and names the subagent", () => {
        const ended = normalizeHook(grok('SessionEnd', { session_id: 'child', subagentType: 'explore' }), 'grok');
        expect(ended).toMatchObject({ status: 'unchanged', subagentId: 'explore' });
        expect(normalizeHook(grok('SessionEnd'), 'grok')?.status).toBeNull();
    });

    test("Copilot's idle notification is idle", () => {
        expect(normalizeHook(hook('Notification', { notification_type: 'agent_idle' }), 'copilot')?.status).toBe('idle');
    });

    test("Antigravity's Stop names its conversation, which is what agy resumes", () => {
        const body = { conversationId: 'conv-1', transcriptPath: '/tmp/t.jsonl', executionNum: 1, terminationReason: 'done', fullyIdle: true };
        expect(normalizeHook(body, 'antigravity')).toEqual({
            agentSessionId: 'conv-1',
            transcriptPath: '/tmp/t.jsonl',
            status: 'idle',
            permissionMode: null,
            event: 'Stop',
            subagentId: null
        });
        expect(normalizeHook({ transcriptPath: '/tmp/t.jsonl' }, 'antigravity')).toBeNull();
    });

    test("a Claude hook that Grok runs from Claude Code's settings never speaks for Claude Code", () => {
        expect(borrowedHook('claude', grok('Stop'), null)).toBe(true);
        expect(borrowedHook('grok', grok('Stop'), null)).toBe(false);
        expect(borrowedHook('claude', hook('Stop'), null)).toBe(false);
    });

    test('a Claude hook in a session another CLI already reported for is that CLI speaking', () => {
        const copilot = { kind: 'copilot', agentSessionId: 'abc' } as const;
        expect(borrowedHook('claude', hook('Stop'), copilot)).toBe(true);
        expect(borrowedHook('claude', hook('Stop', { session_id: 'other' }), copilot)).toBe(false);
        expect(borrowedHook('claude', hook('Stop'), { kind: 'claude', agentSessionId: 'abc' })).toBe(false);
    });
});

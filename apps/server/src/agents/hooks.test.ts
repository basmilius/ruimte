import { describe, expect, test } from 'bun:test';
import { hasHooks, modeOfHook, normalizeHook, settleWaiting } from './hooks.ts';

const hook = (event: string, extra: Record<string, unknown> = {}) => ({
    session_id: 'abc',
    transcript_path: '/tmp/t.jsonl',
    cwd: '/tmp',
    hook_event_name: event,
    ...extra
});

describe('normalizeHook', () => {
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

describe('hasHooks', () => {
    test('is true for the CLIs with a normalizer and false for the terminal-only ones', () => {
        expect(hasHooks('claude')).toBe(true);
        expect(hasHooks('codex')).toBe(true);
        expect(hasHooks('gemini')).toBe(false);
        expect(hasHooks('copilot')).toBe(false);
    });
});

describe('settleWaiting', () => {
    const settle = (waiting: string[], event: string, extra: Record<string, unknown> = {}) => {
        const outcome = normalizeHook(hook(event, extra));
        if (!outcome) {
            throw new Error(`${event} is not a status hook`);
        }
        const settled = settleWaiting(new Set(waiting), outcome);
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

    test('the end of the main turn leaves a subagent that still waits', () => {
        expect(settle(['', 'a1'], 'Stop')).toEqual({ waiting: ['a1'], status: 'needs-you' });
    });
});

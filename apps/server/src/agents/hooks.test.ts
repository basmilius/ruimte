import { describe, expect, test } from 'bun:test';
import { normalizeHook, resumeCommand } from './hooks.ts';

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
        expect(normalizeHook(hook('Stop'))).toEqual({ agentSessionId: 'abc', transcriptPath: '/tmp/t.jsonl', status: 'idle' });
        expect(normalizeHook(hook('Stop', { transcript_path: undefined }))?.transcriptPath).toBeNull();
    });
});

describe('resumeCommand', () => {
    test('quotes the id for the shell', () => {
        expect(resumeCommand('claude', 'abc-123')).toBe("claude --resume 'abc-123'");
        expect(resumeCommand('codex', "a'b")).toBe("codex resume 'a'\\''b'");
    });
});

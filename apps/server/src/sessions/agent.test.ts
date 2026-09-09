import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Recorder, SH, SH_ARGS, makeHarness, waitFor, type Harness } from './test-helpers.ts';

let harness: Harness;

beforeEach(async () => {
    harness = await makeHarness();
});

afterEach(async () => {
    await harness.cleanup();
});

const create = (sessionId: string, command?: string) =>
    harness.manager.create({ sessionId, cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: harness.home, command });

const hook = (event: string, extra: Record<string, unknown> = {}) => ({
    session_id: 'claude-1',
    transcript_path: '/tmp/t.jsonl',
    hook_event_name: event,
    ...extra
});

describe('agent status via hooks', () => {
    test('the shell gets the hook variables and a matching token routes a hook to the session', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s1');
        await harness.manager.attach('s1', 'c1', 80, 24);
        harness.manager.write('s1', 'echo "$RUIMTE_HOOK_URL" "$RUIMTE_HOOK_TOKEN"\n');
        await waitFor(() => /http:\/\/127\.0\.0\.1:1\/hooks (\S+)/.test(recorder.output.replace(/\r/g, '')), 'hook variables on the screen');
        const token = /http:\/\/127\.0\.0\.1:1\/hooks (\S+)\n/.exec(recorder.output.replace(/\r/g, ''))?.[1] ?? '';
        expect(token.length).toBeGreaterThan(20);

        expect(await harness.manager.applyHook('claude', 'wrong', hook('Stop'))).toBe('unknown-token');
        expect(await harness.manager.applyHook('claude', token, hook('UserPromptSubmit'))).toBe('applied');
        expect(await harness.manager.applyHook('claude', token, hook('PermissionRequest'))).toBe('applied');
        expect(await harness.manager.applyHook('claude', token, hook('Notification', { notification_type: 'auth_success' }))).toBe('ignored');
        expect(await harness.manager.applyHook('claude', token, hook('Stop'))).toBe('applied');
        expect(recorder.statusesOf('s1')).toEqual(['running', 'needs-you', 'idle']);
        expect(harness.manager.list()[0]?.agent).toMatchObject({ kind: 'claude', agentSessionId: 'claude-1', status: 'idle', live: true });

        expect(await harness.manager.applyHook('claude', token, hook('SessionEnd'))).toBe('applied');
        expect(harness.manager.list()[0]?.agent).toBeNull();
        expect(await harness.agents.read('s1')).toBeNull();
    });

    test('a shell that dies under a live agent leaves an error status, and a new life offers a cold resume', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        const info = await create('s2');
        await harness.manager.attach('s2', 'c1', 80, 24);
        const session = harness.manager.get('s2')!;
        await harness.manager.applyHook('claude', session.hookToken, hook('UserPromptSubmit'));
        expect(await harness.agents.read('s2')).toMatchObject({ agentSessionId: 'claude-1', live: true });

        harness.manager.write('s2', 'exit 3\n');
        await waitFor(() => recorder.exitOf('s2') !== undefined, 'exit');
        expect(harness.manager.list()[0]?.agent).toMatchObject({ status: 'error', live: false });
        expect(info.pid).toBeGreaterThan(0);

        await create('s2');
        const restored = harness.manager.get('s2')!;
        expect(restored.agent).toMatchObject({ agentSessionId: 'claude-1', live: false });
        await harness.manager.attach('s2', 'c1', 80, 24);
        // The resume line is typed into the shell; `claude` need not exist for the echo to show it.
        harness.manager.resumeAgent('s2');
        await waitFor(() => recorder.output.includes("claude --resume 'claude-1'"), 'resume command echoed');
        expect(() => harness.manager.resumeAgent('s3')).toThrow('No session');
    });

    test('a command given at create runs as the first line', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s4', 'echo fir""st-line');
        await harness.manager.attach('s4', 'c1', 80, 24);
        await waitFor(() => recorder.output.includes('first-line'), 'command output');
    });

    test('kill drops the agent record with the snapshot', async () => {
        await create('s5');
        const session = harness.manager.get('s5')!;
        await harness.manager.applyHook('codex', session.hookToken, hook('SessionStart'));
        expect(await harness.agents.read('s5')).toMatchObject({ kind: 'codex' });
        await harness.manager.kill('s5');
        await waitFor(() => harness.manager.list().length === 0, 'session gone');
        expect(await harness.agents.read('s5')).toBeNull();
    });
});

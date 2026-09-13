import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SessionError } from './manager.ts';
import { Recorder, SH, SH_ARGS, makeHarness, waitFor, waitForAsync, type Harness } from './test-helpers.ts';

let harness: Harness;

beforeEach(async () => {
    harness = await makeHarness();
});

afterEach(async () => {
    await harness.cleanup();
});

const create = (sessionId: string, command?: string) =>
    harness.manager.create({ sessionId, cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: harness.home, command });

const codeOf = (work: () => void): string => {
    try {
        work();
    } catch (e) {
        return e instanceof SessionError ? e.code : 'not-a-session-error';
    }
    return 'nothing-was-thrown';
};

const resumes = (output: string): number => output.split("claude --resume 'claude-1'").length - 1;

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

    test('a shell that dies under a live agent leaves an exited status, and a new life offers a cold resume', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        const info = await create('s2');
        await harness.manager.attach('s2', 'c1', 80, 24);
        const session = harness.manager.get('s2')!;
        await harness.manager.applyHook('claude', session.hookToken, hook('UserPromptSubmit'));
        expect(await harness.agents.read('s2')).toMatchObject({ agentSessionId: 'claude-1', live: true });

        harness.manager.write('s2', 'exit 3\n');
        await waitFor(() => recorder.exitOf('s2') !== undefined, 'exit');
        expect(harness.manager.list()[0]?.agent).toMatchObject({ status: 'exited', live: false });
        expect(recorder.statusesOf('s2')).toEqual(['running', 'exited']);
        // The record outlives the shell: without it there is no id left to resume with.
        expect(await harness.agents.read('s2')).toMatchObject({ agentSessionId: 'claude-1', status: 'exited', live: false });
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

    test('a session the daemon has an agent for starts no CLI of its own, and a resume is typed once', async () => {
        let clock = 1_000;
        await harness.cleanup();
        // A PATH without any agent CLI on it: the resume line is then only ever an echo on the screen.
        harness = await makeHarness({ now: () => clock, env: { PATH: '/usr/bin:/bin', PS1: '$ ' } });
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s6');
        await harness.manager.applyHook('claude', harness.manager.get('s6')!.hookToken, hook('UserPromptSubmit'));
        harness.manager.write('s6', 'exit 0\n');
        await waitFor(() => harness.manager.get('s6')?.exited === true, 'the shell to end');

        await harness.manager.create({
            sessionId: 's6',
            cols: 80,
            rows: 24,
            shell: SH,
            args: SH_ARGS,
            cwd: harness.home,
            agent: { kind: 'claude', runtimeMode: 'full-access' }
        });
        await harness.manager.attach('s6', 'c1', 80, 24);
        harness.manager.write('s6', 'echo ma""rk\n');
        await waitFor(() => recorder.output.includes('mark'), 'the echo');
        // Starting the CLI here would land beside the resume the attach asks for: two commands for one agent.
        expect(recorder.output).not.toContain('permission-mode');

        harness.manager.resumeAgent('s6');
        await waitFor(() => recorder.output.includes("claude --resume 'claude-1'"), 'the resume line');
        expect(codeOf(() => harness.manager.resumeAgent('s6'))).toBe('agent-resuming');

        // The CLI never came up (it is not installed here), so the next try is allowed after the grace period.
        clock += 15_000;
        harness.manager.resumeAgent('s6');
        await waitFor(() => resumes(recorder.output) === 2, 'the second resume line');

        await harness.manager.applyHook('claude', harness.manager.get('s6')!.hookToken, hook('SessionStart'));
        expect(codeOf(() => harness.manager.resumeAgent('s6'))).toBe('agent-live');
    });

    test('a command given at create runs as the first line', async () => {
        await create('s4', 'echo fir""st-line');
        const session = harness.manager.get('s4')!;
        // The screen, not the stream: a shell that prints before the client attaches puts its output
        // in the serialized screen, and no session.output event ever carries it.
        await waitForAsync(async () => (await session.plainText()).includes('first-line'), 'command output');
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

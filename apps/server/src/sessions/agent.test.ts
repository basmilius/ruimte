import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { AgentLaunch } from '@ruimte/contracts';
import { SessionError, type SessionManagerOptions } from './manager.ts';
import { CLEAN_PATH, Recorder, SH, SH_ARGS, makeHarness, waitFor, waitForAsync, type Harness } from './test-helpers.ts';

let harness: Harness;
// The transcript of the agent the hooks below report; the daemon resumes only what is still on disk.
let transcript: string;

const freshHarness = async (extra: Partial<SessionManagerOptions> = {}): Promise<void> => {
    harness = await makeHarness({ env: { PATH: CLEAN_PATH, PS1: '$ ' }, ...extra });
    transcript = join(harness.home, 'transcript.jsonl');
    await writeFile(transcript, '');
};

// A test here waits on a real shell several times over, each wait up to DEFAULT_TIMEOUT_MS; Bun's own 5 s per test ended them on a loaded CI runner before any wait gave up.
setDefaultTimeout(30_000);

beforeEach(async () => {
    await freshHarness();
});

afterEach(async () => {
    await harness.cleanup();
});

const create = (sessionId: string, command?: string) =>
    harness.manager.create({ sessionId, cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: harness.home, command });

const createAgent = (sessionId: string, agent: AgentLaunch) =>
    harness.manager.create({ sessionId, cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: harness.home, agent });

const codeOf = (work: () => void): string => {
    try {
        work();
    } catch (e) {
        return e instanceof SessionError ? e.code : 'not-a-session-error';
    }
    return 'nothing-was-thrown';
};

const resumes = (output: string): number => output.split("--resume 'claude-1'").length - 1;

const hook = (event: string, extra: Record<string, unknown> = {}) => ({
    session_id: 'claude-1',
    transcript_path: transcript,
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
        await freshHarness({ now: () => clock });
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
        // The mode the node was made in rides on the resume too, so it comes back the way it started.
        await waitFor(() => recorder.output.includes("claude --permission-mode bypassPermissions --resume 'claude-1'"), 'the resume line');
        expect(codeOf(() => harness.manager.resumeAgent('s6'))).toBe('agent-resuming');

        // The CLI never came up (it is not installed here), so the next try is allowed after the grace period.
        clock += 15_000;
        harness.manager.resumeAgent('s6');
        await waitFor(() => resumes(recorder.output) === 2, 'the second resume line');

        await harness.manager.applyHook('claude', harness.manager.get('s6')!.hookToken, hook('SessionStart'));
        expect(codeOf(() => harness.manager.resumeAgent('s6'))).toBe('agent-live');
    });

    test('a restored agent whose transcript is gone launches the CLI fresh instead of resuming it', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await createAgent('s7', { kind: 'claude', runtimeMode: 'full-access' });
        await harness.manager.applyHook('claude', harness.manager.get('s7')!.hookToken, hook('UserPromptSubmit'));
        harness.manager.write('s7', 'exit 0\n');
        await waitFor(() => harness.manager.get('s7')?.exited === true, 'the shell to end');
        // Claude Code persists a conversation only once it has had a prompt, and a transcript can be
        // deleted; either way the recorded id cannot be resumed any more.
        await rm(transcript);

        await createAgent('s7', { kind: 'claude', runtimeMode: 'full-access' });
        await harness.manager.attach('s7', 'c1', 80, 24);
        harness.manager.resumeAgent('s7');
        await waitFor(() => recorder.output.includes('claude --permission-mode bypassPermissions'), 'the fresh launch line');
        expect(recorder.output).not.toContain('--resume');
    });

    test('a resume for a kind whose hooks name no transcript carries its own fallback', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await createAgent('s8', { kind: 'codex', runtimeMode: 'full-access' });
        await harness.manager.applyHook(
            'codex',
            harness.manager.get('s8')!.hookToken,
            hook('UserPromptSubmit', { session_id: 'codex-1', transcript_path: undefined })
        );
        harness.manager.write('s8', 'exit 0\n');
        await waitFor(() => harness.manager.get('s8')?.exited === true, 'the shell to end');

        await createAgent('s8', { kind: 'codex', runtimeMode: 'full-access' });
        await harness.manager.attach('s8', 'c1', 80, 24);
        harness.manager.resumeAgent('s8');
        await waitFor(
            () =>
                recorder.output.includes(
                    "codex resume --ask-for-approval never --sandbox danger-full-access 'codex-1' || codex --ask-for-approval never --sandbox danger-full-access"
                ),
            'the resume with its fallback'
        );
    });

    test('a node that asks to resume a session id gets one line that falls back to a fresh CLI', async () => {
        // Wide enough that the line stands on one row of the screen this reads back.
        await harness.manager.create({
            sessionId: 's9',
            cols: 200,
            rows: 24,
            shell: SH,
            args: SH_ARGS,
            cwd: harness.home,
            agent: { kind: 'claude', runtimeMode: 'full-access', resume: 'claude-9' }
        });
        const session = harness.manager.get('s9')!;
        const line = "claude --permission-mode bypassPermissions --resume 'claude-9' || claude --permission-mode bypassPermissions";
        await waitForAsync(async () => (await session.plainText()).includes(line), 'the resume with its fallback');
        harness.manager.write('s9', 'echo ma""rk\n');
        await waitForAsync(async () => (await session.plainText()).includes('mark'), 'the echo');
        // One shell, one line: the prompt ran a single command for this agent, fallback and all.
        const prompted = (await session.plainText()).split('\n').filter((row) => row.startsWith('$ claude'));
        expect(prompted).toEqual([`$ ${line}`]);
    });

    /*
     * The bug this holds shut: a node started in accept-edits came back on the daemon's own default
     * after a restart, because the resume line named only the session id. Claude Code 2.1.270 reads
     * the mode and the model back out of the transcript it resumes (measured against the real CLI),
     * but the daemon is not going to lean on that: Codex takes both from the line alone.
     */
    test('a node restored after a daemon restart resumes in the mode and on the model it was started in', async () => {
        const launch: AgentLaunch = { kind: 'claude', runtimeMode: 'auto-accept-edits', model: 'claude-opus-5' };
        await createAgent('s10', launch);
        await harness.manager.applyHook('claude', harness.manager.get('s10')!.hookToken, hook('UserPromptSubmit'));
        const { home } = harness;

        // The daemon goes down with its shells and comes back over the same directory.
        harness.manager.killAll();
        const restarted = await makeHarness({ env: { PATH: CLEAN_PATH, PS1: '$ ' } }, home);
        const recorder = new Recorder();
        restarted.manager.subscribe('c1', recorder.sink());
        const info = await restarted.manager.create({ sessionId: 's10', cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: home, agent: launch });
        expect(info.agent).toMatchObject({ agentSessionId: 'claude-1', live: false });
        await restarted.manager.attach('s10', 'c1', 80, 24);
        // Nothing is typed at create: the client answers the restored agent with `agent.resume`.
        expect(recorder.output).not.toContain('claude');

        restarted.manager.resumeAgent('s10');
        await waitFor(
            () => recorder.output.includes("claude --permission-mode acceptEdits --model 'claude-opus-5' --resume 'claude-1'"),
            'the resume line with the mode and the model'
        );
        // Still one line for one shell: the fallback of the line before it must not have been typed too.
        expect(resumes(recorder.output)).toBe(1);
        await restarted.cleanup();
    });

    /* A CLI a person started by hand is nobody's node, so there is no mode to put back on its line. */
    test('a resume of an agent the session was not launched with stays bare', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await createAgent('s11', { kind: 'codex', runtimeMode: 'supervised' });
        await harness.manager.applyHook('claude', harness.manager.get('s11')!.hookToken, hook('UserPromptSubmit'));
        harness.manager.write('s11', 'exit 0\n');
        await waitFor(() => harness.manager.get('s11')?.exited === true, 'the shell to end');

        await createAgent('s11', { kind: 'codex', runtimeMode: 'supervised' });
        await harness.manager.attach('s11', 'c1', 80, 24);
        harness.manager.resumeAgent('s11');
        await waitFor(() => recorder.output.includes("claude --resume 'claude-1'"), 'the bare resume line');
        expect(recorder.output).not.toContain('--permission-mode');
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

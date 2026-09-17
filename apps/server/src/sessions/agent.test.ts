import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AgentLaunch } from '@ruimte/contracts';
import { verbsNote } from '../context/context-note.ts';
import { terminalCommand } from '../providers/launch.ts';
import { SessionError, type SessionManagerOptions } from './manager.ts';
import { Recorder, makeHarness, type Harness } from './test-helpers.ts';

let harness: Harness;
// The transcript of the agent the hooks below report; the daemon resumes only what is still on disk.
let transcript: string;

const freshHarness = async (extra: Partial<SessionManagerOptions> = {}): Promise<void> => {
    harness = await makeHarness(extra);
    transcript = join(harness.home, 'transcript.jsonl');
    await writeFile(transcript, '');
};

beforeEach(async () => {
    await freshHarness();
});

afterEach(async () => {
    await harness.cleanup();
});

const create = (sessionId: string, command?: string) => harness.manager.create({ sessionId, cols: 80, rows: 24, cwd: harness.home, command });

const createAgent = (sessionId: string, agent: AgentLaunch) => harness.manager.create({ sessionId, cols: 80, rows: 24, cwd: harness.home, agent });

const codeOf = (work: () => void): string => {
    try {
        work();
    } catch (e) {
        return e instanceof SessionError ? e.code : 'not-a-session-error';
    }
    return 'nothing-was-thrown';
};

const hook = (event: string, extra: Record<string, unknown> = {}) => ({
    session_id: 'claude-1',
    transcript_path: transcript,
    hook_event_name: event,
    ...extra
});

/* A shell that ends on its own, with every agent record the exit wrote already on disk. */
const endShell = async (sessionId: string, exitCode = 0): Promise<void> => {
    const pty = harness.adapter.forSession(sessionId);
    pty.exit(exitCode);
    await pty.exited;
    await harness.agents.settled();
};

describe('agent status via hooks', () => {
    test('the shell gets the hook variables and a matching token routes a hook to the session', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s1');
        const { env } = harness.adapter.forSession('s1').options;
        expect(env.RUIMTE_HOOK_URL).toBe('http://127.0.0.1:1/hooks');
        const token = env.RUIMTE_HOOK_TOKEN ?? '';
        expect(token.length).toBeGreaterThan(20);
        expect(token).toBe(harness.manager.get('s1')!.hookToken);
        expect(harness.manager.sessionIdForToken(token)).toBe('s1');

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

    test('the permission mode the hooks last reported is kept per session until the CLI leaves', async () => {
        await createAgent('s1', { kind: 'claude', runtimeMode: 'full-access' });
        const session = harness.manager.get('s1')!;
        const apply = (event: string, extra: Record<string, unknown> = {}) => harness.manager.applyHook('claude', session.hookToken, hook(event, extra));

        await apply('SessionStart');
        expect(session.reportedMode).toBeNull();
        await apply('UserPromptSubmit', { permission_mode: 'plan' });
        expect(session.reportedMode).toBe('supervised');
        // An event that names no mode leaves the last one standing.
        await apply('Notification', { notification_type: 'permission_prompt' });
        expect(session.reportedMode).toBe('supervised');
        await apply('Stop', { permission_mode: 'acceptEdits' });
        expect(session.reportedMode).toBe('auto-accept-edits');
        await apply('SessionEnd');
        expect(session.reportedMode).toBeNull();
    });

    test('a shell without a hook URL gets no hook variables', async () => {
        await harness.cleanup();
        await freshHarness({ hookUrl: undefined });
        await create('s1');
        const { env } = harness.adapter.forSession('s1').options;
        expect(env.RUIMTE_HOOK_URL).toBeUndefined();
        expect(env.RUIMTE_HOOK_TOKEN).toBeUndefined();
    });

    test('a shell that dies under a live agent leaves an exited status, and a new life offers a cold resume', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        const info = await create('s2');
        await harness.manager.attach('s2', 'c1', 80, 24);
        await harness.manager.applyHook('claude', harness.manager.get('s2')!.hookToken, hook('UserPromptSubmit'));
        expect(await harness.agents.read('s2')).toMatchObject({ agentSessionId: 'claude-1', live: true });
        expect(info.pid).toBe(harness.adapter.forSession('s2').pid);

        await endShell('s2', 3);
        expect(recorder.exitOf('s2')).toBe(3);
        expect(harness.manager.list()[0]?.agent).toMatchObject({ status: 'exited', live: false });
        expect(recorder.statusesOf('s2')).toEqual(['running', 'exited']);
        // The record outlives the shell: without it there is no id left to resume with.
        expect(await harness.agents.read('s2')).toMatchObject({ agentSessionId: 'claude-1', status: 'exited', live: false });

        await create('s2');
        const restored = harness.manager.get('s2')!;
        expect(restored.agent).toMatchObject({ agentSessionId: 'claude-1', live: false });
        const pty = harness.adapter.forSession('s2');
        expect(pty.input).toEqual([]);

        harness.manager.resumeAgent('s2');
        expect(pty.input).toEqual(["claude --resume 'claude-1'\n"]);
        expect(() => harness.manager.resumeAgent('s3')).toThrow('No session');
    });

    test('a resume into a shell that has ended is refused', async () => {
        await create('s2');
        await harness.manager.applyHook('claude', harness.manager.get('s2')!.hookToken, hook('UserPromptSubmit'));
        await endShell('s2');
        expect(codeOf(() => harness.manager.resumeAgent('s2'))).toBe('session-exited');
    });

    test('a session the daemon has an agent for starts no CLI of its own, and a resume is typed once', async () => {
        let clock = 1_000;
        await harness.cleanup();
        await freshHarness({ now: () => clock });
        await create('s6');
        await harness.manager.applyHook('claude', harness.manager.get('s6')!.hookToken, hook('UserPromptSubmit'));
        await endShell('s6');

        await createAgent('s6', { kind: 'claude', runtimeMode: 'full-access' });
        const pty = harness.adapter.forSession('s6');
        // Starting the CLI here would land beside the resume the attach asks for: two commands for one agent.
        expect(pty.input).toEqual([]);

        const line = "claude --permission-mode bypassPermissions --resume 'claude-1'\n";
        harness.manager.resumeAgent('s6');
        // The mode the node was made in rides on the resume too, so it comes back the way it started.
        expect(pty.input).toEqual([line]);
        expect(codeOf(() => harness.manager.resumeAgent('s6'))).toBe('agent-resuming');
        clock += 14_999;
        expect(codeOf(() => harness.manager.resumeAgent('s6'))).toBe('agent-resuming');
        expect(pty.input).toEqual([line]);

        // The CLI never came up, so the next try is allowed after the grace period.
        clock += 1;
        harness.manager.resumeAgent('s6');
        expect(pty.input).toEqual([line, line]);

        await harness.manager.applyHook('claude', harness.manager.get('s6')!.hookToken, hook('SessionStart'));
        expect(codeOf(() => harness.manager.resumeAgent('s6'))).toBe('agent-live');
        expect(pty.input).toEqual([line, line]);
    });

    test('an agent the process monitor found gone may be resumed although its status says live', async () => {
        await create('s12');
        await harness.manager.applyHook('claude', harness.manager.get('s12')!.hookToken, hook('UserPromptSubmit'));
        expect(codeOf(() => harness.manager.resumeAgent('s12'))).toBe('agent-live');

        harness.manager.isAgentGone = (sessionId) => sessionId === 's12';
        harness.manager.resumeAgent('s12');
        expect(harness.adapter.forSession('s12').input).toEqual(["claude --resume 'claude-1'\n"]);
    });

    test('a restored agent whose transcript is gone launches the CLI fresh instead of resuming it', async () => {
        await createAgent('s7', { kind: 'claude', runtimeMode: 'full-access' });
        expect(harness.adapter.forSession('s7').input).toEqual(['claude --permission-mode bypassPermissions\n']);
        await harness.manager.applyHook('claude', harness.manager.get('s7')!.hookToken, hook('UserPromptSubmit'));
        await endShell('s7');
        // Claude Code persists a conversation only once it has had a prompt, and a transcript can be
        // deleted; either way the recorded id cannot be resumed any more.
        await rm(transcript);

        await createAgent('s7', { kind: 'claude', runtimeMode: 'full-access' });
        const pty = harness.adapter.forSession('s7');
        harness.manager.resumeAgent('s7');
        expect(pty.input).toEqual(['claude --permission-mode bypassPermissions\n']);
    });

    test('a resume for a kind whose hooks name no transcript carries its own fallback', async () => {
        await createAgent('s8', { kind: 'codex', runtimeMode: 'full-access' });
        await harness.manager.applyHook(
            'codex',
            harness.manager.get('s8')!.hookToken,
            hook('UserPromptSubmit', { session_id: 'codex-1', transcript_path: undefined })
        );
        await endShell('s8');

        await createAgent('s8', { kind: 'codex', runtimeMode: 'full-access' });
        const pty = harness.adapter.forSession('s8');
        harness.manager.resumeAgent('s8');
        expect(pty.input).toEqual([
            `codex resume --ask-for-approval never --sandbox danger-full-access 'codex-1' || ${terminalCommand({ kind: 'codex', runtimeMode: 'full-access' }, undefined, verbsNote({ depth: 0 }))}\n`
        ]);
    });

    test('a node that asks to resume a session id gets one line that falls back to a fresh CLI', async () => {
        await createAgent('s9', { kind: 'claude', runtimeMode: 'full-access', resume: 'claude-9' });
        // One line for one agent, fallback and all.
        expect(harness.adapter.forSession('s9').input).toEqual([
            "claude --permission-mode bypassPermissions --resume 'claude-9' || claude --permission-mode bypassPermissions\n"
        ]);
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
        await harness.adapter.forSession('s10').exited;
        await harness.agents.settled();
        const restarted = await makeHarness({}, home);
        try {
            const info = await restarted.manager.create({ sessionId: 's10', cols: 80, rows: 24, cwd: home, agent: launch });
            expect(info.agent).toMatchObject({ agentSessionId: 'claude-1', live: false });
            const pty = restarted.adapter.forSession('s10');
            // Nothing is typed at create: the client answers the restored agent with `agent.resume`.
            expect(pty.input).toEqual([]);

            restarted.manager.resumeAgent('s10');
            // Only the resume: the fallback a fresh line carries must not have been typed too.
            expect(pty.input).toEqual(["claude --permission-mode acceptEdits --model 'claude-opus-5' --resume 'claude-1'\n"]);
        } finally {
            await restarted.cleanup();
        }
    });

    /* A CLI a person started by hand is nobody's node, so there is no mode to put back on its line. */
    test('a resume of an agent the session was not launched with stays bare', async () => {
        await createAgent('s11', { kind: 'codex', runtimeMode: 'supervised' });
        await harness.manager.applyHook('claude', harness.manager.get('s11')!.hookToken, hook('UserPromptSubmit'));
        await endShell('s11');

        await createAgent('s11', { kind: 'codex', runtimeMode: 'supervised' });
        const pty = harness.adapter.forSession('s11');
        harness.manager.resumeAgent('s11');
        expect(pty.input).toEqual(["claude --resume 'claude-1'\n"]);
    });

    test('a command given at create is typed as the first line, and what it prints before an attach is on the screen', async () => {
        await create('s4', 'echo first-line');
        const pty = harness.adapter.forSession('s4');
        expect(pty.input).toEqual(['echo first-line\n']);

        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        pty.emit('first-line\r\n');
        // The screen, not the stream: output from before the client attached is in the serialized screen.
        const attached = await harness.manager.attach('s4', 'c1', 80, 24);
        expect(attached.screen).toContain('first-line');
        harness.manager.get('s4')!.flush();
        expect(recorder.output).toBe('');
    });

    test('kill drops the agent record with the snapshot', async () => {
        await create('s5');
        await harness.manager.applyHook('codex', harness.manager.get('s5')!.hookToken, hook('SessionStart'));
        expect(await harness.agents.read('s5')).toMatchObject({ kind: 'codex' });
        await harness.manager.kill('s5');
        await harness.adapter.forSession('s5').exited;
        expect(harness.manager.list()).toEqual([]);
        expect(await harness.agents.read('s5')).toBeNull();
    });
});

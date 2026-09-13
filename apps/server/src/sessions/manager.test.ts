import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { RESTORED_TEXT } from './session.ts';
import type { SessionManager } from './manager.ts';
import { Recorder, SH, SH_ARGS, makeHarness, waitFor, type Harness } from './test-helpers.ts';

let harness: Harness;

beforeEach(async () => {
    harness = await makeHarness();
});

afterEach(async () => {
    await harness.cleanup();
});

const create = (sessionId: string, cols = 80, rows = 24) => harness.manager.create({ sessionId, cols, rows, shell: SH, args: SH_ARGS, cwd: harness.home });

// What Claude Code posts when it asks, and posts again beside its own prompt on the screen.
const PERMISSION_HOOK = { hook_event_name: 'PermissionRequest', session_id: 'cli-1', tool_name: 'Bash', tool_input: { command: 'sleep 12' } };

/* The two calls the hook route makes for one permission POST: the status first, then the hold.
   The hold is handed back wrapped, so awaiting this helper does not wait for the answer as well. */
const askPermission = async (manager: SessionManager, token: string): Promise<{ decision: Promise<unknown> }> => {
    await manager.applyHook('claude', token, PERMISSION_HOOK);
    return { decision: manager.holdApproval(token, PERMISSION_HOOK, new AbortController().signal) };
};

const pendingIds = (recorder: Recorder, sessionId: string): string[] => {
    const last = recorder.events.filter((event) => event.event === 'session.approvals' && event.payload.sessionId === sessionId).at(-1);
    return last?.event === 'session.approvals' ? last.payload.approvals.map((approval) => approval.requestId) : [];
};

describe('SessionManager', () => {
    test('a permission request is held only while some client still wants to be asked', () => {
        expect(harness.manager.wantsApprovals()).toBe(false);

        harness.manager.subscribe('c1', new Recorder().sink());
        const leave = harness.manager.subscribe('c2', new Recorder().sink());
        expect(harness.manager.wantsApprovals()).toBe(true);

        // One client turning the switch off says nothing about the other one.
        harness.manager.setApprovalPreference('c1', false);
        expect(harness.manager.wantsApprovals()).toBe(true);
        harness.manager.setApprovalPreference('c2', false);
        expect(harness.manager.wantsApprovals()).toBe(false);
        harness.manager.setApprovalPreference('c2', true);
        expect(harness.manager.wantsApprovals()).toBe(true);

        // The one that still wanted them left, so only the client that said no is here.
        leave();
        expect(harness.manager.wantsApprovals()).toBe(false);
    });

    test('a permission answered here takes the node off needs-you, since the CLI reports nothing', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s1');

        const { decision } = await askPermission(harness.manager, harness.manager.get('s1')!.hookToken);
        expect(recorder.statusesOf('s1').at(-1)).toBe('needs-you');

        expect(harness.manager.answerApproval('s1', pendingIds(recorder, 's1')[0]!, 'allow')).toBe(true);
        expect(await decision).toEqual({ behavior: 'allow' });
        // The tool the agent asked for is running now, and PostToolUse is a whole command away.
        expect(recorder.statusesOf('s1').at(-1)).toBe('running');
        expect(harness.manager.get('s1')!.agent?.status).toBe('running');
    });

    test('a deny says the same, since the agent reads the refusal and carries on', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s1');

        const { decision } = await askPermission(harness.manager, harness.manager.get('s1')!.hookToken);
        harness.manager.answerApproval('s1', pendingIds(recorder, 's1')[0]!, 'deny');
        expect(await decision).toEqual({ behavior: 'deny', message: 'Denied from Ruimte.' });
        expect(recorder.statusesOf('s1').at(-1)).toBe('running');
    });

    test('a second request still open keeps the node waiting for a person', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s1');
        const token = harness.manager.get('s1')!.hookToken;

        const { decision: first } = await askPermission(harness.manager, token);
        const { decision: second } = await askPermission(harness.manager, token);
        const [firstId, secondId] = pendingIds(recorder, 's1');

        harness.manager.answerApproval('s1', firstId!, 'allow');
        expect(await first).toEqual({ behavior: 'allow' });
        expect(harness.manager.get('s1')!.agent?.status).toBe('needs-you');

        harness.manager.answerApproval('s1', secondId!, 'allow');
        expect(await second).toEqual({ behavior: 'allow' });
        expect(harness.manager.get('s1')!.agent?.status).toBe('running');
    });

    test('a hook that spoke after the request keeps the last word over what the daemon infers', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s1');
        const token = harness.manager.get('s1')!.hookToken;

        const { decision } = await askPermission(harness.manager, token);
        // A tool running beside the question finished, which is a status the CLI reported itself.
        await harness.manager.applyHook('claude', token, { hook_event_name: 'PostToolUse', session_id: 'cli-1', tool_name: 'Read' });
        const reported = harness.manager.get('s1')!.agent!;
        expect(reported.status).toBe('running');

        harness.manager.answerApproval('s1', pendingIds(recorder, 's1')[0]!, 'allow');
        expect(await decision).toEqual({ behavior: 'allow' });
        // Untouched down to the moment it was stamped, so nothing was inferred over the hook's word.
        expect(harness.manager.get('s1')!.agent).toEqual(reported);
    });

    test('a turn that ends takes back what the CLI is no longer asking', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s1');
        const token = harness.manager.get('s1')!.hookToken;

        const { decision } = await askPermission(harness.manager, token);
        expect(pendingIds(recorder, 's1')).toHaveLength(1);

        // The person answered in the CLI's own prompt, which leaves the hook hanging; Stop is the proof.
        await harness.manager.applyHook('claude', token, { hook_event_name: 'Stop', session_id: 'cli-1' });
        expect(await decision).toBeNull();
        expect(pendingIds(recorder, 's1')).toEqual([]);
        expect(harness.manager.get('s1')!.agent?.status).toBe('idle');
    });

    test('a tool that finished beside the question leaves the question standing', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s1');
        const token = harness.manager.get('s1')!.hookToken;

        await askPermission(harness.manager, token);
        await harness.manager.applyHook('claude', token, { hook_event_name: 'PostToolUse', session_id: 'cli-1', tool_name: 'Read' });
        expect(pendingIds(recorder, 's1')).toHaveLength(1);
    });

    test('a request nobody answered leaves the status alone, since the CLI is still asking on its own screen', async () => {
        const local = await makeHarness({ approvalHoldMs: 20 });
        try {
            const recorder = new Recorder();
            local.manager.subscribe('c1', recorder.sink());
            await local.manager.create({ sessionId: 's1', cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: local.home });

            const { decision } = await askPermission(local.manager, local.manager.get('s1')!.hookToken);
            expect(await decision).toBeNull();
            expect(pendingIds(recorder, 's1')).toEqual([]);
            expect(local.manager.get('s1')!.agent?.status).toBe('needs-you');
        } finally {
            await local.cleanup();
        }
    });

    test('a socket that comes back is asked again, since its preference left with it', () => {
        const leave = harness.manager.subscribe('c1', new Recorder().sink());
        harness.manager.setApprovalPreference('c1', false);
        leave();

        harness.manager.subscribe('c1', new Recorder().sink());
        expect(harness.manager.wantsApprovals()).toBe(true);
    });

    test('clear empties the buffer and hands every attached client the fresh screen', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());

        await create('s1');
        await harness.manager.attach('s1', 'c1', 80, 24);
        harness.manager.write('s1', 'echo hel""lo\n');
        await waitFor(() => recorder.output.includes('hello'), 'hello in the stream');

        await harness.manager.clear('s1');
        expect(recorder.resyncOf('s1')).toBeDefined();
        expect(recorder.resyncOf('s1')).not.toContain('hello');
        // The daemon owns the screen, so a reattach cannot bring the old one back either.
        const attached = await harness.manager.attach('s1', 'c1', 80, 24);
        expect(attached.screen).not.toContain('hello');
    });

    test('streams output to an attached client and holds the screen for a reattach', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());

        const info = await create('s1');
        expect(info).toMatchObject({ sessionId: 's1', cols: 80, rows: 24, exited: false, attached: 0 });
        expect(info.pid).toBeGreaterThan(0);

        await harness.manager.attach('s1', 'c1', 80, 24);
        harness.manager.write('s1', 'echo hel""lo\n');
        await waitFor(() => recorder.output.includes('hello'), 'hello in the stream');

        harness.manager.detach('s1', 'c1');
        expect(harness.manager.list()[0]?.attached).toBe(0);

        const outputBefore = recorder.output;
        const attached = await harness.manager.attach('s1', 'c1', 80, 24);
        expect(attached.exited).toBe(false);
        expect(attached.screen).toContain('hello');
        // Nothing may be streamed for the period the client was gone; the screen carries it.
        expect(recorder.output).toBe(outputBefore);
    });

    test('a session with links at its start shows the context line above the first prompt; one without stays quiet', async () => {
        await harness.cleanup();
        harness = await makeHarness({ contextFor: (sessionId) => (sessionId === 'linked' ? [{ id: 'text-1', kind: 'text', title: 'Sprint goals' }] : []) });
        await create('linked');
        await create('plain');
        const linked = await harness.manager.attach('linked', 'c1', 80, 24);
        const plain = await harness.manager.attach('plain', 'c1', 80, 24);
        expect(linked.screen).toContain('Ruimte: linked context is available with ruimte-context (list, read <id>): "Sprint goals" (text).');
        expect(plain.screen).not.toContain('ruimte-context');
        // The line is on the screen only; the shell never received it as input.
        harness.manager.write('linked', 'echo o""k\n');
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await waitFor(() => recorder.output.includes('ok'), 'the echo');
        expect(recorder.output).not.toContain('command not found');
    });

    test('a second client sees the screen the first produced, and both get new output', async () => {
        const first = new Recorder();
        const second = new Recorder();
        harness.manager.subscribe('c1', first.sink());
        harness.manager.subscribe('c2', second.sink());

        await create('s2');
        await harness.manager.attach('s2', 'c1', 80, 24);
        harness.manager.write('s2', 'echo fir""st\n');
        await waitFor(() => first.output.includes('first'), 'first');

        const attached = await harness.manager.attach('s2', 'c2', 80, 24);
        expect(attached.screen).toContain('first');
        expect(second.output).not.toContain('first');

        harness.manager.write('s2', 'echo sec""ond\n');
        await waitFor(() => first.output.includes('second') && second.output.includes('second'), 'second on both');
        expect(harness.manager.list()[0]?.attached).toBe(2);
    });

    test('resize reaches the shell and the last attacher decides the size', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s3');
        await harness.manager.attach('s3', 'c1', 80, 24);

        harness.manager.resize('s3', 100, 30);
        harness.manager.write('s3', 'stty size\n');
        await waitFor(() => recorder.output.includes('30 100'), 'stty after resize');

        const attached = await harness.manager.attach('s3', 'c1', 120, 40);
        expect(attached).toMatchObject({ cols: 120, rows: 40 });
        harness.manager.write('s3', 'stty size\n');
        await waitFor(() => recorder.output.includes('40 120'), 'stty after reattach');
    });

    test('kill delivers session.exit to attached clients and drops the session from the list', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s4');
        await harness.manager.attach('s4', 'c1', 80, 24);
        await harness.snapshots.write('s4', 'stale');

        await harness.manager.kill('s4');
        await waitFor(() => recorder.exitOf('s4') !== undefined, 'session.exit');
        expect(harness.manager.list()).toEqual([]);
        expect(harness.manager.get('s4')).toBeUndefined();
        expect(await harness.snapshots.read('s4')).toBeNull();
        expect(recorder.events.some((event) => event.event === 'session.list-changed')).toBe(true);
    });

    test('a shell that exits on its own stays listed as exited until it is killed or recreated', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s5');
        await harness.manager.attach('s5', 'c1', 80, 24);
        harness.manager.write('s5', 'exit 3\n');
        await waitFor(() => recorder.exitOf('s5') === 3, 'exit code 3');

        expect(harness.manager.list()[0]).toMatchObject({ sessionId: 's5', exited: true, exitCode: 3 });
        expect(() => harness.manager.write('s5', 'x')).toThrow(expect.objectContaining({ code: 'session-exited' }));

        const attached = await harness.manager.attach('s5', 'c1', 80, 24);
        expect(attached.exited).toBe(true);

        // Recreating the id carries the old screen over with the restored marker, like a disk snapshot would.
        await create('s5');
        const fresh = await harness.manager.attach('s5', 'c2', 80, 24);
        expect(fresh.exited).toBe(false);
        expect(fresh.screen).toContain('exit 3');
        expect(fresh.screen).toContain(RESTORED_TEXT);
    });

    test('refuses a duplicate id and an unknown id with their own codes', async () => {
        await create('s6');
        await expect(create('s6')).rejects.toMatchObject({ code: 'session-exists' });
        await expect(harness.manager.attach('nope', 'c1', 80, 24)).rejects.toMatchObject({ code: 'session-not-found' });
        expect(() => harness.manager.detach('nope', 'c1')).toThrow(expect.objectContaining({ code: 'session-not-found' }));
    });

    test('detachAll drops every attachment of one client and nothing of another', async () => {
        const first = new Recorder();
        const second = new Recorder();
        harness.manager.subscribe('c1', first.sink());
        harness.manager.subscribe('c2', second.sink());
        await create('s7');
        await create('s8');
        await harness.manager.attach('s7', 'c1', 80, 24);
        await harness.manager.attach('s8', 'c1', 80, 24);
        await harness.manager.attach('s8', 'c2', 80, 24);

        harness.manager.detachAll('c1');
        const attached = Object.fromEntries(harness.manager.list().map((session) => [session.sessionId, session.attached]));
        expect(attached).toEqual({ s7: 0, s8: 1 });
    });

    test('sets the session environment the shell can read', async () => {
        const recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await create('s9');
        await harness.manager.attach('s9', 'c1', 80, 24);
        harness.manager.write('s9', 'echo "$RUIMTE_SESSION_ID/$TERM/$COLORTERM"\n');
        await waitFor(() => recorder.output.includes('s9/xterm-256color/truecolor'), 'env line');
    });
});

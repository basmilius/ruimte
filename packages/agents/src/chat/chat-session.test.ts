import { describe, expect, test } from 'bun:test';
import type { ChatInfo } from '@ruimte/agent-contracts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { claudeProvider } from '../providers/claude-provider.ts';
import type { BackendEvent, BackendHost, ChatBackend, TurnInput } from './backend.ts';
import { ChatSession, type ChatSessionOptions } from './chat-session.ts';

const info = (): ChatInfo => ({
    chatId: 'child',
    provider: 'claude',
    cwd: '/tmp',
    agentSessionId: null,
    model: null,
    selection: claudeProvider.catalog.normalize(undefined),
    runtimeMode: 'supervised',
    status: 'idle',
    running: false,
    activeTurnId: null,
    slashCommands: [],
    usage: { contextTokens: 0, contextWindow: 200000, costUsd: 0, turns: 0 },
    createdAt: 1
});

const flush = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) {
        await Promise.resolve();
    }
};

const rig = (options: Partial<ChatSessionOptions> = {}, blocked = false) => {
    const start = Promise.withResolvers<void>();
    if (!blocked) {
        start.resolve();
    }
    let host: BackendHost;
    const sent: TurnInput[] = [];
    let stops = 0;
    const backend: ChatBackend = {
        running: true,
        pid: null,
        start: () => start.promise,
        sendTurn: (input) => {
            sent.push(input);
        },
        compact: () => undefined,
        interrupt: () => host.onEvent({ type: 'turn.done', state: 'aborted', costUsd: 0 }),
        respondApproval: () => false,
        respondQuestion: () => false,
        stop: () => {
            stops += 1;
        },
        dispose: () => Promise.resolve()
    };
    const session = new ChatSession({
        info: info(),
        provider: {
            ...claudeProvider,
            createBackend: (_launch, madeHost) => {
                host = madeHost;
                return backend;
            }
        },
        command: ['unused'],
        env: () => ({}),
        emit: () => undefined,
        persist: () => undefined,
        persistSoon: () => undefined,
        ...options
    });
    return { session, sent, start, backend, stops: () => stops, event: (event: BackendEvent) => host.onEvent(event) };
};

describe('a queue behind a usage limit', () => {
    test('an unknown reset preserves the queue without owing an automatic resume', async () => {
        let owed = 0;
        const run = rig({
            limitResume: {
                allowed: () => true,
                now: () => 1000,
                owe: async () => {
                    owed += 1;
                },
                lapse: async () => undefined,
                owed: () => false
            }
        });
        run.session.send('original');
        await flush();
        run.session.send('queued');
        run.event({ type: 'turn.done', state: 'error', costUsd: 0, limit: { kind: 'usage' }, error: 'reset unknown' });
        await flush();
        expect(owed).toBe(0);
        expect(run.session.info.resumeAt).toBeUndefined();
        expect(run.session.info.queuePaused).toBe(true);
        expect(run.session.info.queue?.map((message) => message.text)).toEqual(['queued']);
        expect(run.sent.map((input) => input.text)).toEqual(['original']);
        expect(run.session.sendNow(run.session.info.queue![0]!.id)).toBe(true);
        await flush();
        expect(run.sent[1]?.text).toBe('queued');
        await run.session.dispose();
    });

    for (const allowed of [false, true]) {
        test(`waits across a restart with automatic resume ${allowed}`, async () => {
            let owed = 0;
            const hooks = {
                allowed: () => allowed,
                now: () => 1000,
                owe: async () => {
                    owed += 1;
                },
                lapse: async () => {
                    owed = 0;
                },
                owed: () => owed > 0
            };
            const first = rig({ limitResume: hooks });
            first.session.send('original');
            await flush();
            const limitedId = first.session.info.activeTurnId!;
            first.session.send('queued one');
            first.session.send('queued two');
            first.event({ type: 'turn.done', state: 'error', costUsd: 0, limit: { kind: 'usage', resetsAt: 100000 }, error: 'limit' });
            await flush();
            expect(first.sent.map((input) => input.text)).toEqual(['original']);
            expect(first.session.info.queue?.map((message) => message.text)).toEqual(['queued one', 'queued two']);
            expect(first.session.info.resumeAt).toBe(allowed ? 100000 : undefined);
            const second = rig({ info: structuredClone(first.session.info), items: structuredClone(first.session.thread.list()), limitResume: hooks });
            second.session.settleStored(second.session.info.selection, { resumeTurnId: null, reason: null });
            second.session.settleOwedResume();
            await flush();
            expect(second.sent).toEqual([]);
            if (allowed) {
                expect(second.session.takeUpAfterLimit(limitedId)).toBe(true);
                expect(second.session.takeUpAfterLimit(limitedId)).toBe(false);
                await flush();
                expect(second.sent).toHaveLength(1);
                second.event({ type: 'turn.done', state: 'done', costUsd: 0 });
                await flush();
                expect(second.sent[1]?.text).toBe('queued one');
                second.event({ type: 'turn.done', state: 'done', costUsd: 0 });
                await flush();
                expect(second.sent[2]?.text).toBe('queued two');
            } else {
                expect(second.session.sendNow(second.session.info.queue![0]!.id)).toBe(true);
                await flush();
                expect(second.sent[0]?.text).toBe('queued one');
            }
            await first.session.dispose();
            await second.session.dispose();
        });
    }
});

describe('Stop while a turn is starting', () => {
    for (const stage of ['handshake', 'checkpoint']) {
        test(`stops without waiting for the ${stage} and ignores its late completion`, async () => {
            const checkpoint = Promise.withResolvers<string | null>();
            const blocked = rig(
                stage === 'checkpoint'
                    ? {
                          checkpoints: {
                              take: () => checkpoint.promise,
                              diff: async () => null,
                              settle: async () => null
                          }
                      }
                    : {},
                stage === 'handshake'
            );
            blocked.session.send('never send this');
            await flush();
            blocked.session.cancel();
            await flush();
            expect(blocked.stops()).toBe(1);
            expect(blocked.session.info.activeTurnId).toBeNull();
            expect(blocked.session.thread.list().find((item) => item.kind === 'turn')).toMatchObject({ state: 'aborted' });
            blocked.start.resolve();
            checkpoint.resolve('late-tree');
            await flush();
            expect(blocked.sent).toEqual([]);
            expect(blocked.session.info.status).toBe('idle');
            await blocked.session.dispose();
        });
    }

    test('warns about a stuck start without killing it or timing out an accepted turn', async () => {
        const clock = new ManualClock();
        const blocked = rig({ clock } as Partial<ChatSessionOptions>, true);
        blocked.session.send('go');
        clock.advance(60000);
        expect(blocked.session.thread.list().some((item) => item.kind === 'note' && item.level === 'warning')).toBe(true);
        expect(blocked.stops()).toBe(0);
        blocked.start.resolve();
        await flush();
        clock.advance(3600000);
        expect(blocked.stops()).toBe(0);
        expect(blocked.session.info.activeTurnId).not.toBeNull();
        await blocked.session.dispose();
    });

    test('a rejected handshake visibly fails the turn', async () => {
        const blocked = rig({}, true);
        blocked.session.send('go');
        blocked.start.reject(new Error('handshake refused'));
        await flush();
        expect(blocked.session.info.status).toBe('error');
        expect(blocked.session.thread.list().some((item) => item.kind === 'note' && item.text.includes('handshake refused'))).toBe(true);
        await blocked.session.dispose();
    });
});

describe('a queue after Stop or failure', () => {
    test('a message sent while the Stop acknowledgement is still arriving explicitly continues the queue', async () => {
        const run = rig();
        run.backend.interrupt = () => undefined;
        run.session.send('original');
        await flush();
        run.session.cancel();
        run.session.send('continue');
        expect(run.sent).toHaveLength(1);
        run.event({ type: 'turn.done', state: 'aborted', costUsd: 0 });
        await flush();
        expect(run.sent.map((input) => input.text)).toEqual(['original', 'continue']);
        await run.session.dispose();
    });
    test('a CLI permission fallback updates and persists the effective mode without changing the selected one', async () => {
        let saves = 0;
        const run = rig({
            info: { ...info(), runtimeMode: 'auto' },
            persist: () => {
                saves += 1;
            }
        });
        run.session.send('go');
        await flush();
        run.event({ type: 'session', agentSessionId: 'sid', model: 'haiku', permissionMode: 'auto', effectiveRuntimeMode: 'auto' });
        const before = saves;
        run.event({ type: 'permissions', permissionMode: 'default', effectiveRuntimeMode: 'supervised' });
        expect(run.session.info).toMatchObject({ runtimeMode: 'auto', effectiveRuntimeMode: 'supervised', permissionMode: 'default' });
        expect(saves).toBeGreaterThan(before);
        await run.session.dispose();
    });
    for (const end of ['stop', 'error', 'exit'] as const) {
        test(`holds after ${end}, across reload, until an explicit send`, async () => {
            const first = rig();
            first.session.send('original');
            await flush();
            first.session.send('one');
            first.session.send('two');
            if (end === 'stop') {
                first.session.cancel();
            } else {
                first.event(end === 'exit' ? { type: 'exit', exitCode: 1 } : { type: 'turn.done', state: 'error', costUsd: 0, error: 'failed' });
            }
            await flush();
            expect(first.sent.map((input) => input.text)).toEqual(['original']);
            expect(first.session.info.queuePaused).toBe(true);
            const second = rig({ info: structuredClone(first.session.info), items: structuredClone(first.session.thread.list()) });
            second.session.settleStored(second.session.info.selection, { resumeTurnId: null, reason: null });
            await flush();
            expect(second.sent).toEqual([]);
            second.session.send('three');
            await flush();
            expect(second.sent.map((input) => input.text)).toEqual(['one']);
            expect(second.session.info.queuePaused).toBe(false);
            for (const text of ['two', 'three']) {
                second.event({ type: 'turn.done', state: 'done', costUsd: 0 });
                await flush();
                expect(second.sent.at(-1)?.text).toBe(text);
            }
            await first.session.dispose();
            await second.session.dispose();
        });
    }

    test('Send now interrupts the current turn and continues with the selected queued message', async () => {
        const run = rig();
        run.session.send('original');
        await flush();
        run.session.send('one');
        run.session.send('two');
        expect(run.session.sendNow(run.session.info.queue![1]!.id)).toBe(true);
        await flush();
        expect(run.sent.map((input) => input.text)).toEqual(['original', 'two']);
        run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        await flush();
        expect(run.sent.map((input) => input.text)).toEqual(['original', 'two', 'one']);
        await run.session.dispose();
    });
});

describe('a resume before CLI acceptance', () => {
    test('writes its attempt and note before start, retaining one attempt across a failed start and retry', async () => {
        const failed = rig({}, true);
        failed.session.send('original');
        await flush();
        const turnId = failed.session.info.activeTurnId!;
        await failed.session.dispose();
        const saved = Promise.withResolvers<void>();
        const run = rig({ info: structuredClone(failed.session.info), items: structuredClone(failed.session.thread.list()), save: () => saved.promise }, true);
        const words = { prompt: 'continue', note: 'Resuming after restart', preamble: null };
        const attempt = run.session.resume(turnId, 2, words);
        expect(run.session.thread.get(turnId)).toMatchObject({ attempt: 2, resumePending: true });
        expect(run.session.thread.get(`resume-${turnId}-2`)).toMatchObject({ text: words.note });
        expect(run.session.running).toBe(false);
        saved.resolve();
        await flush();
        run.start.reject(new Error('start failed'));
        await expect(attempt).rejects.toThrow('start failed');
        expect(run.sent).toEqual([]);
        const retry = rig({ info: structuredClone(run.session.info), items: structuredClone(run.session.thread.list()) });
        await retry.session.resume(turnId, 2, words);
        await retry.session.resume(turnId, 2, words);
        expect(retry.sent).toHaveLength(1);
        expect(retry.session.thread.get(turnId)).toMatchObject({ attempt: 2 });
        expect(retry.session.thread.get(turnId)).not.toHaveProperty('resumePending', true);
        expect(retry.session.thread.list().filter((item) => item.id === `resume-${turnId}-2`)).toHaveLength(1);
        await run.session.dispose();
        await retry.session.dispose();
    });
});

test('a launched workflow stays open, warns on stalled progress and clears its warning on new progress', async () => {
    const clock = new ManualClock();
    const run = rig({ clock });
    const stopped: string[] = [];
    run.backend.stopTask = (taskId) => {
        stopped.push(taskId);
    };
    run.session.send('launch');
    await flush();
    run.event({ type: 'tool.started', ref: 'workflow', name: 'Workflow', input: {}, parentRef: null });
    run.event({ type: 'tool.done', ref: 'workflow', state: 'done', output: 'Workflow launched in background. Task ID: wf' });
    run.event({ type: 'workflow.progress', ref: 'workflow', workflow: { name: 'Build', taskId: 'wf', phases: [], agents: [] } });
    run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
    const workflow = () => run.session.thread.list().find((item) => item.kind === 'tool' && item.name === 'Workflow');
    expect(workflow()).toMatchObject({ state: 'running' });
    clock.advance(5 * 60_000);
    expect(workflow()).toMatchObject({ state: 'running', workflow: { stalledAt: clock.now() } });
    expect(run.stops()).toBe(0);
    run.session.stopTask('wf');
    expect(stopped).toEqual(['wf']);
    expect(workflow()).toMatchObject({ state: 'running' });
    run.event({ type: 'workflow.progress', ref: 'workflow', workflow: { name: 'Build', phases: [], agents: [] } });
    expect(workflow()).toMatchObject({ workflow: { name: 'Build', stalledAt: undefined, lastProgressAt: clock.now() } });
    clock.advance(4 * 60_000);
    expect(workflow()).toMatchObject({ workflow: { stalledAt: undefined } });
    run.event({ type: 'task.done', ref: 'workflow', taskId: 'wf', ok: true, summary: 'finished' });
    clock.advance(60 * 60_000);
    expect(workflow()).toMatchObject({ state: 'done' });
    expect(() => run.session.stopTask('wf')).toThrow('no such task');
    expect(run.stops()).toBe(0);
    await run.session.dispose();
});

describe('background work recovered from a stored chat', () => {
    const main: import('@ruimte/agent-contracts').ChatTurnItem = {
        id: 'main',
        turnId: 'main',
        kind: 'turn',
        createdAt: 1,
        endedAt: 2,
        state: 'done',
        costUsd: 0
    };
    const row: import('@ruimte/agent-contracts').ChatSubagentItem = {
        id: 'worker',
        kind: 'subagent',
        turnId: 'main',
        createdAt: 1,
        toolUseId: 'native-worker',
        description: 'Native worker',
        subagentType: null,
        prompt: null,
        status: 'running',
        background: true,
        summary: null,
        result: null,
        startedAt: 1,
        finishedAt: null,
        usage: null,
        lastTool: null,
        itemsTruncated: false
    };
    test('a lost workflow and native agent keep one durable notice for the next provider prompt', async () => {
        const first = rig({
            items: [
                main,
                row,
                {
                    id: 'wf',
                    turnId: 'main',
                    kind: 'tool',
                    createdAt: 1,
                    toolUseId: 'workflow',
                    name: 'Workflow',
                    input: {},
                    output: 'launched',
                    state: 'running',
                    parentToolUseId: null
                }
            ]
        });
        first.session.settleStored(first.session.info.selection, { resumeTurnId: null, reason: null });
        await first.session.settleOrphanedSubagents();
        expect(first.session.thread.get('worker')).toMatchObject({ status: 'failed' });
        expect(first.session.thread.get('wf')).toMatchObject({ state: 'error' });
        expect(first.session.preambles).toHaveLength(2);
        const second = rig({
            info: structuredClone(first.session.info),
            items: structuredClone(first.session.thread.list()),
            preambles: [...first.session.preambles]
        });
        second.session.settleStored(second.session.info.selection, { resumeTurnId: null, reason: null });
        await second.session.settleOrphanedSubagents();
        expect(second.session.preambles).toHaveLength(2);
        second.session.send('continue');
        await flush();
        expect(second.sent[0]?.preamble).toContain('will not send a result');
        expect(second.sent[0]?.preamble).toContain('Native worker');
        expect(second.sent[0]?.preamble).toContain('Workflow');
        expect(second.session.preambles).toHaveLength(0);
        await first.session.dispose();
        await second.session.dispose();
    });

    test('a completed native transcript is recovered before deciding the work was lost', async () => {
        const recovered = rig({ items: [main, row], subagentSettlement: async () => ({ report: 'finished work', finishedAt: 3 }) });
        recovered.session.settleStored(recovered.session.info.selection, { resumeTurnId: null, reason: null });
        await recovered.session.settleOrphanedSubagents();
        expect(recovered.session.thread.get('worker')).toMatchObject({ status: 'done', result: 'finished work' });
        expect(recovered.session.preambles).toEqual([]);
        await recovered.session.dispose();
    });
});

describe('subagents still at work after the turn', () => {
    test('say so on the info until the last one settles, once per change', async () => {
        const infos: ChatInfo[] = [];
        const run = rig({ emit: (event) => (event.type === 'info' ? infos.push(event.info) : undefined) });
        run.session.send('go');
        await flush();
        run.event({
            type: 'tool.started',
            ref: 'toolu_agent',
            name: 'Agent',
            input: { description: 'Scan', subagent_type: 'Explore', prompt: 'look around', run_in_background: true },
            parentRef: null
        });
        run.event({ type: 'task.started', ref: 'toolu_agent', description: 'Scan', subagentType: 'Explore', prompt: null, background: true });
        run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        expect(run.session.info).toMatchObject({ status: 'idle', delegating: true });
        const said = infos.length;
        run.event({ type: 'task.progress', ref: 'toolu_agent', summary: 'Running Grep', lastTool: 'Grep', usage: null });
        expect(infos).toHaveLength(said);
        run.event({ type: 'task.done', ref: 'toolu_agent', summary: 'Found it', ok: true });
        expect(run.session.info.delegating).toBeUndefined();
        await run.session.dispose();
    });
});

describe('provider acceptance of a wake', () => {
    test('persists before sending and clears delivery only for its own acknowledgement', async () => {
        const saved = Promise.withResolvers<void>();
        const run = rig({ save: () => saved.promise });
        Object.defineProperty(run.backend, 'acknowledgesTurns', { value: true });
        const turnId = run.session.wake({ text: 'settled result', label: 'Task', taskIds: ['task'] })!;
        await flush();
        expect(run.sent).toEqual([]);
        expect(run.session.thread.get(turnId)).toMatchObject({ deliveryPending: true });
        saved.resolve();
        await flush();
        expect(run.sent).toHaveLength(1);
        run.event({ type: 'turn.accepted', promptId: 'foreign' });
        expect(run.session.thread.get(turnId)).toMatchObject({ deliveryPending: true });
        run.event({ type: 'turn.accepted', promptId: run.sent[0]!.promptId! });
        expect(run.session.thread.get(turnId)).not.toHaveProperty('deliveryPending', true);
        run.event({ type: 'turn.done', state: 'error', costUsd: 0 });
        expect(run.session.thread.get(turnId)).toMatchObject({ state: 'error' });
        await run.session.dispose();
    });

    for (const failure of ['start', 'write', 'exit']) {
        test(`keeps results and consumed notices across a ${failure} failure and restart`, async () => {
            let notices = ['A native task was lost', 'A message from another node'];
            const first = rig({ promptNotes: { next: () => ({ shown: [], heard: notices.splice(0) }), reset: () => undefined } }, failure === 'start');
            Object.defineProperty(first.backend, 'acknowledgesTurns', { value: true });
            if (failure === 'write') {
                first.backend.sendTurn = () => {
                    throw new Error('broken pipe');
                };
            }
            const turnId = first.session.wake({ text: 'result', label: 'Task', taskIds: ['task'] })!;
            if (failure === 'start') {
                first.start.reject(new Error('failed start'));
            }
            await flush();
            if (failure === 'exit') {
                first.event({ type: 'exit', exitCode: 1 });
            }
            expect(first.session.thread.get(turnId)).toMatchObject({ state: 'error', deliveryPending: true });
            expect(first.session.preambles.join('\n')).toContain('A message from another node');
            const second = rig({
                info: structuredClone(first.session.info),
                items: structuredClone(first.session.thread.list()),
                preambles: [...first.session.preambles]
            });
            second.session.send('continue consciously');
            await flush();
            expect(second.sent[0]?.preamble).toContain('A native task was lost');
            expect(second.sent[0]?.preamble).toContain('A message from another node');
            expect(second.session.preambles).toEqual([]);
            second.session.clear(true);
            expect(second.session.preambles).toEqual([]);
            await first.session.dispose();
            await second.session.dispose();
        });
    }
});

test('a legacy result proves wake acceptance, while a failed durable save sends nothing', async () => {
    const legacy = rig();
    Object.defineProperty(legacy.backend, 'acknowledgesTurns', { value: true });
    const turnId = legacy.session.wake({ text: 'result', label: 'Task', taskIds: ['task'] })!;
    await flush();
    legacy.event({ type: 'turn.done', state: 'done', costUsd: 0 });
    expect(legacy.session.thread.get(turnId)).not.toHaveProperty('deliveryPending', true);
    const failed = rig({
        save: async () => {
            throw new Error('disk full');
        }
    });
    const failedTurn = failed.session.wake({ text: 'result', label: 'Task', taskIds: ['task'] })!;
    await flush();
    expect(failed.sent).toEqual([]);
    expect(failed.session.thread.get(failedTurn)).toMatchObject({ state: 'error', deliveryPending: true });
    await legacy.session.dispose();
    await failed.session.dispose();
});

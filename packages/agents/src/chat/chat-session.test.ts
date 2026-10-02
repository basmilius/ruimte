import { describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/agent-contracts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { claudeProvider } from '../providers/claude-provider.ts';
import { codexProvider } from '../providers/codex-provider.ts';
import type { BackendEvent, BackendHost, BackendLaunch, ChatBackend, TurnInput } from './backend.ts';
import { ChatSession, type ChatSessionOptions } from './chat-session.ts';
import { ClaudeProtocol } from './claude-protocol.ts';

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

const replacementRig = (provider = claudeProvider, options: Partial<ChatSessionOptions> = {}) => {
    let folders: readonly string[] = [];
    let failNextStart = false;
    const instances: {
        launch: BackendLaunch;
        host: BackendHost;
        stopped: boolean;
        sent: TurnInput[];
        requests: Set<string>;
    }[] = [];
    const session = new ChatSession({
        info: { ...info(), provider: provider.kind, selection: provider.catalog.normalize(undefined) },
        command: ['unused'],
        env: (account) => ({ PROBE_ACCOUNT: account ?? 'default' }),
        emit: () => undefined,
        persist: () => undefined,
        persistSoon: () => undefined,
        folders: () => folders,
        ...options,
        provider: {
            ...provider,
            createBackend: (launch, host) => {
                const instance = { launch, host, stopped: false, sent: [] as TurnInput[], requests: new Set<string>() };
                instances.push(instance);
                const fail = failNextStart;
                failNextStart = false;
                const backend: ChatBackend = {
                    get running() {
                        return !instance.stopped;
                    },
                    pid: null,
                    start: () => (fail ? Promise.reject(new Error('replacement cannot start')) : Promise.resolve()),
                    sendTurn: (input) => {
                        instance.sent.push(input);
                    },
                    compact: () => undefined,
                    interrupt: () => host.onEvent({ type: 'turn.done', state: 'aborted', costUsd: 0 }),
                    respondApproval: (requestId) => !instance.stopped && instance.requests.delete(requestId),
                    respondQuestion: (requestId) => !instance.stopped && instance.requests.delete(requestId),
                    stop: () => {
                        instance.stopped = true;
                    },
                    dispose: async () => {
                        instance.stopped = true;
                    }
                };
                return backend;
            }
        }
    });
    const event = (frame: BackendEvent, index = instances.length - 1) => {
        const instance = instances[index]!;
        if (frame.type === 'approval.requested' || frame.type === 'question.requested') {
            instance.requests.add(frame.requestId);
        }
        instance.host.onEvent(frame);
    };
    const agent = () =>
        event({ type: 'task.started', ref: 'agent', taskId: 'native-agent', description: 'Research', subagentType: null, prompt: null, background: true });
    const done = () => event({ type: 'turn.done', state: 'done', costUsd: 0 });
    return {
        session,
        instances,
        event,
        agent,
        done,
        setFolders: (value: readonly string[]) => {
            folders = value;
        },
        failNext: () => {
            failNextStart = true;
        }
    };
};

describe('backend replacement with live work', () => {
    for (const change of ['model', 'options', 'mode', 'account', 'folders'] as const) {
        test(`${change} waits for the child, its approval and Claude's final report`, async () => {
            const run = replacementRig();
            run.session.send('start research');
            await flush();
            run.agent();
            run.event({
                type: 'approval.requested',
                requestId: 'permission',
                ref: 'write',
                toolName: 'Write',
                input: {},
                description: null,
                canAllowAlways: false,
                background: true
            });
            run.done();
            if (change === 'model') {
                run.session.configure({ selection: { model: 'haiku', options: {} } });
            }
            if (change === 'options') {
                run.session.configure({ selection: { ...run.session.info.selection, options: { ...run.session.info.selection.options, effort: 'low' } } });
            }
            if (change === 'mode') {
                run.session.configure({ runtimeMode: 'auto' });
            }
            if (change === 'account') {
                run.session.setAccount('other');
            }
            if (change === 'folders') {
                run.setFolders(['/extra']);
            }
            const queued = run.session.send('after research', { mentions: ['mention'], skills: ['skill'] });
            expect(queued.queued).toBe(true);
            expect(run.session.info.activeTurnId).toBeNull();
            expect(run.session.info.status).toBe('needs-you');
            expect(run.instances).toHaveLength(1);
            expect(run.instances[0]!.stopped).toBe(false);
            expect(run.session.approve('permission', 'deny')).toBe(true);
            expect(run.session.wake({ text: 'task result', label: 'task result', taskIds: ['task'] })).toBeNull();
            run.event({ type: 'task.done', ref: 'agent', taskId: 'native-agent', summary: 'Research complete', ok: true });
            expect(run.instances).toHaveLength(1);
            expect(run.session.sendNow(run.session.info.queue![0]!.id)).toBe(true);
            await flush();
            expect(run.instances).toHaveLength(1);
            run.event({ type: 'text.done', ref: 'report', text: 'The research is complete', parentRef: null });
            run.done();
            await flush();
            expect(run.instances).toHaveLength(2);
            expect(run.instances[0]!.stopped).toBe(true);
            const current = run.instances[1]!;
            expect(current.sent).toHaveLength(1);
            expect(current.sent[0]).toMatchObject({ text: 'after research', mentions: ['mention'], skills: ['skill'] });
            expect(run.session.info.activeTurnId).toBe(queued.turnId);
            expect(run.session.thread.find('subagent', (item) => item.toolUseId === 'agent')?.status).toBe('done');
            expect(run.session.thread.pending()).toEqual([]);
            if (change === 'model') {
                expect(current.launch.selection.model).toBe(claudeProvider.catalog.normalize({ model: 'haiku', options: {} }).model);
            }
            if (change === 'options') {
                expect(current.launch.selection.options.effort).toBe('low');
            }
            if (change === 'mode') {
                expect(current.launch.runtimeMode).toBe('auto');
            }
            if (change === 'account') {
                expect(current.launch.env.PROBE_ACCOUNT).toBe('other');
            }
            if (change === 'folders') {
                expect(current.launch.folders).toEqual(['/extra']);
            }
            run.event({ type: 'exit', exitCode: 0 }, 0);
            expect(run.session.info.activeTurnId).toBe(queued.turnId);
            run.done();
            await run.session.dispose();
        });
    }

    for (const work of ['command', 'workflow'] as const) {
        test(`replacement waits for a ${work} and its native report`, async () => {
            const run = replacementRig();
            run.session.send('start work');
            await flush();
            if (work === 'command') {
                run.event({ type: 'background.started', taskId: 'work', ref: null, monitor: false, description: 'build' });
            } else {
                run.event({ type: 'tool.started', ref: 'work', name: 'Workflow', input: {}, parentRef: null });
                run.event({ type: 'workflow.progress', ref: 'work', workflow: { name: 'Research', taskId: 'work', phases: [], agents: [] } });
                run.event({ type: 'tool.done', ref: 'work', state: 'done', output: 'Workflow launched in background. Task ID: work' });
            }
            run.done();
            run.session.configure({ runtimeMode: 'auto' });
            expect(run.session.send('next').queued).toBe(true);
            if (work === 'command') {
                run.event({ type: 'background.ended', taskId: 'work' });
            } else {
                run.event({ type: 'task.done', ref: 'work', taskId: 'work', summary: 'complete', ok: true });
            }
            await flush();
            expect(run.instances).toHaveLength(1);
            run.event({ type: 'text.done', ref: 'report', text: 'Work complete', parentRef: null });
            run.done();
            await flush();
            expect(run.instances).toHaveLength(2);
            expect(run.instances[1]!.sent[0]?.text).toBe('next');
            await run.session.dispose();
        });
    }

    test('a Codex child completion releases the queue without waiting for a native report', async () => {
        const run = replacementRig(codexProvider);
        run.session.send('start research');
        await flush();
        run.agent();
        run.done();
        run.session.configure({ runtimeMode: 'auto' });
        expect(run.session.send('next').queued).toBe(true);
        run.event({ type: 'task.done', ref: 'agent', taskId: 'native-agent', summary: 'Complete', ok: true });
        await flush();
        expect(run.instances).toHaveLength(2);
        expect(run.instances[1]!.sent[0]?.text).toBe('next');
        await run.session.dispose();
    });

    test('switching back to the running selection uses its process while the child continues', async () => {
        const run = replacementRig();
        const original = run.session.info.selection;
        run.session.send('start research');
        await flush();
        run.agent();
        run.done();
        run.session.configure({ selection: { model: 'haiku', options: {} } });
        expect(run.session.send('next').queued).toBe(true);
        run.session.configure({ selection: original });
        await flush();
        expect(run.instances).toHaveLength(1);
        expect(run.instances[0]!.stopped).toBe(false);
        expect(run.instances[0]!.sent.map((input) => input.text)).toEqual(['start research', 'next']);
        await run.session.dispose();
    });

    test('work launched after a settings change still holds the next queued message', async () => {
        const run = replacementRig();
        run.session.send('start');
        await flush();
        run.session.configure({ runtimeMode: 'auto' });
        run.session.send('next');
        run.agent();
        run.done();
        await flush();
        expect(run.instances).toHaveLength(1);
        expect(run.instances[0]!.stopped).toBe(false);
        expect(run.session.info.queue?.map((input) => input.text)).toEqual(['next']);
        await run.session.dispose();
    });

    test('ordinary Stop keeps live children and ending the process or Clear explicitly retires them', async () => {
        for (const action of ['stop', 'end', 'clear'] as const) {
            const run = replacementRig();
            run.session.send('start');
            await flush();
            run.agent();
            run.done();
            run.session.configure({ runtimeMode: 'auto' });
            run.session.send('next');
            if (action === 'stop') {
                run.session.cancel();
                expect(run.instances[0]!.stopped).toBe(false);
                expect(run.session.thread.find('subagent', (item) => item.toolUseId === 'agent')?.status).toBe('running');
                expect(run.session.info.queue).toHaveLength(1);
            } else {
                if (action === 'end') {
                    run.session.end('Stopped with its children');
                    expect(run.session.thread.find('subagent', (item) => item.toolUseId === 'agent')?.status).toBe('failed');
                } else {
                    run.session.clear(true);
                    expect(run.session.thread.list()).toEqual([]);
                }
                expect(run.instances[0]!.stopped).toBe(true);
                expect(run.session.info.queue).toEqual([]);
                run.session.send('fresh prompt');
                await flush();
                expect(run.instances[1]!.sent[0]?.text).toBe('fresh prompt');
            }
            await run.session.dispose();
        }
    });

    test('native compaction refuses a settings replacement without opening a turn', async () => {
        const run = replacementRig(codexProvider);
        run.session.send('start');
        await flush();
        run.agent();
        run.done();
        run.session.configure({ runtimeMode: 'auto' });
        expect(() => run.session.compact()).toThrow('current work and open requests');
        expect(run.session.info.activeTurnId).toBeNull();
        expect(run.instances[0]!.stopped).toBe(false);
        await run.session.dispose();
    });

    test('a resume that requires replacement keeps live work and its approval', async () => {
        const run = replacementRig();
        const { turnId } = run.session.send('start');
        await flush();
        run.agent();
        run.event({
            type: 'approval.requested',
            requestId: 'permission',
            ref: 'write',
            toolName: 'Write',
            input: {},
            description: null,
            canAllowAlways: false,
            background: true
        });
        run.session.configure({ runtimeMode: 'auto' });
        await expect(run.session.resume(turnId, 2, { prompt: 'resume', note: 'Resume', preamble: null })).rejects.toThrow('current work and open requests');
        await flush();
        expect(run.instances).toHaveLength(1);
        expect(run.instances[0]!.stopped).toBe(false);
        expect(run.session.approve('permission', 'deny')).toBe(true);
        await run.session.dispose();
    });

    test('work discovered while preparing a wake keeps requests and an unaccepted durable preamble', async () => {
        let revealWork = false;
        const run = replacementRig(claudeProvider, {
            promptNotes: {
                next: () => {
                    if (revealWork) {
                        run.agent();
                        run.event({
                            type: 'approval.requested',
                            requestId: 'permission',
                            ref: 'write',
                            toolName: 'Write',
                            input: {},
                            description: null,
                            canAllowAlways: false,
                            background: true
                        });
                    }
                    return { shown: [], heard: ['Important context'] };
                },
                reset: () => undefined
            }
        });
        run.session.send('start');
        await flush();
        run.done();
        run.session.configure({ runtimeMode: 'auto' });
        revealWork = true;
        const wakeId = run.session.wake({ text: 'task result', label: 'Task result', taskIds: ['task'] })!;
        await flush();
        expect(run.instances).toHaveLength(1);
        expect(run.instances[0]!.stopped).toBe(false);
        expect(run.session.thread.get(wakeId)).toMatchObject({ state: 'error', deliveryPending: true });
        expect(run.session.preambles.join('\n')).toContain('Important context');
        expect(run.session.approve('permission', 'deny')).toBe(true);
        run.event({ type: 'task.done', ref: 'agent', taskId: 'native-agent', summary: 'Complete', ok: true });
        run.event({ type: 'text.done', ref: 'report', text: 'Finished', parentRef: null });
        run.done();
        expect(run.session.thread.get(wakeId)).toMatchObject({ deliveryPending: true });
        await run.session.dispose();
    });

    test('a pending native question alone keeps its owner until answered', async () => {
        const run = replacementRig();
        run.session.send('start');
        await flush();
        run.done();
        run.event({
            type: 'question.requested',
            requestId: 'question',
            background: true,
            questions: [{ id: 'file', question: 'Which file?', header: 'File', choices: [], multiSelect: false }]
        });
        run.session.configure({ runtimeMode: 'auto' });
        expect(run.session.send('next').queued).toBe(true);
        expect(run.instances[0]!.stopped).toBe(false);
        expect(run.session.answer('question', { File: 'README.md' })).toBe(true);
        run.event({ type: 'text.done', ref: 'answer', text: 'Finished', parentRef: null });
        run.done();
        await flush();
        expect(run.instances).toHaveLength(2);
        expect(run.session.thread.pending()).toEqual([]);
        await run.session.dispose();
    });

    test('an unexpected exit settles the old owner and leaves the queued prompt for an explicit retry', async () => {
        const run = replacementRig();
        run.session.send('start');
        await flush();
        run.agent();
        run.event({
            type: 'approval.requested',
            requestId: 'permission',
            ref: 'write',
            toolName: 'Write',
            input: {},
            description: null,
            canAllowAlways: false,
            background: true
        });
        run.done();
        run.session.configure({ runtimeMode: 'auto' });
        run.session.send('queued');
        run.event({ type: 'exit', exitCode: 1 });
        await flush();
        expect(run.session.thread.find('subagent', (item) => item.toolUseId === 'agent')?.status).toBe('failed');
        expect(run.session.thread.pending()).toEqual([]);
        expect(run.instances).toHaveLength(1);
        expect(run.session.info.queue?.map((input) => input.text)).toEqual(['queued']);
        run.session.sendNow(run.session.info.queue![0]!.id);
        await flush();
        expect(run.instances).toHaveLength(2);
        expect(run.instances[1]!.sent[0]?.text).toBe('queued');
        await run.session.dispose();
    });

    test('a replacement that cannot start preserves the completed child and unaccepted preamble', async () => {
        const run = replacementRig(claudeProvider, { preambles: ['Important context'] });
        run.session.send('start');
        await flush();
        run.agent();
        run.done();
        run.session.deliverNote({ noteId: 'context', note: 'New context', preamble: 'Keep this context' });
        run.session.configure({ runtimeMode: 'auto' });
        const queued = run.session.send('next');
        run.failNext();
        run.event({ type: 'task.done', ref: 'agent', taskId: 'native-agent', summary: 'Complete', ok: true });
        run.event({ type: 'text.done', ref: 'report', text: 'Finished', parentRef: null });
        run.done();
        await flush();
        expect(run.instances).toHaveLength(2);
        expect(run.instances[1]!.sent).toEqual([]);
        expect(run.session.thread.get(queued.turnId)).toMatchObject({ state: 'error' });
        expect(run.session.preambles.join('\n')).toContain('Keep this context');
        expect(run.session.thread.find('subagent', (item) => item.toolUseId === 'agent')?.status).toBe('done');
        expect(run.session.thread.pending()).toEqual([]);
        await run.session.dispose();
    });
});

for (const unknown of [false, true]) {
    test(`Claude window resets persist before the queue with an unknown window ${unknown}`, async () => {
        const protocol = new ClaudeProtocol();
        const owed: { at: number; resumeAt: number | undefined; queue: string[] }[] = [];
        let persisted: ChatInfo | null = null;
        const run = rig({
            persist: () => {
                persisted = structuredClone(run.session.info);
            },
            limitResume: {
                allowed: () => true,
                now: () => 1000,
                owed: () => owed.length > 0,
                owe: async (_turnId, at) => {
                    owed.push({ at, resumeAt: persisted?.resumeAt, queue: persisted?.queue?.map((entry) => entry.text) ?? [] });
                },
                lapse: async () => undefined
            }
        });
        run.session.send('original');
        await flush();
        protocol.beginPrompt(run.sent[0]!.promptId!);
        run.session.send('queued');
        protocol.handle({
            type: 'rate_limit_event',
            rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day', ...(unknown ? {} : { resetsAt: 900 }) }
        });
        protocol.handle({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 500 } });
        protocol.handle({ type: 'assistant', error: 'rate_limit', message: { id: 'limited', content: [] } });
        for (const event of protocol.handle({
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            user_message_uuids: [run.sent[0]!.promptId!]
        })) {
            run.event(event);
        }
        await flush();
        expect(run.session.info.queuePaused).toBe(true);
        expect(run.sent.map((input) => input.text)).toEqual(['original']);
        if (unknown) {
            expect(owed).toEqual([]);
            expect(run.session.info.resumeAt).toBeUndefined();
        } else {
            expect(owed).toEqual([{ at: 900000, resumeAt: 900000, queue: ['queued'] }]);
            expect(run.session.takeUpAfterLimit(run.session.thread.list().find((item) => item.kind === 'turn')!.id)).toBe(true);
            await flush();
            expect(run.sent).toHaveLength(2);
            expect(run.sent[1]?.text).not.toBe('queued');
            run.event({ type: 'turn.done', state: 'done', costUsd: 0 });
            await flush();
            expect(run.sent[2]?.text).toBe('queued');
        }
        await run.session.dispose();
    });
}

describe('ids across a restart of the host', () => {
    const codexRig = (chatInfo: ChatInfo, items: ChatItem[]) => {
        let host: BackendHost | null = null;
        const generations: number[] = [];
        const session = new ChatSession({
            info: chatInfo,
            items,
            provider: {
                ...codexProvider,
                createBackend: (launch, madeHost) => {
                    host = madeHost;
                    generations.push(launch.generation);
                    return {
                        running: true,
                        pid: null,
                        start: () => Promise.resolve(),
                        sendTurn: () => undefined,
                        compact: () => undefined,
                        interrupt: () => undefined,
                        respondApproval: () => true,
                        respondQuestion: () => true,
                        stop: () => undefined,
                        dispose: () => Promise.resolve()
                    };
                }
            },
            command: ['unused'],
            env: () => ({}),
            emit: () => undefined,
            persist: () => undefined,
            persistSoon: () => undefined
        });
        return { session, generations, event: (event: BackendEvent) => host!.onEvent(event) };
    };
    // Codex numbers the requests of every process from 0, and the backend names one after its generation.
    const approval = (generation: number): BackendEvent => ({
        type: 'approval.requested',
        requestId: `${generation}-0`,
        ref: 'call_x',
        toolName: 'Bash',
        input: { command: 'ls' },
        description: null,
        canAllowAlways: false
    });

    test('an approval of a CLI started after a restart lands after the old one and leaves its decision alone', async () => {
        const first = codexRig({ ...info(), provider: 'codex', selection: codexProvider.catalog.normalize(undefined), agentSessionId: 'thread-1' }, []);
        first.session.send('one');
        await flush();
        first.event(approval(first.generations[0]!));
        const oldId = `${first.generations[0]}-0`;
        first.session.approve(oldId, 'allow');
        first.event({ type: 'turn.done', state: 'done', costUsd: 0 });
        await flush();
        await first.session.dispose();

        const second = codexRig(structuredClone(first.session.info), structuredClone(first.session.thread.list()));
        second.session.settleStored(second.session.info.selection, { resumeTurnId: null, reason: null });
        second.session.send('two');
        await flush();
        second.event(approval(second.generations[0]!));
        const newId = `${second.generations[0]}-0`;

        expect(newId).not.toBe(oldId);
        expect(second.session.thread.list().at(-1)).toMatchObject({ kind: 'approval', requestId: newId, decision: 'pending' });
        expect(second.session.thread.get(`approval-${oldId}`)).toMatchObject({ decision: 'allow' });
        await second.session.dispose();
    });
});

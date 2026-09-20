import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OutboxStore, type OutboxEntry, type OutboxWork } from './outbox.ts';
import { ManualClock } from './manual-clock.ts';
import { OutboxWorker, RETRY_DELAYS_MS } from './outbox-worker.ts';

const work = (node: 'chat' | 'terminal' = 'chat'): OutboxWork => ({ kind: 'start-agent', payload: { node, provider: 'claude', cwd: null } });

const unused = (): never => {
    throw new Error('no resume in these tests');
};

let home: string;
let store: OutboxStore;
let clock: ManualClock;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-outbox-'));
    store = new OutboxStore(home);
    clock = new ManualClock();
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const filesOnDisk = async (): Promise<string[]> => readdir(store.dir).catch(() => []);

test('an entry is on disk until its work is done, and then it is gone', async () => {
    const seen: string[] = [];
    let release: () => void = () => undefined;
    const worker = new OutboxWorker({
        store,
        clock,
        handlers: {
            'deliver-message': () => Promise.reject(new Error('no messages in these tests')),
            'run-flow': () => Promise.reject(new Error('no flows run in these tests')),
            'flow-trigger': () => Promise.reject(new Error('no flows run in these tests')),
            'deliver-summary': () => Promise.reject(new Error('no summaries in these tests')),
            'give-task': () => Promise.reject(new Error('no tasks are given in these tests')),
            'resume-run': unused,
            'wake-parent': unused,
            'end-children': unused,
            'start-agent': (entry) => {
                seen.push(entry.target);
                return new Promise((resolve) => {
                    release = resolve;
                });
            }
        }
    });
    worker.start();
    await worker.enqueue('project', 'chat-1', work());
    expect(seen).toEqual(['chat-1']);
    expect(await filesOnDisk()).toHaveLength(1);
    release();
    await worker.settled();
    expect(await filesOnDisk()).toEqual([]);
    expect(store.list()).toEqual([]);
});

test('what an earlier run owed is started once after a restart, and not again after the next one', async () => {
    // The verb wrote its entry and the daemon went down before the worker got to it.
    await store.put('project', 'terminal-1', work('terminal'), clock.now());

    const runs: string[] = [];
    const restart = async (): Promise<OutboxWorker> => {
        const reloaded = new OutboxStore(home);
        await reloaded.load();
        const worker = new OutboxWorker({
            store: reloaded,
            clock,
            handlers: {
                'deliver-message': () => Promise.reject(new Error('no messages in these tests')),
                'run-flow': () => Promise.reject(new Error('no flows run in these tests')),
                'flow-trigger': () => Promise.reject(new Error('no flows run in these tests')),
                'deliver-summary': () => Promise.reject(new Error('no summaries in these tests')),
                'give-task': () => Promise.reject(new Error('no tasks are given in these tests')),
                'resume-run': unused,
                'wake-parent': unused,
                'end-children': unused,
                'start-agent': async (entry) => {
                    runs.push(entry.target);
                }
            }
        });
        worker.start();
        await worker.settled();
        return worker;
    };

    await restart();
    expect(runs).toEqual(['terminal-1']);
    await restart();
    expect(runs).toEqual(['terminal-1']);
});

test('entries for one target run one after the other, oldest first, while other targets do not wait', async () => {
    const order: string[] = [];
    const releases = new Map<string, () => void>();
    let secondStarted: () => void = () => undefined;
    const second = new Promise<void>((resolve) => {
        secondStarted = resolve;
    });
    const worker = new OutboxWorker({
        store,
        clock,
        handlers: {
            'deliver-message': () => Promise.reject(new Error('no messages in these tests')),
            'run-flow': () => Promise.reject(new Error('no flows run in these tests')),
            'flow-trigger': () => Promise.reject(new Error('no flows run in these tests')),
            'deliver-summary': () => Promise.reject(new Error('no summaries in these tests')),
            'give-task': () => Promise.reject(new Error('no tasks are given in these tests')),
            'resume-run': unused,
            'wake-parent': unused,
            'end-children': unused,
            'start-agent': (entry) => {
                const key = `${entry.target}:${entry.payload.node}`;
                order.push(key);
                if (key === 'node-a:terminal') {
                    secondStarted();
                }
                return new Promise((resolve) => {
                    releases.set(key, resolve);
                });
            }
        }
    });
    await store.put('project', 'node-a', work('chat'), clock.now());
    clock.advance(1);
    await store.put('project', 'node-a', work('terminal'), clock.now());
    clock.advance(1);
    await store.put('project', 'node-b', work('chat'), clock.now());
    worker.start();
    expect(order).toEqual(['node-a:chat', 'node-b:chat']);

    releases.get('node-a:chat')!();
    await second;
    expect(order).toEqual(['node-a:chat', 'node-b:chat', 'node-a:terminal']);
    releases.get('node-a:terminal')!();
    releases.get('node-b:chat')!();
    await worker.settled();
    expect(store.list()).toEqual([]);
});

test('a failure waits 1, 5 and 30 seconds on the clock and is then given up on', async () => {
    let attempts = 0;
    const parked: OutboxEntry[] = [];
    const worker = new OutboxWorker({
        store,
        clock,
        handlers: {
            'deliver-message': () => Promise.reject(new Error('no messages in these tests')),
            'run-flow': () => Promise.reject(new Error('no flows run in these tests')),
            'flow-trigger': () => Promise.reject(new Error('no flows run in these tests')),
            'deliver-summary': () => Promise.reject(new Error('no summaries in these tests')),
            'give-task': () => Promise.reject(new Error('no tasks are given in these tests')),
            'resume-run': unused,
            'wake-parent': unused,
            'end-children': unused,
            'start-agent': async () => {
                attempts += 1;
                throw new Error('no');
            }
        },
        onParked: (entry) => parked.push(entry)
    });
    worker.start();
    await worker.enqueue('project', 'chat-1', work());
    await worker.settled();
    expect(attempts).toBe(1);

    for (const [index, delay] of RETRY_DELAYS_MS.entries()) {
        clock.advance(delay - 1);
        await worker.settled();
        expect(attempts).toBe(index + 1);
        clock.advance(1);
        await worker.settled();
        expect(attempts).toBe(index + 2);
    }
    expect(parked.map((entry) => [entry.target, entry.attempts])).toEqual([['chat-1', RETRY_DELAYS_MS.length]]);
    expect(store.list()).toEqual([]);
    expect(await filesOnDisk()).toEqual([]);
});

test('a retry that was waiting survives a restart with its attempts', async () => {
    const worker = new OutboxWorker({
        store,
        clock,
        handlers: {
            'deliver-message': () => Promise.reject(new Error('no messages in these tests')),
            'run-flow': () => Promise.reject(new Error('no flows run in these tests')),
            'flow-trigger': () => Promise.reject(new Error('no flows run in these tests')),
            'deliver-summary': () => Promise.reject(new Error('no summaries in these tests')),
            'give-task': () => Promise.reject(new Error('no tasks are given in these tests')),
            'resume-run': unused,
            'wake-parent': unused,
            'end-children': unused,
            'start-agent': async () => {
                throw new Error('no');
            }
        }
    });
    worker.start();
    await worker.enqueue('project', 'chat-1', work());
    await worker.settled();
    worker.stop();

    const reloaded = new OutboxStore(home);
    await reloaded.load();
    expect(reloaded.list().map((entry) => [entry.attempts, entry.notBefore - clock.now()])).toEqual([[1, RETRY_DELAYS_MS[0]]]);
});

test('pruning drops what a project owed for nodes it no longer places', async () => {
    await store.put('project', 'kept', work(), clock.now());
    await store.put('project', 'gone', work(), clock.now());
    await store.put('other', 'gone', work(), clock.now());
    await store.prune('project', new Set(['kept']));
    expect(store.list().map((entry) => [entry.projectId, entry.target])).toEqual([
        ['project', 'kept'],
        ['other', 'gone']
    ]);
    expect(await filesOnDisk()).toHaveLength(2);
});

const wakeWork = (taskId: string): OutboxWork => ({ kind: 'wake-parent', payload: { taskId } });

test('an entry that waits keeps its file, costs no attempt, holds no lane and runs again only once its target is woken', async () => {
    let busy = true;
    const runs: string[] = [];
    const worker = new OutboxWorker({
        store,
        clock,
        handlers: {
            'deliver-message': () => Promise.reject(new Error('no messages in these tests')),
            'run-flow': () => Promise.reject(new Error('no flows run in these tests')),
            'flow-trigger': () => Promise.reject(new Error('no flows run in these tests')),
            'deliver-summary': () => Promise.reject(new Error('no summaries in these tests')),
            'give-task': () => Promise.reject(new Error('no tasks are given in these tests')),
            'end-children': unused,
            'start-agent': unused,
            'wake-parent': async (entry) => {
                runs.push(entry.payload.taskId);
                return busy ? 'wait' : undefined;
            },
            // The resume of the same chat behind it is not held up by a wake that waits for that resume.
            'resume-run': async (entry) => {
                runs.push(`resume ${entry.payload.turnId}`);
            }
        }
    });
    worker.start();
    await worker.enqueue('project', 'chat-1', wakeWork('task-1'));
    await worker.enqueue('project', 'chat-1', { kind: 'resume-run', payload: { turnId: 'turn-1', attempt: 2 } });
    await worker.settled();
    expect(runs).toEqual(['task-1', 'resume turn-1']);
    expect(store.list().map((entry) => [entry.kind, entry.attempts])).toEqual([['wake-parent', 0]]);

    // No clock brings it back: only a wake of its own target does.
    clock.advance(RETRY_DELAYS_MS.at(-1)! * 10);
    worker.wake('chat-2');
    await worker.settled();
    expect(runs).toEqual(['task-1', 'resume turn-1']);

    busy = false;
    worker.wake('chat-1');
    await Promise.resolve();
    await worker.settled();
    expect(runs).toEqual(['task-1', 'resume turn-1', 'task-1']);
    expect(store.list()).toEqual([]);
});

test('a wake that lands while the entry is still deciding to wait runs it again instead of losing it', async () => {
    let decide: (outcome: 'wait' | undefined) => void = () => undefined;
    let calls = 0;
    const worker = new OutboxWorker({
        store,
        clock,
        handlers: {
            'deliver-message': () => Promise.reject(new Error('no messages in these tests')),
            'run-flow': () => Promise.reject(new Error('no flows run in these tests')),
            'flow-trigger': () => Promise.reject(new Error('no flows run in these tests')),
            'deliver-summary': () => Promise.reject(new Error('no summaries in these tests')),
            'give-task': () => Promise.reject(new Error('no tasks are given in these tests')),
            'start-agent': unused,
            'end-children': unused,
            'resume-run': unused,
            'wake-parent': () => {
                calls += 1;
                if (calls > 1) {
                    return Promise.resolve();
                }
                return new Promise((resolve) => {
                    decide = resolve;
                });
            }
        }
    });
    worker.start();
    await worker.enqueue('project', 'chat-1', wakeWork('task-1'));
    // The chat ends its turn while the handler still believes it busy.
    worker.wake('chat-1');
    decide('wait');
    await worker.settled();
    expect(calls).toBe(2);
    expect(store.list()).toEqual([]);
});

test('ending children waits for a start of one of them that runs, and holds back one that is only owed', async () => {
    const order: string[] = [];
    const calls = new Map<string, { started: Promise<void>; begin(): void; release(): void; done: Promise<void> }>();
    const call = (key: string) => {
        let entry = calls.get(key);
        if (!entry) {
            let begin: () => void = () => undefined;
            let release: () => void = () => undefined;
            const started = new Promise<void>((resolve) => {
                begin = resolve;
            });
            const done = new Promise<void>((resolve) => {
                release = resolve;
            });
            entry = { started, begin, release, done };
            calls.set(key, entry);
        }
        return entry;
    };
    const hold = (key: string): Promise<void> => {
        order.push(key);
        call(key).begin();
        return call(key).done;
    };
    const worker = new OutboxWorker({
        store,
        clock,
        handlers: {
            'deliver-message': () => Promise.reject(new Error('no messages in these tests')),
            'run-flow': () => Promise.reject(new Error('no flows run in these tests')),
            'flow-trigger': () => Promise.reject(new Error('no flows run in these tests')),
            'deliver-summary': () => Promise.reject(new Error('no summaries in these tests')),
            'give-task': () => Promise.reject(new Error('no tasks are given in these tests')),
            'resume-run': unused,
            'wake-parent': unused,
            'start-agent': (entry) => hold(`start ${entry.target}`),
            'end-children': (entry) => hold(`end ${entry.payload.nodeIds.join(',')}`)
        }
    });
    worker.start();
    await worker.enqueue('project', 'child-a', work());
    clock.advance(1);
    await worker.enqueue('project', 'lead', { kind: 'end-children', payload: { nodeIds: ['child-a', 'child-b'] } });
    clock.advance(1);
    await worker.enqueue('project', 'child-b', work());
    // The start of child-a was running first; the ending waits for it, and child-b's start waits behind the ending.
    expect(order).toEqual(['start child-a']);
    call('start child-a').release();
    await call('end child-a,child-b').started;
    expect(order).toEqual(['start child-a', 'end child-a,child-b']);
    call('end child-a,child-b').release();
    await call('start child-b').started;
    call('start child-b').release();
    await worker.settled();
    expect(order).toEqual(['start child-a', 'end child-a,child-b', 'start child-b']);
});

test('an entry that ends children is kept when the node it is about leaves the project', async () => {
    await store.put('project', 'lead', { kind: 'end-children', payload: { nodeIds: ['child'] } }, clock.now());
    await store.put('project', 'gone', work(), clock.now());
    await store.prune('project', new Set(['child']));
    expect(store.list().map((entry) => entry.kind)).toEqual(['end-children']);
});

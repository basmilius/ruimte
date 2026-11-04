import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentLineageStore, TaskStore } from '@adecore/agents/coordination';
import { isCanvasView, type PeerTaskStartPayload, type ProjectCanvasView, type ProjectContent } from '@ruimte/contracts';
import type { FirstPrompt } from '../agents/pending-prompts.ts';
import { Dispatcher, type ClientConnection } from '../dispatcher.ts';
import { BundleStore } from '../git/bundles.ts';
import { registerPeerTaskHandlers } from '../handlers/peer-tasks.ts';
import type { OutboxEntry, OutboxWork } from '../outbox/outbox.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { taskFirstPrompt } from '../tools/tasks.ts';
import { PeerLinks, peerCanvasId } from './links.ts';
import { PEER_MAX_BRANCH_LENGTH, PEER_MAX_WORKTREES, PeerTasks, peerCaller, type PeerTasksDeps } from './peer-tasks.ts';

const MACHINE = 'machine-a';
const PROJECT = 'project-1';
const newHome = tempHomes('ruimte-peer-tasks-');
const LONG_BRANCH = 'b'.repeat(PEER_MAX_BRANCH_LENGTH + 1);
const PIECE = Buffer.from('abcd').toString('base64');

let home: string;
let content: ProjectContent;
let lineage: AgentLineageStore;
let tasks: TaskStore;
let enqueued: Array<{ target: string; work: OutboxWork }>;
let prompts: Map<string, FirstPrompt>;
let ceiling: 'supervised' | 'auto-accept-edits' | 'auto' | 'full-access';
let linked: boolean;
let existing: Set<string>;
let told: string[];
let failEnqueue: boolean;
let peerLinks: PeerLinks;
let held: Array<{ clientId: string; startsLaunches: boolean | undefined }>;
let letGo: Array<{ clientId: string; projectId: string }>;

function deps(): PeerTasksDeps {
    return {
        links: {
            linkOf: (machineId, projectId) =>
                linked && machineId === MACHINE && projectId === PROJECT ? { machineId, label: 'Studio', projectId, ceiling, createdAt: 0 } : null,
            touch: async () => undefined,
            canvasIdsOf: () => new Set([peerCanvasId(MACHINE)]),
            placedOf: (machineId, projectId) => peerLinks.placedOf(machineId, projectId),
            setPlaced: (machineId, projectId, ids) => peerLinks.setPlaced(machineId, projectId, ids),
            taskRecord: (machineId, nodeId) => peerLinks.taskRecord(machineId, nodeId),
            taskRecordsOf: (machineId) => peerLinks.taskRecordsOf(machineId),
            recordTask: (machineId, nodeId, record) => peerLinks.recordTask(machineId, nodeId, record),
            forgetTask: (machineId, nodeId) => peerLinks.forgetTask(machineId, nodeId),
            untrustFolder: (cwd) => peerLinks.untrustFolder(cwd)
        },
        projects: {
            read: async () => structuredClone(content),
            mutate: async (_projectId: string, apply: (current: ProjectContent) => unknown) => {
                const mutation = (await apply(structuredClone(content))) as { content: ProjectContent | null; result: unknown };
                if (mutation.content !== null) {
                    content = mutation.content;
                }
                return mutation.result;
            },
            hold: (clientId: string, _projectId: string, options?: { startsLaunches?: boolean }) => {
                held.push({ clientId, startsLaunches: options?.startsLaunches });
            },
            letGo: (clientId: string, projectId: string) => void letGo.push({ clientId, projectId }),
            index: { folderOf: () => home }
        } as unknown as PeerTasksDeps['projects'],
        lineage,
        tasks,
        outbox: { list: () => [] as readonly OutboxEntry[], remove: async () => undefined },
        enqueue: async (_projectId, target, work) => {
            if (failEnqueue) {
                throw new Error('the outbox is full');
            }
            enqueued.push({ target, work });
        },
        prompts: {
            put: async (_projectId: string, nodeId: string, prompt: string, brief?: string) =>
                void prompts.set(nodeId, { prompt, ...(brief === undefined ? {} : { brief }) }),
            take: async (nodeId: string) => {
                const held = prompts.get(nodeId) ?? null;
                prompts.delete(nodeId);
                return held;
            }
        },
        stopNode: async () => undefined,
        installed: async () => ['claude', 'codex'],
        exists: (nodeId) => existing.has(nodeId),
        git: () => {
            throw new Error('no git in this test');
        },
        peerBundles: () => {
            throw new Error('no bundles in this test');
        },
        worktreePaths: async () => [],
        notify: (_machineId, nodeId) => void told.push(nodeId)
    };
}

function start(overrides: Partial<PeerTaskStartPayload> = {}): PeerTaskStartPayload {
    return {
        projectId: PROJECT,
        nodeId: 'chat-one',
        parentId: 'chat-parent',
        title: 'Fix the lexer',
        prompt: 'Fix it',
        provider: 'claude',
        ceiling: 'full-access',
        depth: 1,
        ...overrides
    };
}

beforeEach(async () => {
    home = await newHome();
    lineage = new AgentLineageStore(home);
    tasks = new TaskStore(home);
    await Promise.all([lineage.load(), tasks.load()]);
    peerLinks = new PeerLinks(home);
    await peerLinks.bind(MACHINE, 'Studio', PROJECT);
    content = { name: 'One', views: [] } as unknown as ProjectContent;
    enqueued = [];
    prompts = new Map();
    ceiling = 'supervised';
    linked = true;
    existing = new Set();
    told = [];
    failEnqueue = false;
    held = [];
    letGo = [];
});

function startEntry(): Extract<OutboxWork, { kind: 'start-agent' }>['payload'] {
    const entry = enqueued.find((item) => item.work.kind === 'start-agent')?.work;
    if (entry?.kind !== 'start-agent') {
        throw new Error('no start was owed');
    }
    return entry.payload;
}

describe('starting a task for another machine', () => {
    test('the mode is the narrowest of what it asks, what its parent allows and what the link allows', async () => {
        ceiling = 'auto-accept-edits';
        await new PeerTasks(deps()).start(MACHINE, 'client-1', start({ mode: 'auto', ceiling: 'auto' }));
        expect(startEntry()).toMatchObject({ runtimeMode: 'auto-accept-edits', ceiling: 'auto-accept-edits' });
    });

    test('a link nobody widened is supervised, whatever the other machine asks', async () => {
        await new PeerTasks(deps()).start(MACHINE, 'client-1', start({ mode: 'full-access', ceiling: 'full-access' }));
        expect(startEntry()).toMatchObject({ runtimeMode: 'supervised', ceiling: 'supervised' });
        expect(lineage.ceilingOf('chat-one')).toBe('supervised');
    });

    test('a parent narrower than the link narrows it', async () => {
        ceiling = 'full-access';
        await new PeerTasks(deps()).start(MACHINE, 'client-1', start({ ceiling: 'auto-accept-edits' }));
        expect(startEntry().ceiling).toBe('auto-accept-edits');
    });

    test("the depth is at least 1 and refused above this machine's maximum", async () => {
        const peerTasks = new PeerTasks(deps());
        await peerTasks.start(MACHINE, 'client-1', start({ depth: 0 }));
        expect(lineage.depthOf('chat-one')).toBe(1);
        await expect(peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'chat-two', depth: 3 }))).rejects.toMatchObject({ code: 'depth-limit' });
        expect(lineage.peerOf('chat-two')).toBeNull();
    });

    test('everything it starts is an agent of this machine, owed to the machine, and held against its parent there', async () => {
        await new PeerTasks(deps()).start(MACHINE, 'client-1', start());
        expect(lineage.peerOf('chat-one')).toEqual({ machineId: MACHINE });
        expect(lineage.startedBy('chat-one')).toBe(peerCaller(MACHINE, 'chat-parent'));
        const [task] = tasks.all();
        expect(task).toMatchObject({ parentId: peerCanvasId(MACHINE), childId: 'chat-one', status: 'open' });
        expect(task?.machine).toBeUndefined();
        // The chat says the other machine's prompt alone and hears how to report back beside it.
        expect(prompts.get('chat-one')).toEqual({ prompt: 'Fix it', brief: taskFirstPrompt('Fix it', true).brief! });
        expect(held).toEqual([{ clientId: 'client-1', startsLaunches: false }]);
        const canvas = content.views.find((view): view is ProjectCanvasView => isCanvasView(view) && view.id === peerCanvasId(MACHINE));
        expect(canvas?.nodes.map((node) => node.id)).toEqual(['chat-one']);
    });

    test('the fifth open task of a machine is refused as busy, and a settled one frees a place', async () => {
        const peerTasks = new PeerTasks(deps());
        for (const id of ['n1', 'n2', 'n3', 'n4']) {
            await peerTasks.start(MACHINE, 'client-1', start({ nodeId: id }));
        }
        await expect(peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'n5' }))).rejects.toMatchObject({ code: 'peer-busy' });
        const first = tasks.all().find((task) => task.childId === 'n1')!;
        await tasks.settle(first.id, 'done', { text: 'ok', source: 'turn', at: 1 }, 2);
        await peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'n5' }));
        expect(peerTasks.openCount(MACHINE)).toBe(4);
    });

    test('asking again for a node that was started answers the same and starts nothing twice', async () => {
        const peerTasks = new PeerTasks(deps());
        await peerTasks.start(MACHINE, 'client-1', start());
        const again = await peerTasks.start(MACHINE, 'client-1', start());
        expect(again).toEqual({ cwd: home, branch: null });
        expect(tasks.all()).toHaveLength(1);
        expect(enqueued.filter((item) => item.work.kind === 'start-agent')).toHaveLength(1);
    });

    test('a failed start rolls back its task and frees its place without retrying the start', async () => {
        const peerTasks = new PeerTasks(deps());
        for (const id of ['n1', 'n2', 'n3']) {
            await peerTasks.start(MACHINE, 'client-1', start({ nodeId: id }));
        }
        const heldBefore = [...held];
        failEnqueue = true;
        await expect(peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'n4' }))).rejects.toThrow('the outbox is full');
        expect(peerTasks.openCount(MACHINE)).toBe(3);
        expect(prompts.has('n4')).toBe(false);
        expect(held).toEqual(heldBefore);
        failEnqueue = false;
        await peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'n4' }));
        expect(await peerTasks.result(MACHINE, 'client-1', { nodeId: 'n4' })).toMatchObject({
            status: 'failed',
            result: { text: expect.stringContaining('could not be started on this machine') }
        });
        expect(enqueued.filter((item) => item.work.kind === 'start-agent')).toHaveLength(3);
        await peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'n5' }));
        expect(peerTasks.openCount(MACHINE)).toBe(4);
    });

    test('a chat or terminal somebody started with that id before the task came is not taken over', async () => {
        existing.add('chat-one');
        await expect(new PeerTasks(deps()).start(MACHINE, 'client-1', start())).rejects.toMatchObject({ code: 'peer-node-taken' });
        expect(tasks.all()).toHaveLength(0);
        expect(lineage.peerOf('chat-one')).toBeNull();
    });

    test('the project held for the tasks of a machine is let go when its last open task settles', async () => {
        const peerTasks = new PeerTasks(deps());
        tasks.onChange((task) => peerTasks.changed(task));
        await peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'n1' }));
        await peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'n2' }));
        const [first, second] = tasks.all();
        await tasks.settle(first!.id, 'done', { text: 'ok', source: 'turn', at: 1 }, 2);
        expect(letGo).toEqual([]);
        await tasks.settle(second!.id, 'cancelled', null, 3);
        expect(letGo).toEqual([{ clientId: 'client-1', projectId: PROJECT }]);
    });

    test('a channel that closes lets go of what it held, and asking to close does the same', async () => {
        const peerTasks = new PeerTasks(deps());
        await peerTasks.start(MACHINE, 'client-1', start());
        await peerTasks.start(MACHINE, 'client-2', start({ nodeId: 'chat-two' }));
        peerTasks.channelClosed('client-1');
        expect(letGo).toEqual([{ clientId: 'client-1', projectId: PROJECT }]);
        peerTasks.close('client-2', PROJECT);
        expect(letGo).toEqual([
            { clientId: 'client-1', projectId: PROJECT },
            { clientId: 'client-2', projectId: PROJECT }
        ]);
        // Nothing is let go of twice.
        peerTasks.channelClosed('client-2');
        expect(letGo).toHaveLength(2);
    });

    describe('the worktrees one machine may leave here', () => {
        const withBundles = (): { peerTasks: PeerTasks; bundles: BundleStore } => {
            const bundles = new BundleStore(home, MACHINE);
            return { peerTasks: new PeerTasks({ ...deps(), peerBundles: () => bundles }), bundles };
        };
        const bundle = { bundleId: 'a-bundle-id', sha256: 'f'.repeat(64) };

        async function keepWorktrees(count: number): Promise<string[]> {
            const paths: string[] = [];
            for (let i = 0; i < count; i++) {
                const path = join(home, `worktree-${i}`);
                await mkdir(path);
                await peerLinks.recordTask(MACHINE, `old-${i}`, { projectId: PROJECT, cwd: path, worktree: true });
                paths.push(path);
            }
            return paths;
        }

        test('the ninth is refused with where to remove the others, and the copy that came in is dropped', async () => {
            await keepWorktrees(PEER_MAX_WORKTREES);
            const { peerTasks, bundles } = withBundles();
            await bundles.receive(bundle.bundleId, 0, new Uint8Array(4), 4);
            await expect(peerTasks.start(MACHINE, 'client-1', start({ bundle, branch: 'fix-it' }))).rejects.toMatchObject({
                code: 'peer-worktrees-full',
                message: expect.stringContaining('git panel')
            });
            expect(await Bun.file(bundles.incomingPathOf(bundle.bundleId)).exists()).toBe(false);
            expect(tasks.all()).toHaveLength(0);
        });

        test('a branch past the limit is refused before anything is fetched, and the copy that came in is dropped', async () => {
            const { peerTasks, bundles } = withBundles();
            await bundles.receive(bundle.bundleId, 0, new Uint8Array(4), 4);
            await expect(peerTasks.start(MACHINE, 'client-1', start({ bundle, branch: LONG_BRANCH }))).rejects.toMatchObject({
                code: 'branch-too-long'
            });
            expect(await Bun.file(bundles.incomingPathOf(bundle.bundleId)).exists()).toBe(false);
            expect(tasks.all()).toHaveLength(0);
        });

        test('a transfer that broke off with its channel is dropped, but not one the reconnected channel began under the same id', async () => {
            const { peerTasks, bundles } = withBundles();
            const piece = (clientId: string, offset: number): Promise<number> =>
                peerTasks.bundlePut(MACHINE, clientId, { bundleId: bundle.bundleId, offset, data: PIECE, total: 8 });
            await piece('client-1', 0);
            peerTasks.channelClosed('client-1');
            // The channel is back and starts the transfer over before the drop of the old one ran.
            await piece('client-2', 0);
            // Behind the drop in the machine's queue.
            await expect(peerTasks.start(MACHINE, 'client-2', start({ branch: LONG_BRANCH }))).rejects.toMatchObject({
                code: 'branch-too-long'
            });
            expect(await Bun.file(bundles.incomingPathOf(bundle.bundleId)).exists()).toBe(true);

            peerTasks.channelClosed('client-2');
            await expect(peerTasks.start(MACHINE, 'client-2', start({ branch: LONG_BRANCH }))).rejects.toMatchObject({
                code: 'branch-too-long'
            });
            expect(await Bun.file(bundles.incomingPathOf(bundle.bundleId)).exists()).toBe(false);
            const incoming = [
                { bundleId: 'complete', total: 4 },
                { bundleId: 'partial', total: 8 }
            ];
            for (const item of incoming) {
                expect(await peerTasks.bundlePut(MACHINE, 'client-3', { ...item, offset: 0, data: PIECE })).toBe(4);
                expect(await Bun.file(bundles.incomingPathOf(item.bundleId)).exists()).toBe(true);
            }
            peerTasks.channelClosed('client-3');
            await expect(peerTasks.start(MACHINE, 'client-4', start({ branch: LONG_BRANCH }))).rejects.toMatchObject({
                code: 'branch-too-long'
            });
            for (const item of incoming) {
                expect(await Bun.file(bundles.incomingPathOf(item.bundleId)).exists()).toBe(false);
                expect(await peerTasks.bundlePut(MACHINE, 'client-4', { ...item, offset: 0, data: PIECE })).toBe(4);
            }
        });

        test('a person removing one frees a place, and nothing here removes a worktree', async () => {
            const paths = await keepWorktrees(PEER_MAX_WORKTREES);
            await rm(paths[0]!, { recursive: true });
            const { peerTasks } = withBundles();
            // Past the limit, the start goes on to take the bundle in, and this test has no git for that.
            await expect(peerTasks.start(MACHINE, 'client-1', start({ bundle, branch: 'fix-it' }))).rejects.toThrow('no git in this test');
            expect(peerLinks.taskRecord(MACHINE, 'old-0')).toBeNull();
            expect(peerLinks.taskRecord(MACHINE, 'old-1')).not.toBeNull();
        });

        test('a task that works in the project folder takes no place', async () => {
            await keepWorktrees(PEER_MAX_WORKTREES);
            await new PeerTasks(deps()).start(MACHINE, 'client-1', start());
            expect(tasks.all()).toHaveLength(1);
        });
    });

    test('a CLI that cannot be kept from loading the configuration of the folder, and a terminal, are refused before anything is made', async () => {
        const peerTasks = new PeerTasks(deps());
        await expect(peerTasks.start(MACHINE, 'client-1', start({ provider: 'codex' }))).rejects.toMatchObject({
            code: 'peer-provider-unsupported',
            message: expect.stringContaining('Codex cannot run a task from another machine here')
        });
        await expect(peerTasks.start(MACHINE, 'client-1', start({ terminal: true }))).rejects.toMatchObject({ code: 'peer-terminal-unsupported' });
        // Refused with a bundle on its way too, before the folder for it is made (this test has no git to make one with).
        const withBundles = new PeerTasks({ ...deps(), peerBundles: () => new BundleStore(home, MACHINE) });
        await expect(
            withBundles.start(MACHINE, 'client-1', start({ provider: 'codex', bundle: { bundleId: 'a-bundle-id', sha256: 'f'.repeat(64) }, branch: 'x' }))
        ).rejects.toMatchObject({
            code: 'peer-provider-unsupported'
        });
        expect(tasks.all()).toHaveLength(0);
        expect(enqueued).toEqual([]);
        expect(peerLinks.taskRecordsOf(MACHINE)).toEqual([]);
    });

    test('a machine without a link for the project gets nothing started', async () => {
        linked = false;
        await expect(new PeerTasks(deps()).start(MACHINE, 'client-1', start())).rejects.toMatchObject({ code: 'peer-not-linked' });
        expect(tasks.all()).toHaveLength(0);
    });

    test('a node of another machine with that id keeps it', async () => {
        await lineage.put({ projectId: PROJECT, nodeId: 'chat-one', openedBy: 'peer:other:x', depth: 1, agent: true, peer: { machineId: 'other' } });
        await expect(new PeerTasks(deps()).start(MACHINE, 'client-1', start())).rejects.toMatchObject({ code: 'peer-node-taken' });
    });

    // Keeps what the outbox is owed in `owed`, the way the real one does, and what it lets go of in `removed`.
    const withOutbox = () => {
        const owed: OutboxEntry[] = [];
        const removed: string[] = [];
        const peerTasks = new PeerTasks({
            ...deps(),
            outbox: { list: () => owed, remove: async (id) => void removed.push(id) },
            enqueue: async (projectId, target, work) => {
                enqueued.push({ target, work });
                owed.push({ ...work, id: `entry-${owed.length}`, projectId, target, createdAt: 0, attempts: 0, notBefore: 0 } as OutboxEntry);
            }
        });
        return { peerTasks, owed, removed };
    };

    test('a settled task owes its machine the result once, and an acknowledgment ends the debt', async () => {
        const { peerTasks, owed, removed } = withOutbox();
        tasks.onChange((task) => peerTasks.changed(task));
        await peerTasks.start(MACHINE, 'client-1', start());
        const [task] = tasks.all();
        await tasks.settle(task!.id, 'done', { text: 'Done it', source: 'turn', at: 5 }, 6);
        await tasks.settled();
        await Promise.resolve();
        const results = enqueued.filter((item) => item.work.kind === 'deliver-remote-result');
        expect(results).toHaveLength(1);
        expect(results[0]?.target).toBe(`peer:${MACHINE}`);

        const reported = await peerTasks.result(MACHINE, 'client-1', { nodeId: 'chat-one' });
        expect(reported).toMatchObject({ status: 'done', result: { text: 'Done it' }, bundle: null });
        expect(tasks.get(task!.id)?.wake).toBe('pending');
        await peerTasks.result(MACHINE, 'client-1', { nodeId: 'chat-one', ack: true });
        expect(tasks.get(task!.id)?.wake).toBe('sent');
        expect(removed).toEqual([owed.find((entry) => entry.kind === 'deliver-remote-result')!.id]);
    });

    test('unlinking lets go of the results owed for that project, and nothing owes them again', async () => {
        const { peerTasks, owed, removed } = withOutbox();
        tasks.onChange((task) => peerTasks.changed(task));
        await peerTasks.start(MACHINE, 'client-1', start());
        const [task] = tasks.all();
        await tasks.settle(task!.id, 'done', { text: 'Done it', source: 'turn', at: 5 }, 6);
        await tasks.settled();
        await Promise.resolve();
        // Another machine's entry in the same project, and this machine's in another project, stay.
        owed.push({
            kind: 'deliver-remote-result',
            payload: { machineId: 'machine-b', nodeId: 'n', taskId: 't' },
            id: 'other-machine',
            projectId: PROJECT
        } as OutboxEntry);
        owed.push({
            kind: 'deliver-remote-result',
            payload: { machineId: MACHINE, nodeId: 'n', taskId: 't' },
            id: 'other-project',
            projectId: 'project-2'
        } as OutboxEntry);

        await peerTasks.lapseDeliveries(MACHINE, PROJECT);
        expect(removed).toEqual([owed.find((entry) => entry.kind === 'deliver-remote-result' && entry.payload.taskId === task!.id)!.id]);
        expect(tasks.get(task!.id)?.wake).toBe('sent');
    });

    test('a task that is still open reports so, and another machine asks about nothing of this one', async () => {
        const peerTasks = new PeerTasks(deps());
        await peerTasks.start(MACHINE, 'client-1', start());
        expect(await peerTasks.result(MACHINE, 'client-1', { nodeId: 'chat-one' })).toEqual({ status: 'open', result: null, bundle: null });
        expect(await peerTasks.result('machine-b', 'client-2', { nodeId: 'chat-one' })).toEqual({ status: 'unknown', result: null, bundle: null });
    });

    test('a task a person stopped or removed here is told to its machine, and one that machine stopped itself is not', async () => {
        const peerTasks = new PeerTasks({ ...deps(), stopNode: async (nodeId) => void (await tasks.cancelOpen(new Set([nodeId]), 'stopped', 5)) });
        tasks.onChange((task) => peerTasks.changed(task));
        await peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'n1' }));
        await peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'n2' }));
        await peerTasks.start(MACHINE, 'client-1', start({ nodeId: 'n3' }));
        await tasks.cancelOpen(new Set(['n1']), 'a person stopped this chat', 6);
        await tasks.prune(PROJECT, new Set(['n1', 'n3', peerCanvasId(MACHINE)]), 7);
        await peerTasks.stop(MACHINE, 'n3');
        expect(told).toEqual(['n1', 'n2']);
        expect(await peerTasks.result(MACHINE, 'client-1', { nodeId: 'n2' })).toMatchObject({ status: 'cancelled' });
    });

    test('a machine stops only the tasks it gave', async () => {
        const stopped: string[] = [];
        const peerTasks = new PeerTasks({ ...deps(), stopNode: async (nodeId) => void stopped.push(nodeId) });
        await peerTasks.start(MACHINE, 'client-1', start());
        await peerTasks.stop('machine-b', 'chat-one');
        expect(stopped).toEqual([]);
        await peerTasks.stop(MACHINE, 'chat-one');
        expect(stopped).toEqual(['chat-one']);
    });

    test('a bundle nobody offered this machine is not served', async () => {
        await expect(new PeerTasks(deps()).bundleRead(MACHINE, { bundleId: 'a-bundle-id', offset: 0, length: 10 })).rejects.toMatchObject({
            code: 'bundle-missing'
        });
    });
});

describe('the requests a peer may ask', () => {
    const connection = (machineId: string | undefined): ClientConnection => {
        const sent: unknown[] = [];
        return {
            id: 'client-1',
            access: { reachability: 'public', sessionId: 'session', ...(machineId === undefined ? {} : { peer: { machineId } }) },
            send: (frame) => void sent.push(frame)
        };
    };

    async function ask(client: ClientConnection, type: string, payload: unknown): Promise<{ ok: boolean; error?: { code: string } }> {
        const dispatcher = new Dispatcher();
        registerPeerTaskHandlers(
            dispatcher,
            { list: () => (linked ? [{ machineId: MACHINE, label: 'Studio', projectId: PROJECT, ceiling, createdAt: 0 }] : []) },
            new PeerTasks(deps())
        );
        const frames: Array<{ ok: boolean; error?: { code: string } }> = [];
        await dispatcher.handle({ ...client, send: (frame) => void frames.push(frame as never) }, JSON.stringify({ id: 'r', type, payload }));
        return frames[0]!;
    }

    const PAYLOADS: Record<string, unknown> = {
        'peer.taskStart': start(),
        'peer.taskStop': { nodeId: 'chat-one' },
        'peer.result': { nodeId: 'chat-one' },
        'peer.bundlePut': { bundleId: 'a-bundle-id', offset: 0, data: '' },
        'peer.bundleRead': { bundleId: 'a-bundle-id', offset: 0, length: 10 },
        'peer.close': { projectId: PROJECT }
    };

    test('every one of them answers peer-not-linked to a machine without a link', async () => {
        linked = false;
        for (const [type, payload] of Object.entries(PAYLOADS)) {
            expect(await ask(connection(MACHINE), type, payload)).toMatchObject({ ok: false, error: { code: 'peer-not-linked' } });
        }
    });

    test('every one of them is closed to a client that is not a peer', async () => {
        for (const [type, payload] of Object.entries(PAYLOADS)) {
            const frame = await ask(connection(undefined), type, payload);
            expect(frame).toMatchObject({ ok: false, error: { code: 'peer-not-linked' } });
        }
        expect(tasks.all()).toEqual([]);
        expect(enqueued).toEqual([]);
    });

    test('with a link, a task starts', async () => {
        expect(await ask(connection(MACHINE), 'peer.taskStart', start())).toMatchObject({ ok: true });
    });
});

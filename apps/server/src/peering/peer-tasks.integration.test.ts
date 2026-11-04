import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentLineageStore, TaskStore } from '@adecore/agents/coordination';
import { BYTES_CHUNK_MAX, isCanvasView, type PeerTaskStartPayload, type ProjectCanvasView, type ProjectContent } from '@ruimte/contracts';
import { BundleStore, makeBundle } from '../git/bundles.ts';
import { Checkpoints } from '../git/checkpoints.ts';
import { gitIn, initRepo, NO_WORKTREE_AGENTS } from '../git/test-repo.ts';
import { Worktrees } from '../git/worktrees.ts';
import type { OutboxWork } from '../outbox/outbox.ts';
import { PeerLinks, peerCanvasId } from './links.ts';
import { PEER_MAX_BRANCH_LENGTH, PeerTasks } from './peer-tasks.ts';

/*
 * The work travels as a bundle both ways: machine A sends its checkout with an uncommitted change, this
 * machine (B) starts the task in a worktree that holds it, and what the agent does there comes back
 * as a bundle only A may read.
 */

const A = 'machine-a';
const PROJECT = 'project-1';

let root: string;
let repoA: string;
let repoB: string;
let homeA: string;
let homeB: string;
let content: ProjectContent;
let peerTasks: PeerTasks;
let tasks: TaskStore;
let bundlesB: BundleStore;
let enqueued: OutboxWork[];
let untrustedAt: Array<{ cwd: string; existed: boolean }>;
let links: PeerLinks;
let worktreesB: Worktrees;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-peer-tasks-git-')));
    [homeA, homeB] = [join(root, 'home-a'), join(root, 'home-b')];
    await mkdir(homeA, { recursive: true });
    await mkdir(homeB, { recursive: true });
    repoA = join(root, 'a');
    repoB = join(root, 'b');
    await initRepo(repoA, { 'a.txt': 'one\n' });
    await gitIn(root, ['clone', '--quiet', repoA, repoB]);
    for (const [key, value] of Object.entries({ 'user.name': 'Ada', 'user.email': 'a@a', 'commit.gpgSign': 'false', 'gc.auto': '0' })) {
        await gitIn(repoB, ['config', '--local', key, value]);
    }
    content = { name: 'One', views: [] } as unknown as ProjectContent;
    enqueued = [];
    untrustedAt = [];
    const lineage = new AgentLineageStore(homeB);
    tasks = new TaskStore(homeB);
    await Promise.all([lineage.load(), tasks.load()]);
    bundlesB = new BundleStore(homeB);
    const stores = new Map<string, BundleStore>();
    links = new PeerLinks(homeB);
    worktreesB = new Worktrees(homeB, NO_WORKTREE_AGENTS, Date.now, () => null, {
        branches: () => links.peerBranches(),
        untrust: (path, branch) => links.untrustFolder(path, branch)
    });
    await links.bind(A, 'Studio', PROJECT);
    peerTasks = new PeerTasks({
        links: {
            linkOf: (machineId, projectId) => links.linkOf(machineId, projectId),
            touch: async () => undefined,
            canvasIdsOf: () => new Set([peerCanvasId(A)]),
            placedOf: (machineId, projectId) => links.placedOf(machineId, projectId),
            setPlaced: (machineId, projectId, ids) => links.setPlaced(machineId, projectId, ids),
            taskRecord: (machineId, nodeId) => links.taskRecord(machineId, nodeId),
            taskRecordsOf: (machineId) => links.taskRecordsOf(machineId),
            recordTask: (machineId, nodeId, record) => links.recordTask(machineId, nodeId, record),
            forgetTask: (machineId, nodeId) => links.forgetTask(machineId, nodeId),
            untrustFolder: async (cwd, branch) => {
                untrustedAt.push({ cwd, existed: (await stat(cwd).catch(() => null)) !== null });
                await links.untrustFolder(cwd, branch);
            }
        },
        projects: {
            read: async () => structuredClone(content),
            mutate: async (_id: string, apply: (current: ProjectContent) => unknown) => {
                const mutation = (await apply(structuredClone(content))) as { content: ProjectContent | null; result: unknown };
                content = mutation.content ?? content;
                return mutation.result;
            },
            hold: () => undefined,
            letGo: () => undefined,
            index: { folderOf: () => repoB }
        } as unknown as ConstructorParameters<typeof PeerTasks>[0]['projects'],
        lineage,
        tasks,
        outbox: { list: () => [], remove: async () => undefined },
        enqueue: async (_projectId, _target, work) => void enqueued.push(work),
        prompts: { put: async () => undefined, take: async () => null },
        stopNode: async () => undefined,
        installed: async () => ['claude'],
        exists: () => false,
        git: () => ({ bundles: bundlesB, checkpoints: new Checkpoints(homeB), worktrees: worktreesB }),
        peerBundles: (machineId) => {
            const held = stores.get(machineId) ?? new BundleStore(homeB, machineId);
            stores.set(machineId, held);
            return held;
        },
        worktreePaths: async (folder) =>
            (await gitIn(folder, ['worktree', 'list', '--porcelain']))
                .split('\n')
                .filter((line) => line.startsWith('worktree '))
                .map((line) => line.slice(9)),
        notify: () => undefined
    });
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function sendFromA(): Promise<{ bundleId: string; sha256: string }> {
    await writeFile(join(repoA, 'a.txt'), 'one, changed on A\n');
    const checkpointsA = new Checkpoints(homeA);
    const storeA = new BundleStore(homeA);
    const made = await makeBundle(storeA, checkpointsA, { path: repoA, from: 'files', haves: [], name: 'Handoff' });
    const bytes = new Uint8Array(await Bun.file(storeA.pathOf(made.bundleId)).arrayBuffer());
    for (let offset = 0; offset < bytes.byteLength; offset += BYTES_CHUNK_MAX) {
        const chunk = bytes.slice(offset, offset + BYTES_CHUNK_MAX);
        await peerTasks.bundlePut(A, 'client-1', { bundleId: made.bundleId, offset, data: Buffer.from(chunk).toString('base64'), total: bytes.byteLength });
    }
    return { bundleId: made.bundleId, sha256: made.sha256 };
}

function startFromA(bundle: { bundleId: string; sha256: string }, overrides: Partial<PeerTaskStartPayload> = {}) {
    return peerTasks.start(A, 'client-1', {
        projectId: PROJECT,
        nodeId: 'chat-one',
        parentId: 'chat-parent',
        title: 'Fix it',
        prompt: 'Fix it',
        provider: 'claude',
        ceiling: 'full-access',
        depth: 1,
        bundle,
        branch: 'fix-it',
        ...overrides
    });
}

test('the files of the other machine land in a worktree, and what the agent does there comes back to that machine only', async () => {
    const bundle = await sendFromA();
    const started = await startFromA(bundle);
    expect(started.cwd).not.toBe(repoB);
    expect(started.branch).toBe('ruimte/fix-it');
    expect(untrustedAt).toContainEqual({ cwd: started.cwd!, existed: false });
    expect(links.worktreeFolders()).toContain(started.cwd!);
    expect(await readFile(join(started.cwd!, 'a.txt'), 'utf8')).toBe('one, changed on A\n');
    const node = (content.views.find((view) => isCanvasView(view)) as ProjectCanvasView).nodes[0]!;
    expect(node.cwd).toBe(started.cwd!);
    // The checkout of the project itself is as it was.
    expect(await readFile(join(repoB, 'a.txt'), 'utf8')).toBe('one\n');

    await writeFile(join(started.cwd!, 'result.txt'), 'the agent wrote this\n');
    const [task] = tasks.all();
    await tasks.settle(task!.id, 'done', { text: 'Wrote result.txt', source: 'turn', at: 1 }, 2);

    // Where the task ran is what this machine wrote down, whatever a window or an agent with a shell did to the project file since.
    content = { name: 'One', views: [] } as unknown as ProjectContent;

    const reported = await peerTasks.result(A, 'client-1', { nodeId: 'chat-one' });
    expect(reported.status).toBe('done');
    expect(reported.bundle).toMatchObject({ branch: 'ruimte/fix-it' });
    const bundleId = reported.bundle!.bundleId;

    await expect(peerTasks.bundleRead('machine-b', { bundleId, offset: 0, length: 100 })).rejects.toMatchObject({ code: 'bundle-missing' });
    const piece = await peerTasks.bundleRead(A, { bundleId, offset: 0, length: BYTES_CHUNK_MAX });
    expect(piece.size).toBe(reported.bundle!.size);
    expect(Buffer.from(piece.data, 'base64').byteLength).toBe(Math.min(BYTES_CHUNK_MAX, piece.size));
    // Read to its last byte, it is not offered again.
    if (piece.size <= BYTES_CHUNK_MAX) {
        await expect(peerTasks.bundleRead(A, { bundleId, offset: 0, length: 10 })).rejects.toMatchObject({ code: 'bundle-missing' });
    }
});

test('a worktree cut from the branch of another machine is untrusted too, and one cut from the project is not', async () => {
    const bundle = await sendFromA();
    const started = await startFromA(bundle);
    const fromBranch = await worktreesB.addFresh(repoB, 'second', { madeBy: 'verb' }, { base: started.branch! });
    const tip = (await gitIn(repoB, ['rev-parse', started.branch!])).trim();
    const fromCommit = await worktreesB.addFresh(repoB, 'third', { madeBy: 'verb' }, { base: tip });
    const existing = await worktreesB.add(repoB, started.branch!, { madeBy: 'verb' });
    const plain = await worktreesB.addFresh(repoB, 'plain', { madeBy: 'verb' }, { base: 'HEAD' });
    const folders = links.worktreeFolders();
    expect(folders).toContain(fromBranch.path);
    expect(folders).toContain(fromCommit.path);
    expect(folders).not.toContain(plain.path);
    expect(existing.created).toBe(false);
    // A branch cut from that one is cut from foreign work as well.
    const chained = await worktreesB.addFresh(repoB, 'fourth', { madeBy: 'verb' }, { base: 'second' });
    expect(links.worktreeFolders()).toContain(chained.path);
});

test('a branch name of any length the path allows still leaves a record of the folder', async () => {
    const bundle = await sendFromA();
    const started = await startFromA(bundle, { branch: 'b'.repeat(PEER_MAX_BRANCH_LENGTH) });
    expect(links.worktreeFolders()).toContain(started.cwd!);
    expect(links.taskRecord(A, 'chat-one')).not.toBeNull();
});

test('a bundle that does not match what was said it is refused and nothing starts', async () => {
    const bundle = await sendFromA();
    await expect(startFromA({ bundleId: bundle.bundleId, sha256: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'bundle-corrupt' });
    expect(tasks.all()).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
});

async function bundlesOnDisk(): Promise<string[]> {
    return Array.fromAsync(new Bun.Glob('bundles/peers/**/*.bundle').scan({ cwd: homeB }));
}

test('three results fetched together all arrive, and acknowledging leaves no bundle behind', async () => {
    const ids = ['chat-one', 'chat-two', 'chat-three'];
    for (const nodeId of ids) {
        const bundle = await sendFromA();
        await startFromA(bundle, { nodeId, title: nodeId, branch: nodeId });
    }
    for (const task of tasks.all()) {
        await tasks.settle(task.id, 'done', { text: 'Done', source: 'turn', at: 1 }, 2);
    }

    const reported = await Promise.all(ids.map((nodeId) => peerTasks.result(A, 'client-1', { nodeId })));
    for (const result of reported) {
        const bundle = result.bundle!;
        const piece = await peerTasks.bundleRead(A, { bundleId: bundle.bundleId, offset: 0, length: bundle.size });
        expect(piece.size).toBe(bundle.size);
    }
    expect(await bundlesOnDisk()).toEqual([]);

    for (const nodeId of ids) {
        expect(await peerTasks.result(A, 'client-1', { nodeId, ack: true })).toMatchObject({ status: 'done', bundle: null });
    }
    expect(await bundlesOnDisk()).toEqual([]);
});

test('an acknowledgment makes no bundle, and one that was offered and never read goes with it', async () => {
    const bundle = await sendFromA();
    await startFromA(bundle);
    await tasks.settle(tasks.all()[0]!.id, 'done', { text: 'Done', source: 'turn', at: 1 }, 2);
    expect((await peerTasks.result(A, 'client-1', { nodeId: 'chat-one' })).bundle).not.toBeNull();
    expect(await bundlesOnDisk()).toHaveLength(1);
    expect((await peerTasks.result(A, 'client-1', { nodeId: 'chat-one', ack: true })).bundle).toBeNull();
    expect(await bundlesOnDisk()).toEqual([]);
});

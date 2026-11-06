import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ManualClock, claudeStoppingOnResume, type FakeCli } from '@adecore/agents/testing';
import type { ChatTurnItem } from '@ruimte/contracts';
import { MachineHome } from '../../disk/machine-home.ts';
import { BundleStore } from '../../git/bundles.ts';
import { Checkpoints } from '../../git/checkpoints.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate, NO_WORKTREE_AGENTS } from '../../git/test-repo.ts';
import { Worktrees } from '../../git/worktrees.ts';
import { projectOverlays } from '../../projects/overlays.ts';
import { projectLinks } from '../../projects/project-file-test-helpers.ts';
import { ProjectStore } from '../../projects/project-store.ts';
import { bootTestDaemon, invokeTool, type TestDaemon } from '../../testing/test-daemon.ts';
import type { PeerLink } from './peer-connection.ts';
import { leadContent } from './test-helpers.ts';

/*
 * Two daemons in one process, A that gives a task and B that runs it, with a link between them that
 * hands each request to B's dispatcher as a machine of the account would and carries B's events back.
 * The git is real, so the checkout travels as a bundle and the work comes back as one; the CLIs are fakes.
 */

// Three handoffs start hundreds of Git processes; their startup speed is not what this file tests.
setDefaultTimeout(30_000);

const A = 'machine-a';
const B = 'machine-b';

interface Side {
    home: string;
    repo: string;
    store: ProjectStore;
    projectId: string;
    clock: ManualClock;
    worktrees: Worktrees;
    checkpoints: Checkpoints;
    bundles: BundleStore;
}

/* The link A holds to B, while it is open. */
class InProcessLink implements PeerLink {
    readonly requests: string[] = [];
    /* The link goes on the first request of this type, after B handled it (its answer is lost) or before. */
    breakOn: { type: string; after: boolean } | null = null;
    readonly broke = Promise.withResolvers<void>();
    private readonly frames = new Set<(raw: string) => void>();
    private readonly lost = new Set<() => void>();
    private target: TestDaemon | null = null;

    attach(target: TestDaemon): void {
        this.target = target;
    }

    async request<T>(type: string, payload: unknown): Promise<T> {
        this.requests.push(type === 'peer.result' && (payload as { ack?: boolean }).ack === true ? 'peer.result:ack' : type);
        if (this.target === null) {
            throw new Error('The channel is not open');
        }
        const breaking = this.breakOn?.type === type ? this.breakOn : null;
        if (breaking !== null && !breaking.after) {
            this.breakOn = null;
            this.goes();
            throw new Error('The channel closed');
        }
        const frames: Array<{ ok: boolean; result?: unknown; error?: { code: string; message: string } }> = [];
        await this.target.dispatcher.handle(
            {
                id: 'peer-client',
                access: { reachability: 'public', sessionId: 'session', peer: { machineId: A } },
                send: (frame) => void frames.push(frame as never)
            },
            JSON.stringify({ id: 'r', type, payload })
        );
        const reply = frames[0]!;
        if (breaking !== null) {
            this.breakOn = null;
            this.goes();
            throw new Error('The channel closed');
        }
        if (!reply.ok) {
            throw new Error(`${reply.error?.code}: ${reply.error?.message}`);
        }
        return reply.result as T;
    }

    onFrame(listener: (raw: string) => void): () => void {
        this.frames.add(listener);
        return () => void this.frames.delete(listener);
    }

    onLost(listener: () => void): void {
        this.lost.add(listener);
    }

    emit(raw: string): void {
        for (const listener of this.frames) {
            listener(raw);
        }
    }

    close(): void {
        this.target = null;
    }

    private goes(): void {
        this.close();
        this.broke.resolve();
        if (link === this) {
            link = null;
        }
    }
}

let root: string;
let template: RepoTemplate;
let a: Side;
let b: Side;
let daemonA: TestDaemon;
let daemonB: TestDaemon;
let link: InProcessLink | null;
let reconnects: string[];
let running: TestDaemon[];

async function side(name: string): Promise<Side> {
    const home = join(root, `${name}-home`);
    const repo = join(root, name);
    await mkdir(home, { recursive: true });
    return {
        home,
        repo,
        store: new ProjectStore(home, projectLinks(), projectOverlays(home)),
        projectId: '',
        clock: new ManualClock(),
        worktrees: new Worktrees(home, NO_WORKTREE_AGENTS),
        checkpoints: new Checkpoints(home, new MachineHome(home)),
        bundles: new BundleStore(home)
    };
}

beforeAll(async () => {
    template = await repoTemplate('ruimte-delegated', async (dir) => {
        await initRepo(join(dir, 'a'), { 'a.txt': 'one\n' });
        await gitIn(dir, ['clone', '--quiet', join(dir, 'a'), join(dir, 'b')]);
        for (const [key, value] of Object.entries({ 'user.name': 'Ada', 'user.email': 'a@a', 'commit.gpgSign': 'false', 'gc.auto': '0' })) {
            await gitIn(join(dir, 'b'), ['config', '--local', key, value]);
        }
    });
});

afterAll(async () => {
    await template.dispose();
});

beforeEach(async () => {
    root = await template.copy();
    a = await side('a');
    b = await side('b');
    a.projectId = (await a.store.openProject({ folder: a.repo })).summary.projectId;
    await a.store.save(a.projectId, 0, leadContent());
    a.store.release(a.projectId);
    const openedB = await b.store.openProject({ folder: b.repo });
    b.projectId = openedB.summary.projectId;
    await b.store.peers.bind(A, 'Laptop', b.projectId, 'full-access');
    link = null;
    reconnects = [];
    running = [];
});

afterEach(async () => {
    for (const daemon of running) {
        await daemon.stop();
    }
    a.store.closeAll();
    b.store.closeAll();
    await rm(root, { recursive: true, force: true });
});

async function bootA(): Promise<TestDaemon> {
    const git = { bundles: a.bundles, checkpoints: a.checkpoints, worktrees: a.worktrees };
    const daemon = await bootTestDaemon({
        home: a.home,
        store: a.store,
        clock: a.clock,
        worktrees: a.worktrees,
        checkpoints: a.checkpoints,
        remote: {
            machines: () => [{ machineId: B, label: 'Studio', remoteProjectId: b.projectId, ready: true }],
            connections: { link: () => link },
            reconnect: { owe: async (machineId) => void reconnects.push(machineId) },
            git: () => git
        }
    });
    running.push(daemon);
    daemon.worker.start();
    daemonA = daemon;
    return daemon;
}

async function bootB(claudeCli?: FakeCli): Promise<TestDaemon> {
    const git = { bundles: b.bundles, checkpoints: b.checkpoints, worktrees: b.worktrees };
    const daemon = await bootTestDaemon({
        home: b.home,
        store: b.store,
        clock: b.clock,
        worktrees: b.worktrees,
        checkpoints: b.checkpoints,
        ...(claudeCli ? { claudeCli } : {}),
        peer: {
            links: b.store.peers,
            git: () => git,
            // The event goes over the link that is open; with none open the machine asks when it comes back.
            notify: (_machineId, nodeId) => link?.emit(JSON.stringify({ type: 'event', event: 'peer.taskSettled', payload: { nodeId } }))
        }
    });
    running.push(daemon);
    daemon.worker.start();
    daemonB = daemon;
    return daemon;
}

/* The link opens: B answers what A asks, and what B says unprompted wakes whatever waits on that node on A. */
function openLink(): InProcessLink {
    const opened = new InProcessLink();
    opened.attach(daemonB);
    opened.onFrame((raw) => {
        const frame = JSON.parse(raw) as { payload: { nodeId: string } };
        daemonA.worker.wake(frame.payload.nodeId);
    });
    link = opened;
    return opened;
}

function turnsOf(daemon: TestDaemon, chatId: string): ChatTurnItem[] {
    return (daemon.chats.get(chatId)?.thread.list() ?? []).filter((item): item is ChatTurnItem => item.kind === 'turn');
}

function wakeTurns(daemon: TestDaemon): ChatTurnItem[] {
    return turnsOf(daemon, 'chat-lead').filter((turn) => turn.taskIds !== undefined);
}

/* The lead with a finished turn behind it, idle, so a wake finds it. */
async function leadIdle(daemon: TestDaemon): Promise<void> {
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: a.repo });
    await daemon.chats.send('chat-lead', 'plan the work');
    await daemon.until(() => turnsOf(daemon, 'chat-lead').some((turn) => turn.state === 'done'));
}

async function give(prompt = 'Say hi', title = 'Build it'): Promise<{ nodeId: string; taskId: string }> {
    await writeFile(join(a.repo, 'a.txt'), 'one, changed on A\n');
    const [line] = await invokeTool(daemonA, 'chat-lead', 'agent_start', { cli: 'claude', machine: 'Studio', task: title, prompt, worktree: true });
    const fields = line!.split('\t');
    expect(fields).toHaveLength(6);
    return { nodeId: fields[0]!, taskId: fields[5]! };
}

describe('a task given to another machine', () => {
    test('runs there on the checkout that was sent, comes back as a branch, and wakes the lead exactly once', async () => {
        await bootB();
        await bootA();
        await leadIdle(daemonA);
        openLink();

        const task = await give();
        await daemonA.until(() => wakeTurns(daemonA).some((turn) => turn.state === 'done'));
        await daemonA.worker.settled();
        await daemonB.worker.settled();

        // B ran it as an agent of its own, in a worktree that held A's uncommitted file, owing nothing afterwards.
        const there = daemonB.tasks.all();
        expect(there).toHaveLength(1);
        expect(there[0]).toMatchObject({ childId: task.nodeId, status: 'done', wake: 'sent' });
        expect(daemonB.lineage.peerOf(task.nodeId)).toEqual({ machineId: A });
        expect(daemonB.outbox.list()).toEqual([]);

        // A woke its lead once, with the result and the branch the work came back as.
        expect(wakeTurns(daemonA).map((turn) => turn.taskIds)).toEqual([[task.taskId]]);
        const settled = daemonA.tasks.get(task.taskId)!;
        expect(settled).toMatchObject({ status: 'done', wake: 'sent', machine: B });
        expect(settled.result?.text).toContain('The work came back as the branch ruimte/');
        expect(daemonA.outbox.list()).toEqual([]);
        const refs = await gitIn(a.repo, ['for-each-ref', '--format=%(refname)', 'refs/remotes']);
        expect(refs).toContain('refs/remotes/ruimte-studio/');
        const worktreeA = settled.result!.text.match(/in the worktree (\S+);/)?.[1];
        expect(await readFile(join(worktreeA!, 'a.txt'), 'utf8')).toBe('one, changed on A\n');
        // The checkout of A itself was not touched by the way back.
        expect(await readFile(join(a.repo, 'a.txt'), 'utf8')).toBe('one, changed on A\n');
        // What B sent back is B's word: A does not run the settings of that folder, nor trust a chat started in it.
        expect(a.store.peers.worktreeFolders()).toContain(worktreeA!);
        const branchA = settled.result!.text.match(/the branch (\S+) in/)?.[1];
        expect(a.store.peers.peerBranches()).toContain(branchA as string);
    });

    test('three tasks with a worktree in a row each bring their branch back and leave no bundle on B, which is one more than the two bundles a machine may keep', async () => {
        await bootB();
        await bootA();
        await leadIdle(daemonA);
        openLink();

        for (let i = 1; i <= 3; i++) {
            const task = await give('Say hi', `Build part ${i}`);
            await daemonA.until(() => wakeTurns(daemonA).some((turn) => turn.taskIds?.includes(task.taskId) && turn.state === 'done'));
            await daemonA.worker.settled();
            await daemonB.worker.settled();
            expect(daemonA.tasks.get(task.taskId)?.result?.text).toContain('The work came back as the branch ruimte/');
        }
        expect(await Array.fromAsync(new Bun.Glob('bundles/peers/**/*.bundle').scan({ cwd: b.home }))).toEqual([]);
    });

    test('waits while B is away, starts once the link opens, and a result that arrives while A is away is taken in when it is back', async () => {
        await bootB();
        await bootA();
        await leadIdle(daemonA);

        const task = await give();
        await daemonA.worker.settled();
        expect(reconnects).toContain(B);
        expect(daemonA.tasks.get(task.taskId)?.status).toBe('open');
        expect(daemonA.outbox.list().map((entry) => entry.kind)).toEqual(['start-remote-agent']);
        expect(daemonB.tasks.all()).toEqual([]);

        const opened = openLink();
        daemonA.worker.wake(task.nodeId);
        await daemonA.until(() => daemonB.tasks.all().some((candidate) => candidate.status === 'done'));
        await daemonA.worker.settled();
        await daemonA.until(() => wakeTurns(daemonA).some((turn) => turn.state === 'done'));
        expect(opened.requests).toContain('peer.taskStart');

        // A second task settles on B while the link is down; nothing fails, and the result is taken in on return.
        link = null;
        const second = await give('Say hi again');
        await daemonA.worker.settled();
        expect(daemonA.tasks.get(second.taskId)?.status).toBe('open');
        openLink();
        daemonA.worker.wake(second.nodeId);
        await daemonA.until(() => daemonA.tasks.get(second.taskId)?.status === 'done');
        await daemonA.worker.settled();
        expect(wakeTurns(daemonA).map((turn) => turn.taskIds)).toEqual([[task.taskId], [second.taskId]]);
    });

    test('is failed with the last result and the wake goes out once when B comes back from a restart that its CLI does not survive', async () => {
        await bootB();
        await bootA();
        await leadIdle(daemonA);
        openLink();

        // `slow` keeps the first turn open on B, so the restart catches it in the middle.
        const task = await give('slow');
        await daemonB.until(() => daemonB.chats.get(task.nodeId)?.info.agentSessionId != null);
        const sessionId = daemonB.chats.get(task.nodeId)!.info.agentSessionId!;
        running.splice(running.indexOf(daemonB), 1);
        link = null;
        await daemonB.stop();

        await bootB(claudeStoppingOnResume(new Set([sessionId]), 'exit'));
        await daemonB.chats.recoverInterrupted();
        await daemonB.until(() => daemonB.tasks.all().some((candidate) => candidate.status === 'failed'));
        await daemonB.worker.settled();
        expect(daemonA.tasks.get(task.taskId)?.status).toBe('open');

        openLink();
        daemonA.worker.wake(task.nodeId);
        await daemonA.until(() => wakeTurns(daemonA).some((turn) => turn.state === 'done'));
        await daemonA.worker.settled();
        expect(daemonA.tasks.get(task.taskId)).toMatchObject({ status: 'failed', wake: 'sent' });
        expect(wakeTurns(daemonA).map((turn) => turn.taskIds)).toEqual([[task.taskId]]);
        expect(daemonB.tasks.all()[0]?.wake).toBe('sent');
    });

    test('stopping the lead stops the agent on B, which settles nothing and wakes nobody', async () => {
        await bootB();
        await bootA();
        await leadIdle(daemonA);
        const opened = openLink();

        const task = await give('slow');
        await daemonB.until(() => daemonB.chats.get(task.nodeId)?.info.activeTurnId != null);
        await daemonA.endChildren.stopNode('chat-lead', 'a person stopped it');
        await daemonA.worker.settled();
        await daemonB.until(() => daemonB.tasks.get(daemonB.tasks.all()[0]!.id)?.status === 'cancelled');
        await daemonB.worker.settled();

        expect(opened.requests).toContain('peer.taskStop');
        expect(daemonA.tasks.get(task.taskId)?.status).toBe('cancelled');
        expect(daemonB.outbox.list()).toEqual([]);
        expect(wakeTurns(daemonA)).toEqual([]);
    });

    test('a start whose answer was lost and that is stopped before it ran again still stops the agent on B once the link is back', async () => {
        await bootB();
        await bootA();
        await leadIdle(daemonA);
        const first = openLink();
        first.breakOn = { type: 'peer.taskStart', after: true };

        const task = await give('slow');
        await daemonA.worker.settled();
        await daemonB.until(() => daemonB.chats.get(task.nodeId)?.info.activeTurnId != null);
        expect(daemonA.outbox.list().map((entry) => entry.kind)).toEqual(['start-remote-agent']);

        await daemonA.endChildren.stopNode('chat-lead', 'a person stopped it');
        await daemonA.worker.settled();
        expect(daemonA.tasks.get(task.taskId)?.status).toBe('cancelled');
        expect(daemonA.outbox.list().map((entry) => [entry.kind, entry.target])).toEqual([['stop-remote-agent', `peer:${B}`]]);

        const second = openLink();
        daemonA.worker.wake(`peer:${B}`);
        await daemonA.worker.settled();
        await daemonB.until(() => daemonB.tasks.all()[0]?.status === 'cancelled');
        expect(second.requests).toEqual(['peer.taskStop']);
        expect(daemonA.outbox.list()).toEqual([]);
        expect(wakeTurns(daemonA)).toEqual([]);
    });

    test('leaving the account fails a task that waited to start and one that ran, wakes the lead once for each and leaves nothing owed to B', async () => {
        await bootB();
        await bootA();
        await leadIdle(daemonA);
        openLink();
        const running = await give('slow', 'Runs there');
        await daemonB.until(() => daemonB.chats.get(running.nodeId)?.info.activeTurnId != null);
        await daemonA.worker.settled();
        link = null;
        const waiting = await give('Say hi', 'Waits to start');
        await daemonA.worker.settled();
        expect(
            daemonA.outbox
                .list()
                .map((entry) => entry.kind)
                .sort()
        ).toEqual(['start-remote-agent', 'take-remote-result']);

        await daemonA.remoteTasks!.leave();
        await daemonA.until(() => wakeTurns(daemonA).filter((turn) => turn.state === 'done').length === 2);
        await daemonA.worker.settled();

        expect(daemonA.tasks.get(waiting.taskId)).toMatchObject({ status: 'failed', wake: 'sent' });
        expect(daemonA.tasks.get(waiting.taskId)?.result?.text).toContain('never ran there');
        expect(daemonA.tasks.get(running.taskId)).toMatchObject({ status: 'failed', wake: 'sent' });
        expect(daemonA.tasks.get(running.taskId)?.result?.text).toContain('This machine left its account');
        expect(
            wakeTurns(daemonA)
                .map((turn) => turn.taskIds)
                .sort()
        ).toEqual([[running.taskId], [waiting.taskId]].sort());
        expect(daemonA.outbox.list()).toEqual([]);
    });

    test('a start B took while A still read its own checkout owes B nothing once A left its account', async () => {
        await bootB();
        await bootA();
        await leadIdle(daemonA);
        openLink();
        const reading = Promise.withResolvers<void>();
        const read = Promise.withResolvers<void>();
        const head = a.checkpoints.head.bind(a.checkpoints);
        a.checkpoints.head = async (cwd) => {
            reading.resolve();
            await read.promise;
            return head(cwd);
        };
        const given = await give('slow', 'Runs there');
        await reading.promise;

        await daemonA.remoteTasks!.leave();
        link = null;
        read.resolve();
        await daemonA.worker.settled();

        expect(daemonA.outbox.list().filter((entry) => entry.kind.endsWith('remote-agent') || entry.kind === 'take-remote-result')).toEqual([]);
        expect(reconnects).toEqual([]);
        expect(daemonA.tasks.get(given.taskId)).toMatchObject({ status: 'failed' });
        expect(daemonA.tasks.get(given.taskId)?.result?.text).toContain('may still run until a person stops it on that machine');
    });

    test('a link that goes while the work comes back leaves the task open, and the work is taken in before B hears it was', async () => {
        await bootB();
        await bootA();
        await leadIdle(daemonA);
        const first = openLink();
        first.breakOn = { type: 'peer.bundleRead', after: false };

        const task = await give();
        await first.broke.promise;
        await daemonA.worker.settled();
        expect(first.requests).toContain('peer.bundleRead');
        await daemonA.worker.settled();
        expect(daemonA.tasks.get(task.taskId)?.status).toBe('open');
        expect(first.requests).not.toContain('peer.result:ack');
        expect(daemonA.outbox.list().map((entry) => entry.kind)).toEqual(['take-remote-result']);
        expect(wakeTurns(daemonA)).toEqual([]);

        const second = openLink();
        daemonA.worker.wake(task.nodeId);
        await daemonA.until(() => wakeTurns(daemonA).some((turn) => turn.state === 'done'));
        await daemonA.worker.settled();
        await daemonB.worker.settled();
        const settled = daemonA.tasks.get(task.taskId)!;
        expect(settled).toMatchObject({ status: 'done', wake: 'sent' });
        expect(settled.result?.text).toContain('The work came back as the branch ruimte/');
        expect(second.requests.at(-1)).toBe('peer.result:ack');
        expect(second.requests.lastIndexOf('peer.bundleRead')).toBeLessThan(second.requests.indexOf('peer.result:ack'));
        expect(wakeTurns(daemonA).map((turn) => turn.taskIds)).toEqual([[task.taskId]]);
        expect(daemonA.outbox.list()).toEqual([]);
        expect(daemonB.outbox.list()).toEqual([]);
    });
});

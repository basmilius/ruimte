import { join } from 'node:path';
import type { OutboxWorker } from '@adecore/agents/coordination';
import { errorText } from '../error-text.ts';
import { runGh } from '../git/github.ts';
import { prSplits } from '../git/pr-split.ts';
import { PrWatchStore } from '../github/pr-watch.ts';
import { AfterSettleStore } from '../launches/after-settle.ts';
import type { EndChildrenWiring } from '../outbox/end-children.ts';
import type { OutboxWork } from '../outbox/outbox.ts';
import type { SummaryWiring } from '../chat/summary.ts';
import { wireOutbox } from '../outbox/wiring.ts';
import type { PushService } from '../push/service.ts';
import { SnoozeStore } from '../push/snoozes.ts';
import type { TaskWiring } from '../tasks/wiring.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { ConnectPeer, owedTargetsIn } from '../remote/connect-peer.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { RemoteBundle } from './remote.ts';
import type { LaunchesBundle } from './launches.ts';
import type { ClientsBundle } from './clients.ts';
import type { GitBundle } from './git.ts';
import type { ProvidersBundle } from './providers.ts';
import { PeerTasks } from '../peering/peer-tasks.ts';
import { RemoteTasks } from '../remote/remote-tasks.ts';
import { BundleStore } from '../git/bundles.ts';

/* What the outbox drives on behalf of agents: starts, tasks, wakes and what a node takes along when it goes. */
export interface AgentWorkBundle {
    worker: OutboxWorker<OutboxWork>;
    tasks: TaskWiring;
    endChildren: EndChildrenWiring;
    summaries: SummaryWiring;
    prWatches: PrWatchStore;
    snoozes: SnoozeStore;
    afterSettleStore: AfterSettleStore;
    /* The reconnect of the links to other machines, owed through the outbox. */
    reconnect: ConnectPeer;
    /* The tasks other machines give agents here. */
    peerTasks: PeerTasks;
}

export interface AgentWorkInput {
    home: string;
    identity: EndpointIdentity;
    stores: AgentStores;
    agents: AgentsBundle;
    projects: ProjectStore;
    remote: RemoteBundle;
    providers: ProvidersBundle;
    later: {
        push(): PushService;
        launches(): LaunchesBundle;
        git(): GitBundle;
        clients(): ClientsBundle;
    };
}

/* The node a `peer.taskSettled` frame names, or null for any other frame. */
function settledNodeOf(raw: string): string | null {
    try {
        const frame = JSON.parse(raw) as { type?: unknown; event?: unknown; payload?: { nodeId?: unknown } };
        return frame.type === 'event' && frame.event === 'peer.taskSettled' && typeof frame.payload?.nodeId === 'string' ? frame.payload.nodeId : null;
    } catch {
        return null;
    }
}

export function wireAgentWork({ home, identity, stores, agents, projects, remote, providers, later }: AgentWorkInput): AgentWorkBundle {
    const { outbox } = stores;
    const { outboxLink } = agents;
    const prWatches = new PrWatchStore({
        path: join(home, 'pr-watches.json'),
        gh: runGh,
        splits: prSplits,
        enqueue: (projectId, chatId, work) => outboxLink.enqueue(projectId, chatId, work),
        entries: () => outbox.list(),
        removeEntry: (id) => outbox.remove(id),
        onError: (what, error) => console.error(`${what}:`, errorText(error))
    });
    // The worker exists only after `wireOutbox`, and the reconnect is one of the handlers it is built with.
    let worker: OutboxWorker<OutboxWork> | null = null;
    const reconnect = new ConnectPeer({
        outbox,
        owedTargets: owedTargetsIn(outbox),
        enqueue: (projectId, target, work, notBefore) => outboxLink.enqueue(projectId, target, work, notBefore),
        wake: (target) => worker?.wake(target),
        giveUp: (machineId, refusal) => remoteTasksNow().giveUp(machineId, refusal),
        connections: remote.connections,
        now: () => Date.now(),
        random: () => Math.random()
    });
    remote.onLeave(async () => {
        await reconnect.lapseAll((id) => outbox.remove(id));
        await remoteTasksNow().leave();
    });
    remote.connections.onLost((machineId) => {
        void reconnect.owe(machineId).catch((e: unknown) => console.error('Owing a reconnect failed:', errorText(e)));
    });
    // The tasks other machines give need the git and the end-children that are wired once the outbox is, so they are built lazily.
    let peerTasks: PeerTasks | null = null;
    let remoteTasks: RemoteTasks | null = null;
    const remoteTasksNow = (): RemoteTasks => {
        if (remoteTasks === null) {
            throw new Error('A task on another machine is asked for before the daemon is up');
        }
        return remoteTasks;
    };
    const peerStores = new Map<string, BundleStore>();
    const peerTasksNow = (): PeerTasks => {
        if (peerTasks === null) {
            throw new Error('A task from another machine is asked for before the daemon is up');
        }
        return peerTasks;
    };
    const wiring = wireOutbox({
        link: outboxLink,
        outbox,
        projects,
        lineage: stores.lineage,
        prompts: stores.prompts,
        notices: stores.notices,
        prWatches,
        tasks: stores.tasks,
        chats: agents.chats,
        sessions: agents.sessions,
        alert: (target, nodeId, title, body) => later.push().alert(target, nodeId, title, body),
        checkCwd: agents.startCwd,
        resumeAtReset: () => identity.resumeAtReset,
        runAfterSettle: (entry) => later.launches().afterSettle.handle(entry),
        connectPeer: reconnect.handler,
        peerTasks: {
            deliver: (entry) => peerTasksNow().deliver(entry),
            isPeerTask: (task) => peerTasks?.isPeerTask(task) === true,
            parents: (projectId) => projects.peers.canvasIdsOf(projectId)
        },
        remoteTasks: {
            start: (entry) => remoteTasksNow().start(entry),
            stop: (entry) => remoteTasksNow().stop(entry),
            take: (entry) => remoteTasksNow().take(entry),
            oweStop: (nodeId) => remoteTasksNow().oweStop(nodeId)
        }
    });
    remoteTasks = new RemoteTasks({
        connections: remote.connections,
        reconnect,
        refresh: (machineId, except) => remote.connections.refresh(machineId, except),
        tasks: stores.tasks,
        coordinator: wiring.tasks.coordinator,
        placed: (nodeId) => projects.index.locate(nodeId) !== null,
        git: () => later.git(),
        folderOf: (projectId) => projects.index.folderOf(projectId),
        labelOf: (projectId, machineId) => projects.remote.linksOf(projectId).find((link) => link.machineId === machineId)?.label ?? 'machine',
        untrustFolder: (path, branch) => projects.peers.untrustFolder(path, branch),
        outbox,
        enqueue: (projectId, target, work) => outboxLink.enqueue(projectId, target, work),
        wake: (target) => worker?.wake(target),
        now: () => Date.now(),
        log: (line) => console.error(line)
    });
    worker = wiring.worker;
    peerTasks = new PeerTasks({
        links: projects.peers,
        projects,
        lineage: stores.lineage,
        tasks: stores.tasks,
        outbox,
        enqueue: (projectId, target, work) => outboxLink.enqueue(projectId, target, work),
        prompts: stores.prompts,
        stopNode: (nodeId, reason) => wiring.endChildren.stopNode(nodeId, reason),
        exists: (nodeId) => agents.chats.get(nodeId) !== undefined || agents.sessions.get(nodeId) !== undefined,
        installed: async () => (await providers.providers.list()).filter((provider) => provider.installed).map((provider) => provider.kind),
        peerBundles: (machineId) => {
            let held = peerStores.get(machineId);
            if (held === undefined) {
                held = new BundleStore(home, machineId);
                peerStores.set(machineId, held);
            }
            return held;
        },
        git: () => later.git(),
        worktreePaths: (folder) => later.git().checkouts.paths(folder),
        notify: (machineId, nodeId) => later.clients().notifyPeer(machineId, nodeId),
        log: (line) => console.error(line)
    });
    stores.tasks.onChange((task) => peerTasksNow().changed(task));
    // A machine that works for this one says its task settled; the entry that waits for the result looks again.
    remote.connections.onFrame((machineId, raw) => {
        const nodeId = settledNodeOf(raw);
        if (nodeId !== null) {
            remoteTasksNow().peerSettled(machineId, nodeId);
        }
    });
    const snoozes = new SnoozeStore({ path: join(home, 'snoozes.json') });
    const afterSettleStore = new AfterSettleStore({ path: join(home, 'launch-after-settle.json') });
    projects.index.onPlaces = (projectId, ids) => {
        wiring.places(projectId, ids);
        snoozes.places(projectId, ids);
        afterSettleStore.places(projectId, ids);
    };
    return {
        worker: wiring.worker,
        tasks: wiring.tasks,
        endChildren: wiring.endChildren,
        summaries: wiring.summaries,
        prWatches,
        snoozes,
        afterSettleStore,
        reconnect,
        peerTasks: peerTasksNow()
    };
}

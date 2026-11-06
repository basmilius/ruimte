import { join } from 'node:path';
import { chatOpener } from '@adecore/agents/chat';
import type { OutboxWorker } from '@adecore/agents/coordination';
import type { EndpointIdentity } from '../endpoint-id.ts';
import { errorText } from '../error-text.ts';
import { BundleStore } from '../git/bundles.ts';
import { PrWatchStore, prWatchHandler } from '../github/pr-watch.ts';
import { AfterSettleStore } from '../launches/after-settle.ts';
import type { EndChildrenWiring } from '../outbox/end-children.ts';
import type { OutboxWork } from '../outbox/outbox.ts';
import type { SummaryWiring } from '../outbox/summary.ts';
import { ConnectPeer } from '../peer/giver/connect-peer.ts';
import { RemoteTasks } from '../peer/giver/remote-tasks.ts';
import { PeerTasks } from '../peer/worker/peer-tasks.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { PushService } from '../push/service.ts';
import { SnoozeStore } from '../push/snoozes.ts';
import type { TaskWiring } from '../tasks/wiring.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { ClientsBundle } from './clients.ts';
import type { GitBundle } from './git.ts';
import { wireOutbox } from './outbox.ts';
import type { ProvidersBundle } from './providers.ts';
import type { RemoteBundle } from './remote.ts';
import type { DaemonSeams } from './seams.ts';

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
    /* The tasks this machine gives agents on other machines. */
    remoteTasks: RemoteTasks;
    /* The tasks other machines give agents here. */
    peerTasks: PeerTasks;
}

interface AgentWorkInput {
    home: string;
    identity: EndpointIdentity;
    stores: AgentStores;
    agents: AgentsBundle;
    projects: ProjectStore;
    remote: RemoteBundle;
    providers: ProvidersBundle;
    seams: Pick<DaemonSeams, 'clock' | 'random' | 'git' | 'remote' | 'peerNotify' | 'observers'>;
    later: {
        push(): PushService;
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

export function wireAgentWork({ home, identity, stores, agents, projects, remote, providers, seams, later }: AgentWorkInput): AgentWorkBundle {
    const { outbox, lifecycle } = stores;
    const { outboxLink } = agents;
    const { worker } = outboxLink;
    const { clock } = seams;
    const prWatches = new PrWatchStore({
        path: join(home, 'pr-watches.json'),
        clock,
        gh: seams.git.gh,
        random: seams.random,
        splits: seams.git.splits,
        enqueue: (projectId, chatId, work) => outboxLink.enqueue(projectId, chatId, work),
        entries: () => outbox.list(),
        removeEntry: (id) => outbox.remove(id),
        onError: (what, error) => console.error(`${what}:`, errorText(error))
    });
    worker.handle(
        'deliver-pr-watch',
        prWatchHandler({ watches: prWatches, openChat: chatOpener({ chats: agents.chats, placed: (nodeId) => projects.index.locate(nodeId) !== null }) })
    );
    lifecycle.on('placed', (projectId, ids) => prWatches.prune(projectId, ids));

    // The reconnect and the tasks given to other machines need each other, and the tasks of this machine need the wiring of the outbox.
    const reconnect = new ConnectPeer({
        outbox,
        owedTargets: (machineId) => outbox.targetsOwedTo(machineId),
        enqueue: (projectId, target, work, notBefore) => outboxLink.enqueue(projectId, target, work, notBefore),
        wake: (target) => outboxLink.wake(target),
        giveUp: (machineId, refusal) => remoteTasks.giveUp(machineId, refusal),
        connections: remote.connections,
        now: () => clock.now(),
        random: seams.random
    });
    worker.handle('connect-peer', reconnect.handler);
    remote.onLeave(async () => {
        await reconnect.lapseAll((id) => outbox.remove(id));
        await remoteTasks.leave();
    });
    remote.connections.onLost((machineId) => {
        void reconnect.owe(machineId).catch((e: unknown) => console.error('Owing a reconnect failed:', errorText(e)));
    });
    const peerStores = new Map<string, BundleStore>();
    const wiring = wireOutbox({
        link: outboxLink,
        outbox,
        projects,
        lineage: stores.lineage,
        prompts: stores.prompts,
        notices: stores.notices,
        tasks: stores.tasks,
        chats: agents.chats,
        sessions: agents.sessions,
        lifecycle,
        alert: (target, nodeId, title, body) => {
            seams.observers.alerted(target, nodeId, title, body);
            later.push().alert(target, nodeId, title, body);
        },
        now: () => clock.now(),
        observers: seams.observers,
        checkCwd: agents.startCwd,
        resumeAtReset: () => identity.resumeAtReset,
        isPeerTask: (task) => peerTasks.isPeerTask(task),
        peerParents: (projectId) => projects.peers.canvasIdsOf(projectId),
        remoteStop: (nodeId) => remoteTasks.oweStop(nodeId)
    });
    const remoteTasks = new RemoteTasks({
        connections: seams.remote.connections(remote.connections),
        reconnect: seams.remote.reconnect(reconnect),
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
        wake: (target) => outboxLink.wake(target),
        now: () => clock.now(),
        log: (line) => console.error(line)
    });
    worker.handle('start-remote-agent', remoteTasks.start);
    worker.handle('stop-remote-agent', remoteTasks.stop);
    worker.handle('take-remote-result', remoteTasks.take);
    lifecycle.on('placed', (projectId, ids) => remoteTasks.places(projectId, ids));
    const peerTasks = new PeerTasks({
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
        notify: seams.peerNotify((machineId, nodeId) => later.clients().notifyPeer(machineId, nodeId)),
        log: (line) => console.error(line)
    });
    worker.handle('deliver-remote-result', peerTasks.deliver);
    stores.tasks.onChange((task) => peerTasks.changed(task));
    // A machine that works for this one says its task settled; the entry that waits for the result looks again.
    remote.connections.onFrame((machineId, raw) => {
        const nodeId = settledNodeOf(raw);
        if (nodeId !== null) {
            remoteTasks.peerSettled(machineId, nodeId);
        }
    });
    const snoozes = new SnoozeStore({ path: join(home, 'snoozes.json') });
    const afterSettleStore = new AfterSettleStore({ path: join(home, 'launch-after-settle.json') });
    lifecycle.on('placed', (projectId, ids) => snoozes.places(projectId, ids));
    lifecycle.on('placed', (projectId, ids) => afterSettleStore.places(projectId, ids));
    projects.index.onPlaces = (projectId, ids) => {
        void lifecycle.emit('placed', projectId, ids).catch((e: unknown) => console.error('A node leaving its project was not taken in:', errorText(e)));
    };
    return {
        worker,
        tasks: wiring.tasks,
        endChildren: wiring.endChildren,
        summaries: wiring.summaries,
        prWatches,
        snoozes,
        afterSettleStore,
        reconnect,
        remoteTasks,
        peerTasks
    };
}

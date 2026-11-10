import { stat } from 'node:fs/promises';
import { CodedError } from '@adecore/agents';
import { ToolRefusal } from '@adecore/agents/context';
import type { AgentLineageStore, TaskStore } from '@adecore/agents/coordination';
import { narrowerMode, type ChatProvider } from '@adecore/agents/providers';
import { KeyedSerializer } from '@adecore/utils/async';
import { MAX_OPENED_PER_CALLER } from '@ruimte/actions';
import {
    BUNDLE_MAX_BYTES,
    PEER_MAX_OPEN_TASKS,
    isCanvasView,
    type AgentKind,
    type PeerBundlePutPayload,
    type PeerBundleReadPayload,
    type PeerBundleReadResult,
    type PeerNode,
    type PeerResultPayload,
    type PeerResultResult,
    type PeerTaskStartPayload,
    type PeerTaskStartResult,
    type ProjectCanvasView,
    type RuntimeMode,
    type Task
} from '@ruimte/contracts';
import { bestEffort } from '../../best-effort.ts';
import { MAX_AGENT_DEPTH } from '../../canvas/depth.ts';
import type { PendingPromptStore } from '../../canvas/pending-prompts.ts';
import { checkCwd } from '../../canvas/project-paths.ts';
import { taskFirstPrompt } from '../../canvas/tasks.ts';
import { errorText } from '../../error-text.ts';
import { BundleStore, fetchBundle, makeBundle } from '../../git/bundles.ts';
import type { CheckpointService } from '../../git/checkpoints.ts';
import { git } from '../../git/run.ts';
import type { Worktrees } from '../../git/worktrees.ts';
import { peerOpener } from '../../opener.ts';
import type { DeliverRemoteResultEntry, OutboxStore, OutboxWork } from '../../outbox/outbox.ts';
import { peerCanvasId, type PeerLinks } from '../../projects/peer-links.ts';
import type { ProjectStore } from '../../projects/project-store.ts';
import { DEFAULT_RUNTIME_MODE } from '../../providers/launch.ts';
import { peerLane } from '../giver/connect-peer.ts';
import { idTakenOutside, nodeOf, sameCanvas, stripHidden } from './peer-canvas.ts';

export interface PeerTasksDeps {
    links: Pick<
        PeerLinks,
        'linkOf' | 'touch' | 'canvasIdsOf' | 'placedOf' | 'setPlaced' | 'taskRecord' | 'taskRecordsOf' | 'recordTask' | 'forgetTask' | 'untrustFolder'
    >;
    projects: Pick<ProjectStore, 'read' | 'mutate' | 'hold' | 'letGo'> & { index: Pick<ProjectStore['index'], 'folderOf'> };
    lineage: Pick<AgentLineageStore, 'put' | 'peerOf' | 'openedCount'>;
    tasks: Pick<TaskStore, 'open' | 'all' | 'get' | 'markWoken' | 'settle'>;
    outbox: Pick<OutboxStore, 'ofKind' | 'remove'>;
    enqueue(projectId: string, target: string, work: OutboxWork): Promise<void>;
    prompts: Pick<PendingPromptStore, 'put' | 'take'>;
    /* Ends the agent and cancels its task, so nobody is woken by a stopped one. */
    stopNode(nodeId: string, reason: string): Promise<void>;
    installed(): Promise<AgentKind[]>;
    providers: { get(kind: AgentKind): ChatProvider };
    exists(nodeId: string): boolean;
    /* The git of this machine, asked for when a task needs it: it is wired after the outbox that owes these tasks. */
    git(): { bundles: BundleStore; checkpoints: Pick<CheckpointService, 'take' | 'head'>; worktrees: Worktrees };
    /* The bundles one machine sent, apart from every other machine's. */
    peerBundles(machineId: string): BundleStore;
    worktreePaths(folder: string): Promise<string[]>;
    /* Tells a machine that a task of it settled, over its own link if one is open. */
    notify(machineId: string, nodeId: string): void;
    log?: (line: string) => void;
}

// A branch longer than this is refused, so the folder and the files named after it stay far below any path limit.
export const PEER_MAX_BRANCH_LENGTH = 100;

// How many worktrees one machine's tasks may leave on this machine; a person removes them, nothing here does.
export const PEER_MAX_WORKTREES = 8;

/*
 * The tasks another machine gives agents here. B (this machine) decides everything that matters: the
 * project is the one the link names, the mode no wider than the link's ceiling, the depth within this
 * machine's own bound, and everything starts as an agent with launches held for a person. What the
 * other machine states is taken only where it is narrower.
 */
export class PeerTasks {
    private readonly deps: PeerTasksDeps;
    private readonly starts = new KeyedSerializer();
    // The bundles offered for a result and the machine each was made for, in memory like the files themselves.
    private readonly offered = new Map<string, { machineId: string; nodeId: string }>();
    // Tasks that machine stopped itself, which it needs no word of.
    private readonly stoppedByPeer = new Set<string>();
    // The transfers each channel began and no start used up yet, which go with the channel.
    private readonly uploads = new Map<string, { machineId: string; bundleIds: Set<string> }>();
    // The projects held for the tasks of each machine, by the channel that asked.
    private readonly holding = new Map<string, { clientId: string; machineId: string; projectId: string }>();

    constructor(deps: PeerTasksDeps) {
        this.deps = deps;
    }

    openCount(machineId: string): number {
        return this.deps.tasks.all().filter((task) => task.status === 'open' && this.peerOfTask(task) === machineId).length;
    }

    start(machineId: string, clientId: string, payload: PeerTaskStartPayload): Promise<PeerTaskStartResult> {
        // One start at a time per machine, so the count of open tasks is true when the next one is judged.
        return this.starts.run(machineId, async () => {
            try {
                return await this.startNow(machineId, clientId, payload);
            } finally {
                // Used up or refused, the copy that came in is no use again: a machine that tries once more sends it anew.
                if (payload.bundle !== undefined) {
                    this.forgetUpload(payload.bundle.bundleId);
                    await bestEffort('peerBundles.dropIncoming', this.deps.peerBundles(machineId).dropIncoming(payload.bundle.bundleId));
                }
            }
        });
    }

    private async startNow(machineId: string, clientId: string, payload: PeerTaskStartPayload): Promise<PeerTaskStartResult> {
        const { deps } = this;
        const { projectId, nodeId } = payload;
        const link = deps.links.linkOf(machineId, projectId);
        if (link === null) {
            throw new CodedError('peer-not-linked', 'That machine has no link to this project');
        }
        const folder = deps.projects.index.folderOf(projectId);
        if (folder === null) {
            throw new CodedError('project-not-found', `No project ${projectId} is on this machine`);
        }
        const held = deps.lineage.peerOf(nodeId);
        if (held !== null && held.machineId !== machineId) {
            throw new CodedError('peer-node-taken', 'A node of another machine has that id here');
        }
        if (held !== null && this.taskOf(machineId, nodeId) !== undefined) {
            // A start the other machine asks again because it never heard the answer.
            return await this.startedAs(machineId, nodeId, folder);
        }
        if (payload.branch !== undefined && payload.branch.length > PEER_MAX_BRANCH_LENGTH) {
            throw new CodedError('branch-too-long', `A branch from another machine may be ${PEER_MAX_BRANCH_LENGTH} characters long at most here`);
        }
        const provider = this.deps.providers.get(payload.provider);
        if (provider.ignoresProjectConfig !== true) {
            throw new CodedError(
                'peer-provider-unsupported',
                `${provider.name} cannot run a task from another machine here: it cannot be kept from loading the settings, hooks and tools of the files that machine sent. Give the task to a Claude agent instead`
            );
        }
        if (payload.terminal === true) {
            throw new CodedError(
                'peer-terminal-unsupported',
                'A terminal agent cannot run a task from another machine here: it cannot be kept from loading the settings, hooks and tools of the files that machine sent. Give the task to a chat agent instead'
            );
        }
        if (held === null && deps.exists(nodeId)) {
            // Started by someone else before the task came; its prompt and folder could not reach it any more.
            throw new CodedError('peer-node-taken', 'A chat or terminal with that id already runs on this machine');
        }
        if (this.openCount(machineId) >= PEER_MAX_OPEN_TASKS) {
            throw new CodedError('peer-busy', `This machine already runs ${PEER_MAX_OPEN_TASKS} tasks for that machine. Try again when one is done`);
        }
        const depth = Math.max(1, payload.depth);
        if (depth > MAX_AGENT_DEPTH) {
            throw new CodedError('depth-limit', `An agent from another machine may sit at depth ${MAX_AGENT_DEPTH} here, and this one would be at ${depth}`);
        }
        const caller = peerOpener(machineId, payload.parentId);
        if (deps.lineage.openedCount(caller) >= MAX_OPENED_PER_CALLER) {
            throw new CodedError('too-many-agents', `That agent has ${MAX_OPENED_PER_CALLER} agents open here already`);
        }
        if (!(await deps.installed()).includes(payload.provider)) {
            throw new CodedError('cli-not-installed', `${provider.name} is not installed on this machine`);
        }
        const chat = provider.capabilities.chat;
        // The narrowest of what it asks, what its own parent allows it and what the link here allows.
        const ceiling = narrowerMode(payload.ceiling, link.ceiling);
        const asked = payload.mode === undefined ? undefined : narrowerMode(payload.mode, ceiling);
        const runtimeMode: RuntimeMode | undefined = chat ? asked : narrowerMode(asked ?? DEFAULT_RUNTIME_MODE, ceiling);

        let cwd = folder;
        let branch: string | null = null;
        const known = deps.links.taskRecord(machineId, nodeId);
        if (known !== null) {
            // An earlier try of this very start made the folder already, and its bundle was used up by it.
            cwd = known.cwd;
            branch = known.worktree ? await this.branchOf(cwd) : null;
        } else if (payload.bundle !== undefined) {
            if (payload.branch === undefined) {
                throw new CodedError('bad-request', 'Work that comes as a bundle names its branch');
            }
            await this.refuseWhenFull(machineId, projectId, folder);
            // Untrusted before the folder exists, so there is no moment a folder with the files of that machine is trusted.
            const made = await fetchBundle(
                deps.peerBundles(machineId),
                deps.git().worktrees,
                folder,
                {
                    projectId,
                    bundleId: payload.bundle.bundleId,
                    sha256: payload.bundle.sha256,
                    branch: payload.branch,
                    into: 'worktree',
                    machine: link.label
                },
                (path, branch) => deps.links.untrustFolder(path, branch)
            );
            cwd = made.path ?? folder;
            branch = made.branch;
            await deps.links.recordTask(machineId, nodeId, { projectId, cwd, worktree: made.path !== undefined });
        }
        await checkCwd(folder, cwd, deps.worktreePaths).catch((e: unknown) => {
            throw e instanceof ToolRefusal ? new CodedError('cwd-outside', e.message) : e;
        });

        await this.place(
            machineId,
            link.label,
            projectId,
            {
                id: nodeId,
                kind: chat ? 'chat' : 'terminal',
                title: payload.title,
                cwd,
                provider: payload.provider,
                ...(chat ? { providerFixed: true } : {}),
                ...(!chat && runtimeMode !== undefined ? { runtimeMode } : {})
            },
            () =>
                deps.lineage.put({
                    projectId,
                    nodeId,
                    openedBy: caller,
                    depth,
                    agent: true,
                    ceiling,
                    peer: { machineId }
                })
        );
        if (payload.bundle !== undefined && known === null) {
            await bestEffort('worktrees.claim', deps.git().worktrees.claim(folder, cwd, nodeId));
        }
        const task = await deps.tasks.open(
            { projectId, parentId: peerCanvasId(machineId), childId: nodeId, title: payload.title, prompt: payload.prompt },
            Date.now()
        );
        try {
            const first = taskFirstPrompt(payload.prompt, chat);
            await deps.prompts.put(projectId, nodeId, first.prompt, { brief: first.brief });
            await deps.enqueue(projectId, nodeId, {
                kind: 'start-agent',
                payload: {
                    node: chat ? 'chat' : 'terminal',
                    provider: payload.provider,
                    cwd,
                    ...(runtimeMode === undefined ? {} : { runtimeMode }),
                    ceiling
                }
            });
            await deps.links.touch(machineId, projectId);
        } catch (e) {
            await this.abandon(task, e);
            throw e;
        }
        // Holding keeps the project loaded for the agent; only a person opening it starts its autostart launches.
        deps.projects.hold(clientId, projectId, { startsLaunches: false });
        this.holding.set(`${clientId}\t${projectId}`, { clientId, machineId, projectId });
        return { cwd, branch };
    }

    /* A person removes worktrees, so the places still taken are those whose folder is still there. */
    private async refuseWhenFull(machineId: string, projectId: string, folder: string): Promise<void> {
        const { links } = this.deps;
        let kept = 0;
        for (const [nodeId, record] of links.taskRecordsOf(machineId)) {
            if (record.projectId !== projectId || !record.worktree) {
                continue;
            }
            if ((await stat(record.cwd).catch(() => null))?.isDirectory() === true) {
                kept += 1;
            } else {
                await links.forgetTask(machineId, nodeId);
            }
        }
        if (kept >= PEER_MAX_WORKTREES) {
            throw new CodedError(
                'peer-worktrees-full',
                `This machine already keeps ${kept} worktrees for tasks of that machine in ${folder}. Remove the ones that are done from the worktrees of this project in the git panel on this machine, then give the task again.`
            );
        }
    }

    /* A start that failed after its task opened: the task fails with the reason, so it holds no place and a retry hears what became of it. */
    private async abandon(task: Task, error: unknown): Promise<void> {
        const text = `The task could not be started on this machine: ${error instanceof Error ? error.message : String(error)}`;
        await this.deps.prompts.take(task.childId).catch(() => null);
        await this.deps.tasks.settle(task.id, 'failed', { text, source: 'exit', at: Date.now() }, Date.now());
        await this.deps.tasks.markWoken([task.id]);
    }

    /*
     * Puts the node on this machine's canvas for that machine, taking over a node of the same id only when
     * that machine's window placed it or an earlier try of this task did. `claim` runs inside the write,
     * so the node is a task's before the window can place anything else.
     */
    private async place(machineId: string, label: string, projectId: string, node: PeerNode, claim: () => Promise<void>): Promise<void> {
        const { deps } = this;
        const canvasId = peerCanvasId(machineId);
        await deps.projects.mutate(projectId, async (content) => {
            if (idTakenOutside(content.views, canvasId, new Set([node.id]))) {
                throw new CodedError('peer-node-taken', 'A node of that machine has the id of a view or node here');
            }
            const held = content.views.find((view): view is ProjectCanvasView => view.id === canvasId && isCanvasView(view));
            const existing = held?.nodes.find((other) => other.id === node.id);
            const placed = deps.links.placedOf(machineId, projectId);
            if (existing !== undefined && !placed.has(node.id) && deps.lineage.peerOf(node.id)?.machineId !== machineId) {
                throw new CodedError('peer-node-taken', 'A node of that machine has the id of a node a person placed here');
            }
            await claim();
            if (placed.has(node.id)) {
                await deps.links.setPlaced(
                    machineId,
                    projectId,
                    [...placed].filter((id) => id !== node.id)
                );
            }
            const others = (held?.nodes ?? []).filter((other) => other.id !== node.id);
            const placedNode =
                existing === undefined ? nodeOf(node, others.length) : { ...nodeOf(node, 0), x: existing.x, y: existing.y, w: existing.w, h: existing.h };
            const base: ProjectCanvasView =
                held === undefined ? { kind: 'canvas', id: canvasId, name: label, nodes: [], texts: [], edges: [], layouts: [] } : stripHidden(held);
            const canvas: ProjectCanvasView = { ...base, nodes: [...others, placedNode] };
            if (held !== undefined && sameCanvas(held, canvas)) {
                return { content: null, result: null };
            }
            const views = held === undefined ? [...content.views, canvas] : content.views.map((view) => (view.id === canvasId ? canvas : view));
            return { content: { ...content, views }, result: null };
        });
    }

    private async startedAs(machineId: string, nodeId: string, folder: string): Promise<PeerTaskStartResult> {
        const record = this.deps.links.taskRecord(machineId, nodeId);
        const cwd = record?.cwd ?? folder;
        return { cwd, branch: record?.worktree === true ? await this.branchOf(cwd) : null };
    }

    private async branchOf(cwd: string): Promise<string | null> {
        const name = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd))?.trim();
        return name === undefined || name === '' || name === 'HEAD' ? null : name;
    }

    /* Ends the agent and its task. A node this machine never started for that machine is nothing to end. */
    async stop(machineId: string, nodeId: string): Promise<void> {
        if (this.deps.lineage.peerOf(nodeId)?.machineId !== machineId) {
            return;
        }
        this.stoppedByPeer.add(nodeId);
        try {
            await this.deps.stopNode(nodeId, 'the machine that gave this task stopped it');
            await this.settleDelivery(nodeId);
        } finally {
            this.stoppedByPeer.delete(nodeId);
        }
    }

    async result(machineId: string, clientId: string, payload: PeerResultPayload): Promise<PeerResultResult> {
        const task = this.taskOf(machineId, payload.nodeId);
        if (task === undefined) {
            return { status: 'unknown', result: null, bundle: null };
        }
        if (task.status === 'open') {
            return { status: 'open', result: null, bundle: null };
        }
        if (payload.ack === true) {
            // The machine has the work already; a bundle made for this call would be one nobody reads.
            await this.discardOffered(machineId, task.childId);
            await this.settleDelivery(payload.nodeId, task);
            return { status: task.status, result: task.result, bundle: null };
        }
        const bundle = await this.resultBundle(machineId, clientId, task, payload.haves ?? []);
        return { status: task.status, result: task.result, bundle };
    }

    /* The other machine has the result: it is not offered again, and the entry that waited for this goes. */
    private async settleDelivery(nodeId: string, known?: Task): Promise<void> {
        const task = known ?? this.deps.tasks.all().find((candidate) => candidate.childId === nodeId && this.peerOfTask(candidate) !== null);
        if (task !== undefined) {
            await this.deps.tasks.markWoken([task.id]);
        }
        for (const entry of this.deps.outbox.ofKind('deliver-remote-result')) {
            if (entry.payload.nodeId === nodeId) {
                await this.deps.outbox.remove(entry.id);
            }
        }
    }

    private async discardOffered(machineId: string, nodeId: string): Promise<void> {
        const offered = [...this.offered].find(([, who]) => who.machineId === machineId && who.nodeId === nodeId);
        if (offered !== undefined) {
            this.offered.delete(offered[0]);
            await this.deps.peerBundles(machineId).discard(offered[0]);
        }
    }

    private async resultBundle(machineId: string, clientId: string, task: Task, haves: string[]): Promise<PeerResultResult['bundle']> {
        const { deps } = this;
        const folder = deps.projects.index.folderOf(task.projectId);
        const record = deps.links.taskRecord(machineId, task.childId);
        // An agent that worked in the project folder itself has no work of its own to carry back.
        if (folder === null || record === null || !record.worktree) {
            return null;
        }
        // Read from what this machine wrote down, never from the project file, which an agent with a shell can rewrite.
        const { cwd } = record;
        const inside = await checkCwd(folder, cwd, deps.worktreePaths).then(
            () => true,
            () => false
        );
        const branch = inside ? await this.branchOf(cwd) : null;
        if (branch === null) {
            return null;
        }
        await this.discardOffered(machineId, task.childId);
        const bundles = deps.peerBundles(machineId);
        const { checkpoints } = deps.git();
        const id = crypto.randomUUID();
        bundles.admit(clientId, id);
        const made = await makeBundle(bundles, checkpoints, { path: cwd, from: 'files', haves, name: task.title.slice(0, 120) }, id).catch(
            async (error: unknown) => {
                await bundles.discard(id);
                throw error;
            }
        );
        await bundles.keep(made.bundleId, clientId);
        this.offered.set(made.bundleId, { machineId, nodeId: task.childId });
        return { ...made, branch };
    }

    /* A piece of a bundle that machine sends; the pieces come in order and a bundle is held apart from every other machine's. */
    async bundlePut(machineId: string, clientId: string, payload: PeerBundlePutPayload): Promise<number> {
        // Held before the piece is written, so a drop of the broken channel's copy queued meanwhile leaves this one alone.
        const begun = this.uploads.get(clientId) ?? { machineId, bundleIds: new Set<string>() };
        const added = !begun.bundleIds.has(payload.bundleId);
        begun.bundleIds.add(payload.bundleId);
        this.uploads.set(clientId, begun);

        try {
            return await this.deps.peerBundles(machineId).receive(payload.bundleId, payload.offset, Buffer.from(payload.data, 'base64'), payload.total);
        } catch (error) {
            // A refused first piece leaves nothing in the store, and keeping its id would let a refused peer grow this map.
            if (added) {
                begun.bundleIds.delete(payload.bundleId);
            }
            throw error;
        }
    }

    /* A piece of a bundle offered to that machine, and only to it. */
    async bundleRead(machineId: string, payload: PeerBundleReadPayload): Promise<PeerBundleReadResult> {
        const who = this.offered.get(payload.bundleId);
        const path = who?.machineId === machineId ? await this.deps.peerBundles(machineId).made(payload.bundleId) : null;
        if (path === null) {
            throw new CodedError('bundle-missing', 'That machine was not offered this work, or it is gone. Ask for the result again.');
        }
        const file = Bun.file(path);
        const size = file.size;
        if (size > BUNDLE_MAX_BYTES) {
            throw new CodedError('bundle-too-large', 'This work is too large to send. Push the branch to origin and fetch it there instead.');
        }
        if (payload.offset > size) {
            throw new CodedError('bad-offset', `Offset ${payload.offset} is past the end of a file of ${size} bytes`);
        }
        const end = Math.min(payload.offset + payload.length, size);
        const data = Buffer.from(await file.slice(payload.offset, end).arrayBuffer()).toString('base64');
        if (end === size) {
            this.offered.delete(payload.bundleId);
            await this.deps.peerBundles(machineId).discard(payload.bundleId);
        }
        return { size, offset: payload.offset, data };
    }

    close(clientId: string, projectId: string): void {
        this.holding.delete(`${clientId}\t${projectId}`);
        this.deps.projects.letGo(clientId, projectId);
    }

    /* The channel of a machine is gone: what it held goes with it, as a client's holds do. */
    channelClosed(clientId: string): void {
        this.dropUploads(clientId);
        for (const held of [...this.holding.values()].filter((candidate) => candidate.clientId === clientId)) {
            this.close(held.clientId, held.projectId);
        }
    }

    /* A transfer that broke off with its channel is sent again from the start, so what arrived of it only takes a place. */
    private dropUploads(clientId: string): void {
        const begun = this.uploads.get(clientId);
        this.uploads.delete(clientId);
        if (begun === undefined) {
            return;
        }
        const store = this.deps.peerBundles(begun.machineId);
        // After a start in flight, which may be reading one of them.
        void this.starts
            .run(begun.machineId, async () => {
                for (const bundleId of begun.bundleIds) {
                    // A channel that came back began this transfer anew under the same id, and that copy is its own.
                    if (!this.heldByLiveChannel(bundleId)) {
                        await store.dropIncoming(bundleId);
                    }
                }
            })
            .catch((e: unknown) => this.deps.log?.(`Dropping a broken transfer failed: ${errorText(e)}`));
    }

    private heldByLiveChannel(bundleId: string): boolean {
        return [...this.uploads.values()].some((begun) => begun.bundleIds.has(bundleId));
    }

    private forgetUpload(bundleId: string): void {
        for (const begun of this.uploads.values()) {
            begun.bundleIds.delete(bundleId);
        }
    }

    /* Nothing runs here for that machine any more, so nothing keeps its projects loaded or keeps a person from closing them. */
    private releaseHolds(machineId: string): void {
        for (const held of [...this.holding.values()].filter((candidate) => candidate.machineId === machineId)) {
            this.close(held.clientId, held.projectId);
        }
    }

    openNodesOf(machineId: string, projectId: string): string[] {
        return this.deps.tasks
            .all()
            .filter((task) => task.status === 'open' && task.projectId === projectId && this.peerOfTask(task) === machineId)
            .map((task) => task.childId);
    }

    /* Tells a machine that tasks of it ended without a result of their own, such as when its link goes. */
    tellEnded(machineId: string, nodeIds: readonly string[]): void {
        for (const nodeId of nodeIds) {
            this.deps.notify(machineId, nodeId);
        }
    }

    /* The link of that machine to this project is gone, so the results owed for it can never be acknowledged and are not owed any more. */
    async lapseDeliveries(machineId: string, projectId: string): Promise<void> {
        const { deps } = this;
        for (const entry of deps.outbox.ofKind('deliver-remote-result')) {
            if (entry.payload.machineId === machineId && entry.projectId === projectId) {
                await deps.outbox.remove(entry.id);
            }
        }
        // Left pending, a restart would owe them again.
        const settled = deps.tasks
            .all()
            .filter((task) => task.projectId === projectId && task.status !== 'open' && task.wake === 'pending' && this.peerOfTask(task) === machineId);
        if (settled.length > 0) {
            await deps.tasks.markWoken(settled.map((task) => task.id));
        }
    }

    /* Owes the machine its result once a task of it settled; a task it cancelled itself owes nothing. */
    changed(task: Task): void {
        const machineId = this.peerOfTask(task);
        if (machineId !== null && task.status !== 'open' && this.openCount(machineId) === 0) {
            this.releaseHolds(machineId);
        }
        if (machineId !== null && task.status === 'cancelled' && !this.stoppedByPeer.has(task.childId)) {
            // Stopped or removed here by a person: nobody owes a result, but the machine that gave the task is told how it ended.
            this.deps.notify(machineId, task.childId);
        }
        if (machineId === null || (task.status !== 'done' && task.status !== 'failed') || task.wake !== 'pending') {
            return;
        }
        this.oweResult(machineId, task).catch((e: unknown) => this.deps.log?.(`Owing a result to another machine failed: ${errorText(e)}`));
    }

    /* Owes again what an earlier run settled and nobody acknowledged. Call once the outbox is loaded. */
    async recover(): Promise<void> {
        for (const task of this.deps.tasks.all()) {
            const machineId = this.peerOfTask(task);
            if (machineId !== null && (task.status === 'done' || task.status === 'failed') && task.wake === 'pending') {
                await this.oweResult(machineId, task);
            }
        }
    }

    private async oweResult(machineId: string, task: Task): Promise<void> {
        const owed = this.deps.outbox.ofKind('deliver-remote-result').some((entry) => entry.payload.taskId === task.id);
        if (!owed) {
            await this.deps.enqueue(task.projectId, peerLane(machineId), {
                kind: 'deliver-remote-result',
                payload: { machineId, nodeId: task.childId, taskId: task.id }
            });
        }
    }

    /* The work of the `deliver-remote-result` entry: say once that the result waits, then wait for the acknowledgment. */
    readonly deliver = async (entry: DeliverRemoteResultEntry): Promise<'wait' | undefined> => {
        const task = this.deps.tasks.get(entry.payload.taskId);
        if (task === undefined || task.wake !== 'pending') {
            return undefined;
        }
        this.deps.notify(entry.payload.machineId, entry.payload.nodeId);
        return 'wait';
    };

    /* The ids that stand in for the parents of such tasks in a project: the canvases of the machines that work in it. */
    parents(projectId: string): ReadonlySet<string> {
        return this.deps.links.canvasIdsOf(projectId);
    }

    isPeerTask(task: Task): boolean {
        return this.peerOfTask(task) !== null;
    }

    private peerOfTask(task: Task): string | null {
        const peer = this.deps.lineage.peerOf(task.childId);
        return peer !== null && task.parentId === peerCanvasId(peer.machineId) ? peer.machineId : null;
    }

    private taskOf(machineId: string, nodeId: string): Task | undefined {
        return this.deps.tasks.all().find((task) => task.childId === nodeId && this.peerOfTask(task) === machineId);
    }
}

import type { PeerNode, ProjectEdge, ProjectView, RemoteLink } from '@ruimte/contracts';
import { isCanvasView } from '@ruimte/contracts';
import { markUnlinked } from '@/clients/project/remote-refusals';
import type { CanvasNode } from '@/state/canvas';
import type { NodesOfView } from '@/state/view-nodes';
import { TransportError, type Transport, fireAndForget, orNull } from '@/transport-api/transport';

/* What one machine is to draw of this project: the nodes that run there and the lines between them. */
interface MachineMirror {
    nodes: PeerNode[];
    edges: ProjectEdge[];
}

const EMPTY: MachineMirror = { nodes: [], edges: [] };

function peerNodeOf(node: CanvasNode): PeerNode | null {
    if (node.kind !== 'terminal' && node.kind !== 'chat' && node.kind !== 'device') {
        return null;
    }
    // Only what the other machine can start from: its session, its accounts and its place on this canvas mean nothing there.
    return {
        id: node.id,
        kind: node.kind,
        title: node.title,
        ...(node.cwd === undefined ? {} : { cwd: node.cwd }),
        ...(node.command === undefined ? {} : { command: node.command }),
        ...(node.provider === undefined ? {} : { provider: node.provider }),
        ...(node.providerFixed === undefined ? {} : { providerFixed: node.providerFixed }),
        ...(node.runtimeMode === undefined ? {} : { runtimeMode: node.runtimeMode }),
        ...(node.accent === undefined ? {} : { accent: node.accent }),
        ...(node.issue === undefined ? {} : { issue: node.issue }),
        ...(node.device === undefined ? {} : { device: node.device })
    };
}

/*
 * Per machine, the nodes of the project that run on it and the lines whose two ends both run on it.
 * A line to a node here or on another machine reaches nobody there, so it is not sent.
 */
export function remoteMirrorsOf(views: readonly ProjectView[], nodesOf: NodesOfView<CanvasNode>, workspaceId: string): Map<string, MachineMirror> {
    const mirrors = new Map<string, MachineMirror>();
    for (const view of views) {
        if (!isCanvasView(view)) {
            continue;
        }
        const machineOf = new Map<string, string>();
        for (const node of nodesOf(view)) {
            const peer = node.machine === undefined || node.machine === workspaceId ? null : peerNodeOf(node);
            if (peer === null || node.machine === undefined) {
                continue;
            }
            machineOf.set(node.id, node.machine);
            const mirror = mirrors.get(node.machine) ?? { nodes: [], edges: [] };
            mirror.nodes.push(peer);
            mirrors.set(node.machine, mirror);
        }
        for (const edge of view.edges) {
            const machine = machineOf.get(edge.from);
            if (machine !== undefined && machine === machineOf.get(edge.to)) {
                mirrors.get(machine)!.edges.push(edge);
            }
        }
    }
    return mirrors;
}

type Requester = Pick<Transport, 'request' | 'status' | 'subscribeStatus'>;

/* What a mirror reads of the window and reaches of the machines, handed in so a test needs neither. */
export interface RemoteMirrorHost {
    /* The project this workspace shows, null while another one is in the stores or none. */
    projectId(): string | null;
    /* This machine as the others know it, which is what they keep their link under. */
    selfId(): string;
    views(): readonly ProjectView[];
    nodesOf: NodesOfView<CanvasNode>;
    /* A change of the document or of a canvas on screen. */
    subscribe(listener: () => void): () => void;
    /* The links of this project to checkouts on other machines. */
    links(projectId: string): Promise<RemoteLink[]>;
    transportOf(machineId: string): Requester | null;
    /* A machine now shows nodes of this window; its right to work in this one may need renewing. */
    renewPeer?(machineId: string): Promise<void>;
}

/*
 * Keeps the copy of this project's remote nodes that each other machine holds, and lets go of that
 * project there when this one is closed or left. One request per machine per change, coalesced to a
 * microtask, and resent when a machine's link comes back: the machine forgets who holds a project with
 * the socket that held it.
 */
export class RemoteMirror {
    private readonly host: RemoteMirrorHost;
    /* What each machine was last told, so only a change is sent. */
    private readonly sent = new Map<string, string>();
    private readonly watching = new Map<string, () => void>();
    private links: { projectId: string; byMachine: Map<string, RemoteLink> } | null = null;
    private queued = false;
    private holds = 0;
    private flushing: Promise<void> = Promise.resolve();
    private off: (() => void) | null = null;

    constructor(host: RemoteMirrorHost) {
        this.host = host;
    }

    start(): () => void {
        this.off?.();
        const stop = this.host.subscribe(() => this.schedule());
        this.schedule();
        this.off = () => {
            stop();
            for (const unwatch of this.watching.values()) {
                unwatch();
            }
            this.watching.clear();
        };
        return this.off;
    }

    dispose(): void {
        this.off?.();
        this.off = null;
    }

    /* Each change of the stores asks once, and the microtask sends what the stores say by then. */
    schedule(): void {
        if (this.queued) {
            return;
        }
        this.queued = true;
        queueMicrotask(() => {
            this.queued = false;
            this.flushing = fireAndForget(
                'flushing.then',
                this.flushing.then(() => this.flush())
            );
        });
    }

    /*
     * Nothing is sent while a hold is taken, and what changed is sent once the last one is let go. A node
     * on its way into the project is only told to the other machine after the project has it.
     */
    hold(): () => void {
        this.holds += 1;
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            this.holds -= 1;
            this.schedule();
        };
    }

    /* Tells a machine its nodes again, for a machine that took the link up once more or that linked the project anew. */
    resend(machine: string): void {
        this.sent.delete(machine);
        this.schedule();
    }

    /*
     * The project is linked to another project on that machine: the link is read anew, and the project there
     * that held this window's nodes ends them and is let go, as closing does, before the nodes go to the new one.
     */
    async relink(machine: string, remoteProjectId: string): Promise<void> {
        const before = this.links?.byMachine.get(machine);
        const transport = this.host.transportOf(machine);
        if (before !== undefined && before.remoteProjectId !== remoteProjectId && this.sent.has(machine) && transport?.status === 'open') {
            await this.letGo(transport, before.remoteProjectId);
        }
        this.links = null;
        this.resend(machine);
    }

    /* Settled once what is queued has been sent. */
    async settled(): Promise<void> {
        do {
            // After the microtask that starts the queued send, which was queued before this turn.
            await Promise.resolve();
            await this.flushing;
        } while (this.queued);
    }

    /*
     * The project is closed here: every machine that holds a copy ends this machine's nodes there and lets go of the project.
     * The project itself stays open there, since its own canvases and sessions are not this window's to end.
     */
    async close(): Promise<void> {
        await Promise.all(this.eachHeld((transport, link) => this.letGo(transport, link.remoteProjectId)));
        this.sent.clear();
    }

    /* The project there ends this machine's nodes and is let go of. */
    private async letGo(transport: Requester, projectId: string): Promise<void> {
        await fireAndForget('peer.placeNodes', transport.request('peer.placeNodes', { machineId: this.host.selfId(), projectId, nodes: [], edges: [] }));
        await fireAndForget('project.release', transport.request('project.release', { projectId }));
    }

    /* The project is left or the window goes: the holds go, and the projects stay open there. */
    release(): void {
        // On their way is all a page that is leaving can ask for.
        void Promise.all(
            this.eachHeld((transport, link) => fireAndForget('project.release', transport.request('project.release', { projectId: link.remoteProjectId })))
        );
        this.sent.clear();
    }

    private eachHeld<T>(run: (transport: Requester, link: RemoteLink) => Promise<T>): Promise<T>[] {
        const links = this.links?.byMachine;
        if (links === undefined) {
            return [];
        }
        return [...this.sent.keys()].flatMap((machine) => {
            const link = links.get(machine);
            const transport = this.host.transportOf(machine);
            return link === undefined || transport === null || transport.status !== 'open' ? [] : [run(transport, link)];
        });
    }

    private async linkOf(projectId: string, machine: string): Promise<RemoteLink | undefined> {
        if (this.links?.projectId !== projectId || !this.links.byMachine.has(machine)) {
            // Asked again whenever a machine is missing, since a link made a moment ago is what the first send waits for.
            const links = await orNull('host.links', this.host.links(projectId));
            if (links === null) {
                return undefined;
            }
            this.links = { projectId, byMachine: new Map(links.map((link) => [link.machineId, link])) };
        }
        return this.links.byMachine.get(machine);
    }

    private watch(machine: string, transport: Requester): void {
        if (!this.watching.has(machine)) {
            // A link that comes back is a machine that forgot this window held its project.
            this.watching.set(
                machine,
                transport.subscribeStatus((status) => {
                    if (status === 'open') {
                        this.sent.delete(machine);
                        this.schedule();
                    }
                })
            );
        }
    }

    private async flush(): Promise<void> {
        if (this.holds > 0) {
            return;
        }
        const projectId = this.host.projectId();
        if (projectId === null) {
            this.sent.clear();
            return;
        }
        const wanted = remoteMirrorsOf(this.host.views(), this.host.nodesOf, this.host.selfId());
        for (const machine of new Set([...wanted.keys(), ...this.sent.keys()])) {
            const mirror = wanted.get(machine) ?? EMPTY;
            const signature = JSON.stringify(mirror);
            const transport = this.host.transportOf(machine);
            if (transport !== null) {
                this.watch(machine, transport);
            }
            if (this.sent.get(machine) === signature || (this.sent.get(machine) === undefined && mirror === EMPTY)) {
                continue;
            }
            const link = await this.linkOf(projectId, machine);
            if (link === undefined || transport === null || transport.status !== 'open') {
                continue;
            }
            try {
                await transport.request('peer.placeNodes', {
                    machineId: this.host.selfId(),
                    projectId: link.remoteProjectId,
                    nodes: mirror.nodes,
                    edges: mirror.edges
                });
                this.sent.set(machine, signature);
                markUnlinked(machine, false);
                if (mirror.nodes.length > 0) {
                    void fireAndForget('host.renewPeer', this.host.renewPeer?.(machine));
                }
            } catch (e) {
                // Not marked as sent, so the next change or the link coming back sends it again.
                markUnlinked(machine, e instanceof TransportError && e.code === 'peer-not-linked');
            }
        }
    }
}

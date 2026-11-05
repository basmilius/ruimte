import { CodedError } from '@adecore/agents';
import { ToolRefusal } from '@adecore/agents/context';
import type { AgentLineageStore } from '@adecore/agents/coordination';
import { isCanvasView, sessionNodesOfView, type PeerLink, type ProjectCanvasView, type ProjectEdge } from '@ruimte/contracts';
import { type Dispatcher } from '../dispatcher.ts';
import { peerCanvasId, type PeerLinks } from '../peering/links.ts';
import { idTakenOutside, nodeOf, sameCanvas, stripHidden } from '../peering/peer-canvas.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { checkCwd } from '../tools/project-paths.ts';

/* What the requests of another machine's links reach of this one. */
interface PeerHost {
    links: PeerLinks;
    /* The tasks of a machine that its link ends with: they are told to it when the link goes. */
    tasks?: {
        openNodesOf(machineId: string, projectId: string): string[];
        tellEnded(machineId: string, nodeIds: readonly string[]): void;
        /* Lets go of the results owed to the machine for this project, which it can no longer acknowledge. */
        lapseDeliveries(machineId: string, projectId: string): Promise<void>;
    };
    /* Which nodes are a task's: a window that draws a machine's nodes never rewrites those. */
    lineage: Pick<AgentLineageStore, 'peerOf'>;
    projects: Pick<ProjectStore, 'known' | 'read' | 'mutate' | 'hold'> & { index: Pick<ProjectStore['index'], 'folderOf'> };
    /* Until when the address book vouches for a machine's peer key, null when it never worked here. */
    attestedUntil?(machineId: string): Promise<number | null>;
    /* Ends the shell or the CLI behind a node, the way deleting the node does. */
    endSession(kind: 'terminal' | 'chat', nodeId: string): Promise<void>;
    /* The worktrees of the repository in a project folder, which a node may start in as well. */
    worktreePaths(folder: string): Promise<string[]>;
}

/*
 * The links other machines have to projects here. Any client may make, change and remove one, since a
 * person on any client of the account is a person on this machine as far as its projects go. An agent
 * has no socket, so it never reaches these.
 */
export function registerPeerHandlers(dispatcher: Dispatcher, { links, lineage, tasks, projects, endSession, worktreePaths, attestedUntil }: PeerHost): void {
    const namesOf = async (): Promise<Map<string, string>> => new Map((await projects.known()).map((project) => [project.projectId, project.name]));

    const withName = (link: Omit<PeerLink, 'projectName'>, names: ReadonlyMap<string, string>): PeerLink => ({
        ...link,
        projectName: names.get(link.projectId) ?? ''
    });

    dispatcher.register('peer.list', async () => {
        const names = await namesOf();
        const attested = new Map<string, number | null>();
        for (const machineId of new Set(links.list().map((link) => link.machineId))) {
            attested.set(machineId, (await attestedUntil?.(machineId)) ?? null);
        }
        return {
            links: links.list().map((link) => {
                const until = attested.get(link.machineId) ?? null;
                return { ...withName(link, names), ...(until === null ? {} : { attestedUntil: until }) };
            })
        };
    });

    dispatcher.register('peer.bind', async (payload) => {
        const names = await namesOf();
        if (!names.has(payload.projectId)) {
            throw new CodedError('project-not-found', `No project ${payload.projectId} is on this machine`);
        }
        return withName(await links.bind(payload.machineId, payload.label, payload.projectId, payload.ceiling), names);
    });

    dispatcher.register('peer.setCeiling', async (payload) => {
        if (!(await links.setCeiling(payload.machineId, payload.projectId, payload.ceiling))) {
            throw new CodedError('peer-not-linked', 'That machine has no link to this project');
        }
        return {};
    });

    /* The nodes of that machine end first, as a deleted node's do, and then their canvas and the link go. */
    dispatcher.register('peer.unbind', async (payload) => {
        if (links.linkOf(payload.machineId, payload.projectId) === null) {
            throw new CodedError('peer-not-linked', 'That machine has no link to this project');
        }
        const canvasId = peerCanvasId(payload.machineId);
        const open = tasks?.openNodesOf(payload.machineId, payload.projectId) ?? [];
        const content = await projects.read(payload.projectId).catch(() => null);
        const canvas = content?.views.find((view) => view.id === canvasId);
        if (canvas !== undefined) {
            for (const node of sessionNodesOfView(canvas)) {
                await endSession(node.kind, node.id);
            }
            await projects.mutate(payload.projectId, (current) => ({
                content: { ...current, views: current.views.filter((view) => view.id !== canvasId) },
                result: null
            }));
        }
        await links.unbind(payload.machineId, payload.projectId);
        await tasks?.lapseDeliveries(payload.machineId, payload.projectId);
        // The tasks went with the link; the machine that gave them hears that and asks what became of them.
        tasks?.tellEnded(payload.machineId, open);
        return {};
    });

    /*
     * The nodes another machine draws on its canvas for this one, kept on a canvas of their own so this
     * machine's rules reach them like any node: folders, modes, launch approvals and lines. The
     * window that asks holds the project from then on, but starts none of its autostart launches: only a person opening it does.
     */
    dispatcher.register('peer.placeNodes', async (payload, client) => {
        const { machineId, projectId, nodes, edges } = payload;
        const link = links.linkOf(machineId, projectId);
        if (link === null) {
            throw new CodedError('peer-not-linked', 'That machine has no link to this project');
        }
        const ids = new Set(nodes.map((node) => node.id));
        if (edges.some((edge) => !ids.has(edge.from) || !ids.has(edge.to))) {
            throw new CodedError('edge-off-machine', 'A line may only join two nodes of the same machine');
        }
        const folder = projects.index.folderOf(projectId);
        if (folder === null) {
            throw new CodedError('project-not-found', `No project ${projectId} is on this machine`);
        }
        for (const node of nodes) {
            if (node.cwd !== undefined) {
                await checkCwd(folder, node.cwd, worktreePaths).catch((e: unknown) => {
                    throw e instanceof ToolRefusal ? new CodedError('cwd-outside', e.message) : e;
                });
            }
        }
        const canvasId = peerCanvasId(machineId);
        const gone = await projects.mutate(projectId, async (current) => {
            const placedBefore = links.placedOf(machineId, projectId);
            if (idTakenOutside(current.views, canvasId, ids)) {
                throw new CodedError('peer-node-taken', 'A node of that machine has the id of a view or node here');
            }
            const held = current.views.find((view): view is ProjectCanvasView => view.id === canvasId && isCanvasView(view));
            const before = held?.nodes ?? [];
            // Whatever the window did not place itself stays as it is, a task that machine gave included, whatever the window draws of it.
            const tasks = new Set(before.filter((node) => lineage.peerOf(node.id)?.machineId === machineId).map((node) => node.id));
            const kept = before.filter((node) => !placedBefore.has(node.id) || tasks.has(node.id));
            const keptIds = new Set(kept.map((node) => node.id));
            const mirrored = nodes.filter((node) => !keptIds.has(node.id));
            const mirrorIds = new Set(mirrored.map((node) => node.id));
            const devices = new Set([...kept, ...mirrored].filter((node) => node.kind === 'device').map((node) => node.id));
            // A line the other machine draws never reaches a task it gave here or a device, so no agent here gets a device to drive from it.
            const mirrors = (edge: ProjectEdge): boolean =>
                !(keptIds.has(edge.from) && keptIds.has(edge.to)) && ![edge.from, edge.to].some((end) => tasks.has(end) || devices.has(end));
            const canvas: ProjectCanvasView = {
                ...(held === undefined ? { kind: 'canvas', id: canvasId, texts: [], layouts: [] } : stripHidden(held)),
                name: link.label,
                nodes: [...kept, ...mirrored.map(nodeOf)],
                edges: [...(held?.edges ?? []).filter((edge) => !placedBefore.has(edge.from) && !placedBefore.has(edge.to)), ...edges.filter(mirrors)]
            };
            await links.setPlaced(machineId, projectId, mirrorIds);
            const leaving = before.filter((node) => placedBefore.has(node.id) && !mirrorIds.has(node.id) && !tasks.has(node.id));
            if (held !== undefined && sameCanvas(held, canvas)) {
                return { content: null, result: leaving };
            }
            const views = held === undefined ? [...current.views, canvas] : current.views.map((view) => (view.id === canvasId ? canvas : view));
            return { content: { ...current, views }, result: leaving };
        });
        // A node the other machine no longer draws ends like a deleted one, once the write that drops it landed.
        for (const left of gone) {
            if (left.kind === 'terminal' || left.kind === 'chat') {
                await endSession(left.kind, left.id);
            }
        }
        await links.touch(machineId, projectId);
        if (!client.closed) {
            // Holding keeps the project loaded for these nodes; only a person opening it starts its autostart launches.
            projects.hold(client.id, projectId, { startsLaunches: false });
        }
        return {};
    });
}

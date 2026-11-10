import { RecordDirectory } from '@adecore/agents';
import { RemoteLinkSchema, isCanvasView, type ProjectContent, type ProjectNode, type ProjectView, type RemoteLink } from '@ruimte/contracts';
import { homeFolder } from '@ruimte/service/home';
import { z } from 'zod';

/*
 * Loose, so a file a newer daemon wrote keeps its other keys. `links` is kept as it was read: the code
 * that makes links owns their shape.
 */
const RemoteFileSchema = z.looseObject({
    projectId: z.string().min(1),
    links: z.array(z.unknown()).default([]),
    // Node id to the daemon id of the machine the node runs on.
    nodes: z.record(z.string().min(1), z.string().min(1)).default({})
});

type RemoteFile = z.infer<typeof RemoteFileSchema>;

/*
 * Which node of which project runs on another machine, under `$RUIMTE_HOME/remote`. Never in a project
 * file: a saved file is one a colleague can push, a client of an older release drops a field it does not
 * know, and an agent with a shell can rewrite it. Only a person's `project.save` sets a binding.
 */
export class RemoteStore {
    private readonly files: RecordDirectory<RemoteFile>;

    constructor(home: string) {
        this.files = new RecordDirectory({ dir: homeFolder(home, 'remote'), schema: RemoteFileSchema, idOf: (file) => file.projectId });
    }

    /* Reads what an earlier run of the daemon wrote down. Call before any session is made. */
    load(): Promise<void> {
        return this.files.load();
    }

    nodesOf(projectId: string): Readonly<Record<string, string>> {
        return this.files.get(projectId)?.nodes ?? {};
    }

    machineOf(projectId: string, nodeId: string): string | null {
        const nodes = this.nodesOf(projectId);
        return Object.hasOwn(nodes, nodeId) ? nodes[nodeId]! : null;
    }

    /*
     * Sets what a person's save named, for nodes the save holds. A node the save did not name keeps its
     * binding, which is what an older client's save amounts to.
     */
    async bind(projectId: string, asked: ReadonlyMap<string, string>, alive: ReadonlySet<string>): Promise<void> {
        const file = this.files.get(projectId);
        const nodes = { ...file?.nodes };
        for (const [nodeId, machineId] of asked) {
            if (alive.has(nodeId)) {
                nodes[nodeId] = machineId;
            }
        }
        await this.keep(projectId, nodes);
    }

    /* Puts the bindings back as they were before a save whose write failed. */
    restore(projectId: string, nodes: Readonly<Record<string, string>>): Promise<void> {
        return this.keep(projectId, { ...nodes });
    }

    async prune(projectId: string, alive: ReadonlySet<string>): Promise<void> {
        const file = this.files.get(projectId);
        if (file === undefined) {
            return;
        }
        await this.keep(projectId, Object.fromEntries(Object.entries(file.nodes).filter(([nodeId]) => alive.has(nodeId))));
    }

    private async keep(projectId: string, nodes: Record<string, string>): Promise<void> {
        const file = this.files.get(projectId);
        const held = file?.nodes ?? {};
        const same = Object.keys(nodes).length === Object.keys(held).length && Object.entries(nodes).every(([nodeId, machineId]) => held[nodeId] === machineId);
        if (same) {
            return;
        }
        if (Object.keys(nodes).length === 0 && (file?.links.length ?? 0) === 0) {
            await this.files.remove(projectId);
            return;
        }
        await this.files.write({ ...file, projectId, links: file?.links ?? [], nodes });
    }

    /* The checkouts on other machines this project is linked to. A link this version cannot read is kept in the file and left out of the answer. */
    linksOf(projectId: string): RemoteLink[] {
        return (this.files.get(projectId)?.links ?? []).flatMap((link) => {
            const parsed = RemoteLinkSchema.safeParse(link);
            return parsed.success ? [parsed.data] : [];
        });
    }

    /* Replaces the link of that machine, or adds one. */
    async link(projectId: string, link: RemoteLink): Promise<void> {
        const file = this.files.get(projectId);
        const others = (file?.links ?? []).filter((held) => !isLinkTo(held, link.machineId));
        await this.files.write({ ...file, projectId, links: [...others, link], nodes: file?.nodes ?? {} });
    }

    /* False when there was none. */
    async unlink(projectId: string, machineId: string): Promise<boolean> {
        const file = this.files.get(projectId);
        const links = (file?.links ?? []).filter((held) => !isLinkTo(held, machineId));
        if (file === undefined || links.length === file.links.length) {
            return false;
        }
        if (links.length === 0 && Object.keys(file.nodes).length === 0) {
            await this.files.remove(projectId);
            return true;
        }
        await this.files.write({ ...file, links });
        return true;
    }

    usesMachine(projectId: string, machineId: string): boolean {
        return Object.values(this.nodesOf(projectId)).includes(machineId);
    }

    /* Whether any project links to that machine or has a node running on it. */
    isLinked(machineId: string): boolean {
        return this.files.all().some((file) => file.links.some((link) => isLinkTo(link, machineId)) || Object.values(file.nodes).includes(machineId));
    }

    forget(projectId: string): Promise<void> {
        return this.files.remove(projectId);
    }
}

function isLinkTo(link: unknown, machineId: string): boolean {
    return typeof link === 'object' && link !== null && 'machineId' in link && link.machineId === machineId;
}

function mapNodes<T extends ProjectContent>(content: T, map: (node: ProjectNode) => ProjectNode): T {
    return { ...content, views: content.views.map((view: ProjectView) => (isCanvasView(view) ? { ...view, nodes: view.nodes.map(map) } : view)) };
}

/* Every id the document places, views and the nodes on canvases alike: a binding lives as long as its id does. */
export function idsOf(content: ProjectContent): Set<string> {
    const ids = new Set<string>();
    for (const view of content.views) {
        ids.add(view.id);
        if (isCanvasView(view)) {
            for (const node of view.nodes) {
                ids.add(node.id);
            }
        }
    }
    return ids;
}

export function machinesOf(content: ProjectContent): Map<string, string> {
    const machines = new Map<string, string>();
    for (const view of content.views) {
        if (isCanvasView(view)) {
            for (const node of view.nodes) {
                if (node.machine !== undefined) {
                    machines.set(node.id, node.machine);
                }
            }
        }
    }
    return machines;
}

/* The document as it goes on the wire: every bound node names its machine. */
export function withMachines<T extends ProjectContent>(content: T, nodes: Readonly<Record<string, string>>): T {
    if (Object.keys(nodes).length === 0) {
        return content;
    }
    return mapNodes(content, (node) => (Object.hasOwn(nodes, node.id) ? { ...node, machine: nodes[node.id]! } : node));
}

/* A change from a tool or an outside edit keeps the machines the store holds and drops every other one. */
export function withBoundMachines<T extends ProjectContent>(content: T, nodes: Readonly<Record<string, string>>): T {
    return mapNodes(content, (node) => {
        if (node.machine === undefined || (Object.hasOwn(nodes, node.id) && nodes[node.id] === node.machine)) {
            return node;
        }
        const { machine: _machine, ...rest } = node;
        return rest as ProjectNode;
    });
}

export function withoutMachines<T extends ProjectContent>(content: T): T {
    return withBoundMachines(content, {});
}

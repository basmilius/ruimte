import {
    deriveProjectContextSources,
    flagOf,
    isCanvasView,
    isHiddenChatView,
    isSessionView,
    sessionNodesOfView,
    type ContextSource,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectFlags,
    type ProjectView,
    type ViewSessionNode
} from '@ruimte/contracts';
import type { HiddenAgentStore } from '../agents/hidden-agents.ts';

/* Where an id sits: the project it belongs to, and the canvas it is a node on (null for a chat,
   terminal or browser that is a view of its own). */
export interface IndexedPlace {
    projectId: string;
    folder: string;
    canvasId: string | null;
}

interface IndexedProject {
    folder: string;
    content: Pick<ProjectContent, 'views' | 'flags'>;
    sources: Map<string, ContextSource[]>;
    places: Map<string, string | null>;
}

/* A drawing or a diagram is read by its view id, but what the person flagged on the canvas is the node. */
function flaggedSources(sources: Map<string, ContextSource[]>, flags: ProjectFlags | undefined): Map<string, ContextSource[]> {
    if (!flags) {
        return sources;
    }
    const flagged = new Map<string, ContextSource[]>();
    for (const [targetId, list] of sources) {
        flagged.set(
            targetId,
            list.map((source) => {
                const flag = flagOf(flags, source.nodeId ?? source.id);
                return flag === null ? source : { ...source, flag };
            })
        );
    }
    return flagged;
}

/* Every id these views place, with the canvas it is a node on (null for a view of its own). */
export function placesOf(views: readonly ProjectView[]): Map<string, string | null> {
    const places = new Map<string, string | null>();
    for (const view of views) {
        if (isCanvasView(view)) {
            for (const node of view.nodes) {
                places.set(node.id, view.id);
            }
        } else if (isSessionView(view)) {
            places.set(view.id, null);
        }
    }
    return places;
}

/*
 * The last known document of every project the daemon knows, open or not. A session outlives the
 * client that opened its project (`project.release` lets go of the file the moment a client
 * switches away), and the callers that ask what an agent may read are synchronous (a shell's first
 * screen, a chat's system prompt, a hook reply), so the answer has to be in memory already.
 */
export class ProjectIndex {
    private readonly projects = new Map<string, IndexedProject>();
    private readonly hiddenAgents: HiddenAgentStore | undefined;
    /* Told which ids a project still places, so state the daemon holds against a node id (a first
       prompt waiting for its session) goes the moment the node does. */
    onPlaces: ((projectId: string, ids: ReadonlySet<string>) => void) | null = null;

    constructor(hiddenAgents?: HiddenAgentStore) {
        this.hiddenAgents = hiddenAgents;
        if (hiddenAgents) {
            hiddenAgents.onChange = (projectId) => this.changedPlaces(projectId);
        }
    }

    private changedPlaces(projectId: string): void {
        this.onPlaces?.(
            projectId,
            new Set([...(this.projects.get(projectId)?.places.keys() ?? []), ...(this.hiddenAgents?.inProject(projectId).map((agent) => agent.node.id) ?? [])])
        );
    }

    /* The content in its daemon-side form: cwds absolute, file paths still as stored. */
    set(projectId: string, folder: string, content: Pick<ProjectContent, 'views' | 'flags'>): void {
        const places = placesOf(content.views);
        this.projects.set(projectId, { folder, content, sources: flaggedSources(deriveProjectContextSources(content.views, folder), content.flags), places });
        this.changedPlaces(projectId);
    }

    remove(projectId: string): void {
        this.projects.delete(projectId);
        this.changedPlaces(projectId);
    }

    has(projectId: string): boolean {
        return this.projects.has(projectId);
    }

    folderOf(projectId: string): string | null {
        return this.projects.get(projectId)?.folder ?? null;
    }

    viewsOf(projectId: string): readonly ProjectView[] | null {
        return this.projects.get(projectId)?.content.views ?? null;
    }

    flagsOf(projectId: string): ProjectFlags | undefined {
        return this.projects.get(projectId)?.content.flags;
    }

    /* What the agent under this id may read. Empty for an id no known project places on a canvas. */
    sourcesFor(targetId: string): ContextSource[] {
        for (const project of this.projects.values()) {
            const sources = project.sources.get(targetId);
            if (sources) {
                return sources;
            }
        }
        return [];
    }

    titleFor(id: string): string | null {
        for (const project of this.projects.values()) {
            for (const view of project.content.views) {
                if (view.id === id) {
                    return view.name ?? null;
                }
                if (isCanvasView(view)) {
                    const node = view.nodes.find((node) => node.id === id);
                    if (node) {
                        return node.title;
                    }
                }
            }
        }
        return this.hiddenAgents?.get(id)?.node.title ?? null;
    }

    /* The canvas an id is a node on, with its nodes and lines; null for a view of its own and for an
       id no known project places. What a refusal reads to tell a missing line from a missing node. */
    canvasOf(id: string): ProjectCanvasView | null {
        for (const project of this.projects.values()) {
            const canvasId = project.places.get(id);
            if (canvasId === undefined) {
                continue;
            }
            const view = project.content.views.find((candidate) => candidate.id === canvasId);
            return view && isCanvasView(view) ? view : null;
        }
        return null;
    }

    /* The name of the chat node or chat view under `id` in the project of `fromId`, never `fromId` itself; null for anything else. */
    chatTitleBeside(fromId: string, id: string): string | null {
        const place = id === fromId ? null : this.locate(fromId);
        const views = place === null ? [] : (this.projects.get(place.projectId)?.content.views ?? []);
        for (const view of views) {
            if (view.kind === 'chat' && view.id === id) {
                return view.name;
            }
            const node = isCanvasView(view) ? view.nodes.find((candidate) => candidate.id === id && candidate.kind === 'chat') : undefined;
            if (node) {
                return node.title;
            }
        }
        return null;
    }

    /* The terminal or chat under `id`, a node or a view of its own, as a source a read takes; null for anything else. */
    agentSource(id: string): ContextSource | null {
        const hidden = this.hiddenAgents?.get(id);
        if (hidden && this.projects.has(hidden.projectId)) {
            return { id, kind: hidden.node.kind, title: hidden.node.title };
        }
        for (const project of this.projects.values()) {
            for (const view of project.content.views) {
                if ((view.kind === 'chat' || view.kind === 'terminal') && view.id === id) {
                    return { id, kind: view.kind, title: view.name };
                }
                const node = isCanvasView(view) ? view.nodes.find((candidate) => candidate.id === id) : undefined;
                if (node) {
                    return node.kind === 'chat' || node.kind === 'terminal' ? { id, kind: node.kind, title: node.title } : null;
                }
            }
        }
        return null;
    }

    /*
     * Every session this project holds, over every view it has. Read when a project closes from a
     * client that never had it on screen, which has no document of its own to count.
     */
    sessionNodes(projectId: string): ViewSessionNode[] {
        return [
            ...(this.projects.get(projectId)?.content.views ?? []).flatMap(sessionNodesOfView),
            ...(this.hiddenAgents?.inProject(projectId).map((agent) => ({ id: agent.node.id, kind: agent.node.kind })) ?? [])
        ];
    }

    /* Every project that places this id; more than one only when two copies of one canvas are known here. */
    projectsPlacing(id: string): string[] {
        const hidden = this.hiddenAgents?.get(id);
        return [...this.projects].filter(([projectId, project]) => project.places.has(id) || hidden?.projectId === projectId).map(([projectId]) => projectId);
    }

    /* Whether a view of this id is a chat an inline edit runs in. */
    isHiddenChat(id: string): boolean {
        return [...this.projects.values()].some((project) => project.content.views.some((view) => view.id === id && isHiddenChatView(view)));
    }

    locate(id: string): IndexedPlace | null {
        for (const [projectId, project] of this.projects) {
            const canvasId = project.places.get(id);
            if (canvasId !== undefined) {
                return { projectId, folder: project.folder, canvasId };
            }
        }
        const hidden = this.hiddenAgents?.get(id);
        const project = hidden === undefined ? undefined : this.projects.get(hidden.projectId);
        if (hidden && project) {
            return { projectId: hidden.projectId, folder: project.folder, canvasId: null };
        }
        return null;
    }
}

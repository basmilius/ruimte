import { resolve } from 'node:path';
import {
    chatNameOf,
    deriveProjectContextSources,
    flagOf,
    designFolderOf,
    designNodeChats,
    designOfChat,
    isCanvasView,
    isChatHostView,
    isChatNode,
    isHiddenChatView,
    isSharedDesign,
    isSessionView,
    sessionNodesOfView,
    type ContextSource,
    type ProjectCanvasView,
    type ProjectContent,
    type ProjectFlags,
    type ProjectAccounts,
    type ProjectSql,
    type ProjectView,
    type ViewSessionNode,
    viewChats
} from '@ruimte/contracts';
import type { HiddenAgentStore } from '../agents/hidden-agents.ts';
import { resolveReference, type Reference } from '../context/references.ts';

/* Where an id sits: the project it belongs to, and the canvas it is a node on (null for a chat,
   terminal or browser that is a view of its own). */
export interface IndexedPlace {
    projectId: string;
    folder: string;
    canvasId: string | null;
}

interface IndexedProject {
    folder: string;
    content: Pick<ProjectContent, 'views' | 'flags' | 'sql' | 'accounts'> & { shared?: readonly string[] };
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
                // A design node's later chats stand on its canvas too, where a line to the node reaches them.
                for (const chat of designNodeChats(node)) {
                    places.set(chat.id, view.id);
                }
            }
        } else if (isSessionView(view)) {
            places.set(view.id, null);
            // A design's later chats are views of their own too, for whatever asks where a chat stands.
            for (const chat of viewChats(view)) {
                places.set(chat.id, null);
            }
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
    set(projectId: string, folder: string, content: Pick<ProjectContent, 'views' | 'flags' | 'sql' | 'accounts'> & { shared?: readonly string[] }): void {
        const sources = flaggedSources(deriveProjectContextSources(content.views, folder), content.flags);
        this.projects.set(projectId, { folder, content, sources, places: placesOf(content.views) });
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

    /* The folder of every project the daemon knows, open or not. */
    folders(): string[] {
        return [...this.projects.values()].map((project) => project.folder);
    }

    viewsOf(projectId: string): readonly ProjectView[] | null {
        return this.projects.get(projectId)?.content.views ?? null;
    }

    /* Where the designs of the project go: its views, and which of them are shared. */
    designSidesOf(projectId: string): { views: readonly ProjectView[]; shared: readonly string[] } | null {
        const project = this.projects.get(projectId);

        return project === undefined ? null : { views: project.content.views, shared: project.content.shared ?? [] };
    }

    flagsOf(projectId: string): ProjectFlags | undefined {
        return this.projects.get(projectId)?.content.flags;
    }

    sqlOf(projectId: string): ProjectSql | undefined {
        return this.projects.get(projectId)?.content.sql;
    }

    accountsOf(projectId: string): ProjectAccounts | undefined {
        return this.projects.get(projectId)?.content.accounts;
    }

    /* Every version a node of a known project is pinned to; a node that follows the latest pins nothing, since the latest is never proposed. */
    pinnedArtifactVersions(): Array<{ artifactId: string; versionId: string }> {
        const pins: Array<{ artifactId: string; versionId: string }> = [];
        for (const project of this.projects.values()) {
            for (const view of project.content.views) {
                if (!isCanvasView(view)) {
                    continue;
                }
                for (const node of view.nodes) {
                    if (node.kind === 'artifact' && node.artifact?.version !== undefined) {
                        pins.push({ artifactId: node.artifact.id, versionId: node.artifact.version });
                    }
                }
            }
        }
        return pins;
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
            // A chat goes by its own name, a later chat of a design included, which no view or node carries.
            const chatName = chatNameOf(project.content.views, id);
            if (chatName !== null) {
                return chatName;
            }
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

    /* The view, node or text under `id` in the project of `fromId`, never `fromId` itself; null for an id that project does not hold. */
    referenceBeside(fromId: string, id: string): Reference | null {
        const place = id === fromId ? null : this.locate(fromId);
        const project = place === null ? undefined : this.projects.get(place.projectId);
        return project === undefined ? null : resolveReference(project.content.views, id, project.folder);
    }

    /* The terminal or chat under `id`, a node or a view of its own, as a source a read takes; null for anything else. */
    agentSource(id: string): ContextSource | null {
        const hidden = this.hiddenAgents?.get(id);
        if (hidden && this.projects.has(hidden.projectId)) {
            return { id, kind: hidden.node.kind, title: hidden.node.title };
        }
        for (const project of this.projects.values()) {
            for (const view of project.content.views) {
                if (view.kind === 'terminal' && view.id === id) {
                    return { id, kind: 'terminal', title: view.name };
                }
                const chat = isChatHostView(view) ? viewChats(view).find((candidate) => candidate.id === id) : undefined;
                if (chat) {
                    return { id, kind: 'chat', title: chat.name };
                }
                const node = isCanvasView(view) ? view.nodes.find((candidate) => candidate.id === id) : undefined;
                if (node) {
                    return isChatNode(node)
                        ? { id, kind: 'chat', title: node.title }
                        : node.kind === 'terminal'
                          ? { id, kind: 'terminal', title: node.title }
                          : null;
                }
                const later = isCanvasView(view) ? view.nodes.flatMap(designNodeChats).find((candidate) => candidate.id === id) : undefined;
                if (later) {
                    return { id, kind: 'chat', title: later.name };
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

    /* Whether a view of any project holds this id, as a node on a canvas or as a view of its own. */
    placed(id: string): boolean {
        return [...this.projects.values()].some((project) => project.places.has(id));
    }

    /* Whether a person finds this id in a project, as a node on a canvas or a view of its own. A task's hidden agent is not. */
    shows(id: string): boolean {
        return this.placed(id) && !this.isHiddenChat(id);
    }

    /* Whether a view of this id is a chat an inline edit runs in. */
    isHiddenChat(id: string): boolean {
        return [...this.projects.values()].some((project) => project.content.views.some((view) => view.id === id && isHiddenChatView(view)));
    }

    /*
     * The folder a chat works on as a design, where its design being shared or not puts it, and whether that design
     * stands on a canvas. Absolute, since a chat that runs in a worktree must still write where the design is shown.
     * Null for any other id.
     */
    designOf(id: string): { folder: string; onCanvas: boolean } | null {
        for (const project of this.projects.values()) {
            const found = designOfChat(project.content.views, id);
            if (found !== null) {
                return {
                    folder: resolve(project.folder, designFolderOf(found.design, isSharedDesign(found.design, project.content.shared ?? []))),
                    onCanvas: found.design.canvasId !== null
                };
            }
        }

        return null;
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

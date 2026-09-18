import { deriveProjectContextSources, isCanvasView, isSessionView, type ContextSource, type ProjectCanvasView, type ProjectContent } from '@ruimte/contracts';

/* Where an id sits: the project it belongs to, and the canvas it is a node on (null for a chat,
   terminal or browser that is a view of its own). */
export interface IndexedPlace {
    projectId: string;
    folder: string | null;
    canvasId: string | null;
}

interface IndexedProject {
    folder: string | null;
    content: Pick<ProjectContent, 'views'>;
    sources: Map<string, ContextSource[]>;
    places: Map<string, string | null>;
}

/*
 * The last known document of every project the daemon knows, open or not. A session outlives the
 * client that opened its project (`project.release` lets go of the file the moment a client
 * switches away), and the callers that ask what an agent may read are synchronous (a shell's first
 * screen, a chat's system prompt, a hook reply), so the answer has to be in memory already.
 */
export class ProjectIndex {
    private readonly projects = new Map<string, IndexedProject>();
    /* Told which ids a project still places, so state the daemon holds against a node id (a first
       prompt waiting for its session) goes the moment the node does. */
    onPlaces: ((projectId: string, ids: ReadonlySet<string>) => void) | null = null;

    /* The content in its daemon-side form: cwds absolute, file paths still as stored. */
    set(projectId: string, folder: string | null, content: Pick<ProjectContent, 'views'>): void {
        const places = new Map<string, string | null>();
        for (const view of content.views) {
            if (isCanvasView(view)) {
                for (const node of view.nodes) {
                    places.set(node.id, view.id);
                }
            } else if (isSessionView(view)) {
                places.set(view.id, null);
            }
        }
        this.projects.set(projectId, { folder, content, sources: deriveProjectContextSources(content.views, folder), places });
        this.onPlaces?.(projectId, new Set(places.keys()));
    }

    remove(projectId: string): void {
        this.projects.delete(projectId);
        this.onPlaces?.(projectId, new Set());
    }

    has(projectId: string): boolean {
        return this.projects.has(projectId);
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
        return null;
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

    locate(id: string): IndexedPlace | null {
        for (const [projectId, project] of this.projects) {
            const canvasId = project.places.get(id);
            if (canvasId !== undefined) {
                return { projectId, folder: project.folder, canvasId };
            }
        }
        return null;
    }
}

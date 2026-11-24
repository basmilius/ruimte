import { CodedError } from '@adecore/agents';
import { DEFAULT_TITLES, isCanvasView, type ProjectContent, type ProjectNode, type ProjectView } from '@ruimte/contracts';
import { z } from 'zod';
import type { ProjectHost } from '../canvas/host.ts';
import { MAX_CANVAS_NODES, newId } from '../canvas/nodes.ts';
import { placeBeside, placeFree } from '../canvas/placement.ts';
import { checkCwd } from '../canvas/project-paths.ts';
import { MAX_PROJECT_VIEWS } from '../canvas/views.ts';
import { JsonFileStore } from '../json-file-store.ts';
import { ExtensionRefusal } from './refusal.ts';

const EntrySchema = z.object({
    projectId: z.string().min(1),
    // The profile that starts it, of the extension that supplies it.
    profile: z.object({ extension: z.string().min(1), id: z.string().min(1) }).optional(),
    // The extension that opened it, the only one that types into it.
    openedBy: z.string().min(1).optional()
});
const FileSchema = z.object({ terminals: z.record(z.string(), EntrySchema) });

export type ExtensionTerminal = z.infer<typeof EntrySchema>;

/*
 * The terminals an extension opened or a profile starts, by node id. Under `$RUIMTE_HOME` and never in a project file:
 * who may type into a terminal is decided on this record alone, and an agent with a shell can rewrite `project.json`.
 */
export class ExtensionTerminals {
    private readonly store: JsonFileStore<z.infer<typeof FileSchema>>;
    private readonly terminals: Record<string, ExtensionTerminal>;

    constructor(path?: string) {
        this.store = new JsonFileStore(path, FileSchema, 'no extension types into a terminal it opened before, and a profile terminal starts as a plain shell');
        this.terminals = this.store.read()?.terminals ?? {};
    }

    get(nodeId: string): ExtensionTerminal | null {
        return Object.hasOwn(this.terminals, nodeId) ? (this.terminals[nodeId] ?? null) : null;
    }

    put(nodeId: string, terminal: ExtensionTerminal): void {
        this.terminals[nodeId] = terminal;
        this.save();
    }

    /* For the `placed` event of the node lifecycle: a terminal that left its project takes its record along. */
    places(projectId: string, ids: ReadonlySet<string>): void {
        const gone = Object.entries(this.terminals).filter(([nodeId, terminal]) => terminal.projectId === projectId && !ids.has(nodeId));

        for (const [nodeId] of gone) {
            delete this.terminals[nodeId];
        }

        if (gone.length > 0) {
            this.save();
        }
    }

    private save(): void {
        this.store.write({ terminals: this.terminals });
    }
}

/* A terminal to make, as a client or `server/` asked for it. */
export interface ExtensionTerminalOpen {
    projectId: string;
    profile?: string | undefined;
    // A person chose the profile from a menu, so no extension opened the terminal.
    picked?: boolean | undefined;
    title?: string | undefined;
    cwd?: string | undefined;
    viewId?: string | undefined;
    beside?: string | undefined;
    at?: { x: number; y: number } | undefined;
}

interface TerminalOpenerDeps {
    projects: Pick<ProjectHost, 'mutate' | 'showView'>;
    terminals: ExtensionTerminals;
    folderOf(projectId: string): string | null;
    worktreePaths(folder: string): Promise<string[]>;
    nodeSize(kind: 'terminal'): { w: number; h: number };
    /* Starts the session of the node just written, so a write right after the open reaches it. */
    start(nodeId: string, cwd: string): Promise<void>;
}

function withView(content: ProjectContent, view: ProjectView): ProjectContent {
    return { ...content, views: content.views.map((candidate) => (candidate.id === view.id ? view : candidate)) };
}

/* The canvas a terminal lands on: the one that holds `beside`, else the one named; null for a view of its own. */
function canvasFor(content: ProjectContent, open: ExtensionTerminalOpen) {
    const canvases = content.views.filter(isCanvasView);

    if (open.beside !== undefined) {
        const holder = canvases.find((canvas) => canvas.nodes.some((node) => node.id === open.beside));

        if (holder === undefined || (open.viewId !== undefined && holder.id !== open.viewId)) {
            throw new ExtensionRefusal('not-found', `No node ${open.beside} on a canvas of this project`);
        }

        return holder;
    }

    if (open.viewId === undefined) {
        return null;
    }

    const named = canvases.find((canvas) => canvas.id === open.viewId);

    if (named === undefined) {
        throw new ExtensionRefusal('no-canvas', `${open.viewId} is no canvas of this project`);
    }

    return named;
}

/*
 * Makes a terminal for an extension and starts it. The record of who opened it and which profile starts it is written
 * under the project's lock, before the node is on disk, so the session that starts for the node always finds it.
 * `check` throws once the extension was turned off or changed since it asked.
 */
export function extensionTerminalOpener(deps: TerminalOpenerDeps) {
    return async (extensionId: string, open: ExtensionTerminalOpen, check: () => void): Promise<{ nodeId: string }> => {
        const folder = deps.folderOf(open.projectId);

        if (folder === null) {
            throw new ExtensionRefusal('not-found', `No project ${open.projectId} on this machine`);
        }

        const cwd = open.cwd === undefined ? undefined : await insideProject(folder, open.cwd, deps.worktreePaths);

        check();

        const made = await deps.projects.mutate<{ nodeId: string; ownView: boolean }>(open.projectId, (content) => {
            check();

            const canvas = canvasFor(content, open);
            const nodeId = newId('terminal', content);
            const title = open.title ?? DEFAULT_TITLES.terminal;
            const titled = open.title === undefined ? {} : { titleSource: 'user' as const };
            const record: ExtensionTerminal = {
                projectId: open.projectId,
                ...(open.profile === undefined ? {} : { profile: { extension: extensionId, id: open.profile } }),
                ...(open.picked === true ? {} : { openedBy: extensionId })
            };

            if (canvas === null) {
                if (content.views.length >= MAX_PROJECT_VIEWS) {
                    throw new ExtensionRefusal('limit', `This project already has ${MAX_PROJECT_VIEWS} views`);
                }

                const view: ProjectView = { kind: 'terminal', id: nodeId, name: title, ...titled, node: cwd === undefined ? {} : { cwd } };

                deps.terminals.put(nodeId, record);

                return { content: { ...content, views: [...content.views, view] }, result: { nodeId, ownView: true } };
            }

            if (canvas.nodes.length >= MAX_CANVAS_NODES) {
                throw new ExtensionRefusal('limit', `${canvas.name} already has ${MAX_CANVAS_NODES} nodes`);
            }

            const size = deps.nodeSize('terminal');
            const anchor = canvas.nodes.find((node) => node.id === open.beside);
            const rect =
                anchor !== undefined
                    ? placeBeside(anchor, size)
                    : open.at !== undefined
                      ? { x: Math.round(open.at.x - size.w / 2), y: Math.round(open.at.y - size.h / 2), ...size }
                      : placeFree(canvas.nodes, size, null);
            const node: ProjectNode = { id: nodeId, kind: 'terminal', title, ...titled, ...rect, ...(cwd === undefined ? {} : { cwd }) };

            deps.terminals.put(nodeId, record);

            return { content: withView(content, { ...canvas, nodes: [...canvas.nodes, node] }), result: { nodeId, ownView: false } };
        });

        try {
            await deps.start(made.nodeId, cwd ?? folder);
        } catch (e) {
            throw new ExtensionRefusal('failed', `The terminal ${made.nodeId} is there, but it did not start: ${e instanceof Error ? e.message : String(e)}`);
        }

        // A view of its own a person asked for comes to the front, as one they made in the sidebar does.
        if (made.ownView && open.picked === true) {
            deps.projects.showView(open.projectId, made.nodeId, extensionId);
        }

        return { nodeId: made.nodeId };
    };
}

/* A folder of the project or of one of its worktrees, under the code an extension reads for one that is not. */
export async function insideProject(folder: string, cwd: string, worktreePaths: (folder: string) => Promise<string[]>): Promise<string> {
    try {
        return await checkCwd(folder, cwd, worktreePaths);
    } catch (e) {
        throw e instanceof CodedError ? new ExtensionRefusal('outside-project', e.message) : e;
    }
}

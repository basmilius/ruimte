import { isCanvasView, isFileView, isSessionView, resolveStoredPath, sessionNodesOfView, type ProjectView } from '@ruimte/contracts';
import { agentsEndedBy } from '@/agents/end-children';
import { nodeWorking } from '@/state/agent-work';
import { liveCanvas } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useSessions, type StatusOf } from '@/state/sessions';
import { textDrafts } from '@/state/text-drafts';
import { transportFor } from '@/transport';

/* What a view holds, in the words the status needs. The canvas store owns the view that is on screen. */
export const nodesOfView = (view: ProjectView): (StatusOf & { title: string })[] => {
    if (isSessionView(view)) {
        // A standalone view is one node without a canvas, under its own id.
        return [{ id: view.id, kind: view.kind, title: view.name }];
    }
    if (!isCanvasView(view)) {
        return [];
    }
    // A view on screen is held by its editor, wherever in the grid it stands, and that is newer.
    const canvas = liveCanvas(view.id);
    return canvas === null ? view.nodes : canvas.order.map((id) => canvas.nodes[id]!);
};

/* The files a view shows: itself for a file view, its file nodes for a canvas. */
export const filesOfView = (view: ProjectView, folder: string | null): string[] => {
    const stored = isFileView(view)
        ? [view.path]
        : isCanvasView(view)
          ? view.nodes.flatMap((node) => (node.kind === 'file' && node.path ? [node.path] : []))
          : [];
    return stored.flatMap((path) => resolveStoredPath(folder, path) ?? []);
};

/* What deleting a view reaches beyond the document: the drafts of its files and the agents on the machine. */
export interface ViewDeletionMachine {
    folder(): string | null;
    isUnsaved(path: string): boolean;
    /* Resolves whether the file is on disk as it was edited. */
    save(path: string): Promise<boolean>;
    working(node: StatusOf): boolean;
    /* The agents elsewhere that end when these sessions do. */
    endedBy(nodeIds: readonly string[]): Promise<string[]>;
}

export const liveViewDeletion: ViewDeletionMachine = {
    folder: () => useProject.getState().current?.folder ?? null,
    isUnsaved: (path) => textDrafts.isUnsaved(currentEndpointId(), path),
    save: (path) => textDrafts.save(currentEndpointId(), path),
    working: (node) => nodeWorking(node, useSessions.getState().byKey, useChats.getState().byKey, currentEndpointId()),
    endedBy: (nodeIds) => agentsEndedBy(transportFor(currentEndpointId()), nodeIds)
};

export interface ViewDeletionFacts {
    /* Absolute on the machine, the way a draft is keyed. */
    unsaved: string[];
    /* The titles of the nodes in the view that are still working. */
    working: string[];
    /* The titles of the agents in other places that end with the view; null for one the document has no name for yet. */
    ending: (string | null)[];
}

const titleOfNode = (views: readonly ProjectView[], nodeId: string): string | null => {
    for (const view of views) {
        if (view.id === nodeId && isSessionView(view)) {
            return view.name;
        }
        const node = isCanvasView(view) ? nodesOfView(view).find((candidate) => candidate.id === nodeId) : undefined;
        if (node) {
            return node.title;
        }
    }
    return null;
};

export const unsavedFilesOf = (view: ProjectView, machine: ViewDeletionMachine): string[] =>
    [...new Set(filesOfView(view, machine.folder()))].filter((path) => machine.isUnsaved(path));

/* `view` is the exported copy, so a canvas on screen is counted with what its editor holds now. */
export const viewDeletionFacts = async (view: ProjectView, views: readonly ProjectView[], machine: ViewDeletionMachine): Promise<ViewDeletionFacts> => {
    const working = nodesOfView(view).filter((node) => machine.working(node));
    const ending = await machine.endedBy(sessionNodesOfView(view).map((node) => node.id));
    return {
        unsaved: unsavedFilesOf(view, machine),
        working: working.map((node) => node.title),
        ending: ending.map((nodeId) => titleOfNode(views, nodeId))
    };
};

/* Saves what the view shows with unsaved changes and resolves the files that did not save. */
export const saveViewFiles = async (view: ProjectView, machine: ViewDeletionMachine): Promise<string[]> => {
    const unsaved = unsavedFilesOf(view, machine);
    const saved = await Promise.all(unsaved.map((path) => machine.save(path)));
    return unsaved.filter((_path, index) => !saved[index]);
};

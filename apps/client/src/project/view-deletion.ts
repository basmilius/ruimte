import { isFileView, resolveStoredPath, sessionNodesOfView, type ProjectNode, type ProjectView, nodeChats } from '@ruimte/contracts';
import { agentsEndedBy } from '@/agents/end-children';
import { callerName } from '@/project/show-view';
import { nodeWorking } from '@/state/agent-work';
import { useChats } from '@adecore/agents-react/state';
import { nodeRefsOf, nodeRefsOfView, nodesOfView } from '@/project/view-nodes';
import { currentEndpointId } from '@/state/keys';
import { endpointOfNodeId } from '@/state/node-endpoint';
import { useProject } from '@/state/project';
import { useSessions, type StatusOf } from '@/state/sessions';
import { textDrafts } from '@/state/text-drafts';
import { transportFor } from '@/transport';

function resolved(stored: readonly string[], folder: string | null): string[] {
    return stored.flatMap((path) => resolveStoredPath(folder, path) ?? []);
}

function filesOfNodes(nodes: readonly ProjectNode[], folder: string | null): string[] {
    return resolved(
        nodes.flatMap((node) => (node.kind === 'file' && node.path ? [node.path] : [])),
        folder
    );
}

/* The files a view shows: itself for a file view, its file nodes for a canvas. */
export function filesOfView(view: ProjectView, folder: string | null): string[] {
    return isFileView(view) ? resolved([view.path], folder) : filesOfNodes(nodesOfView(view), folder);
}

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
    endedBy: (nodeIds) => agentsEndedBy((nodeId) => transportFor(endpointOfNodeId(nodeId)), nodeIds)
};

export interface ViewDeletionFacts {
    /* Absolute on the machine, the way a draft is keyed. */
    unsaved: string[];
    /* The titles of the nodes in the view that are still working. */
    working: string[];
    /* The titles of the agents in other places that end with the view; null for one the document has no name for yet. */
    ending: (string | null)[];
}

function unsavedOf(files: readonly string[], machine: ViewDeletionMachine): string[] {
    return [...new Set(files)].filter((path) => machine.isUnsaved(path));
}

/* What a delete of these nodes, or of a view holding them, reaches beyond the document. */
async function deletionFacts(
    nodes: readonly (StatusOf & { title: string })[],
    sessions: readonly string[],
    files: readonly string[],
    views: readonly ProjectView[],
    machine: ViewDeletionMachine
): Promise<ViewDeletionFacts> {
    const ending = await machine.endedBy(sessions);
    return {
        unsaved: unsavedOf(files, machine),
        working: nodes.filter((node) => machine.working(node)).map((node) => node.title),
        ending: ending.map((nodeId) => callerName(views, nodesOfView, nodeId))
    };
}

/* `view` is the exported copy, so a canvas on screen is counted with what its editor holds now. */
export function viewDeletionFacts(view: ProjectView, views: readonly ProjectView[], machine: ViewDeletionMachine): Promise<ViewDeletionFacts> {
    return deletionFacts(
        nodeRefsOfView(view),
        sessionNodesOfView(view).map((node) => node.id),
        filesOfView(view, machine.folder()),
        views,
        machine
    );
}

/* `nodes` are the ones that go, a collapsed group's hidden members included. */
export function nodeDeletionFacts(nodes: readonly ProjectNode[], views: readonly ProjectView[], machine: ViewDeletionMachine): Promise<ViewDeletionFacts> {
    return deletionFacts(
        nodeRefsOf(nodes),
        nodes.flatMap((node) => (node.kind === 'terminal' ? [node.id] : nodeChats(node).map((chat) => chat.id))),
        filesOfNodes(nodes, machine.folder()),
        views,
        machine
    );
}

/* Saves what is unsaved among these files and resolves the ones that did not save. */
async function saveFiles(files: readonly string[], machine: ViewDeletionMachine): Promise<string[]> {
    const unsaved = unsavedOf(files, machine);
    const saved = await Promise.all(unsaved.map((path) => machine.save(path)));
    return unsaved.filter((_path, index) => !saved[index]);
}

export function saveViewFiles(view: ProjectView, machine: ViewDeletionMachine): Promise<string[]> {
    return saveFiles(filesOfView(view, machine.folder()), machine);
}

export function saveNodeFiles(nodes: readonly ProjectNode[], machine: ViewDeletionMachine): Promise<string[]> {
    return saveFiles(filesOfNodes(nodes, machine.folder()), machine);
}

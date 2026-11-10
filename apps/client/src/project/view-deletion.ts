import { useChats } from '@adecore/agents-react/state';
import { isFileView, resolveStoredPath, sessionNodesOfView, type ProjectNode, type ProjectView, nodeChats } from '@ruimte/contracts';
import { agentsEndedBy } from '@/agents/end-children';
import { callerName } from '@/project/show-view';
import { nodeWorking } from '@/state/agent-work';
import { currentEndpointId } from '@/state/current-endpoint';
import { endpointOfNodeId } from '@/state/node-endpoint';
import { useProject } from '@/state/project';
import { useSessions, type StatusOf } from '@/state/sessions';
import { textDrafts } from '@/state/text-drafts';
import { nodeRefsOf, nodeRefsOfView, nodesOfView } from '@/state/view-nodes';
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

export function filesOfView(view: ProjectView, folder: string | null): string[] {
    return isFileView(view) ? resolved([view.path], folder) : filesOfNodes(nodesOfView(view), folder);
}

export interface ViewDeletionMachine {
    folder(): string | null;
    isUnsaved(path: string): boolean;
    save(path: string): Promise<boolean>;
    working(node: StatusOf): boolean;
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
    working: string[];
    /* The titles of the agents in other places that end with the view; null for one the document has no name for yet. */
    ending: (string | null)[];
}

function unsavedOf(files: readonly string[], machine: ViewDeletionMachine): string[] {
    return [...new Set(files)].filter((path) => machine.isUnsaved(path));
}

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

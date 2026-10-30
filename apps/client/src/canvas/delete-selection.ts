import i18next from 'i18next';
import type { StoreApi } from 'zustand';
import { nodeChats, resolveStoredPath, type Worktree } from '@ruimte/contracts';
import { deleteNodesAction } from '@/actions/client-actions';
import { askBeforeEndingAgents, type PendingEnd } from '@/agents/end-children';
import { closeAfterSaving } from '@/shell/panels/unsaved-close';
import { worktreeSessionsOf, worktreesLeftBy } from '@/shell/panels/worktree-rows';
import { nodesOfView } from '@/project/view-nodes';
import { useDocument } from '@/state/document';
import { currentEndpointId, endpointOfNode } from '@/state/keys';
import { transportFor } from '@/transport';
import { useProject } from '@/state/project';
import type { CanvasState } from '@/state/canvas';
import type { Transport } from '@/transport/transport';

/*
 * Deletes what is selected on a canvas, the way `deleteSelected` does, but asks first when the chats
 * and terminals going with it opened agents on the machine: those end too. A file node with unsaved
 * changes is saved before anything is asked. The selection is kept, so the delete that runs after
 * the answer takes what the person picked, not what is selected by then.
 */
export function deleteSelectionAsking(
    store: StoreApi<CanvasState>,
    transport: Pick<Transport, 'request'> | null,
    folder: string | null = useProject.getState().current?.folder ?? null
): Promise<void> {
    const { nodes, selection } = store.getState();
    const picked = [...selection];
    const going = picked.flatMap((id) => {
        const node = nodes[id];
        // A collapsed group takes what it hid along, which `deleteSelected` does as well.
        return node?.kind === 'group' && node.collapsed ? [id, ...(node.memberIds ?? [])] : [id];
    });
    // A design node ends every chat it holds, each of them asked about under its own id.
    const holderOf = new Map(
        going.flatMap((id): [string, string][] => {
            const node = nodes[id];
            if (node === undefined) {
                return [];
            }

            return node.kind === 'terminal' ? [[id, id]] : nodeChats(node).map((chat) => [chat.id, id]);
        })
    );
    const sessions = [...holderOf.keys()];
    const named = picked.filter((id) => nodes[id] !== undefined);
    const what = named.length === 1 ? nodes[named[0]!]!.title : i18next.t('canvas:delete.nodes', { count: named.length });
    const goingIds = new Set(going);
    // A node that runs on another machine asks that machine which agents it opened.
    const askerOf = (id: string): Pick<Transport, 'request'> | null => {
        const node = nodes[holderOf.get(id) ?? id];
        return node?.machine === undefined ? transport : transportFor(endpointOfNode(node, ''));
    };
    const leftBehind = async (): Promise<PendingEnd['worktrees']> => {
        if (transport === null || folder === null || sessions.length === 0) {
            return undefined;
        }
        const staying = [
            ...Object.values(nodes).filter((node) => !goingIds.has(node.id)),
            ...useDocument
                .getState()
                .views.flatMap(nodesOfView)
                .filter((node) => nodes[node.id] === undefined)
        ];
        const leftBy = (worktrees: readonly Worktree[]): Worktree[] =>
            worktreesLeftBy(worktrees, worktreeSessionsOf(going.map((id) => nodes[id]).filter((node) => node !== undefined)), worktreeSessionsOf(staying));
        // Counting the work runs git status in every worktree, seconds in a repository with dozens, so it waits until one is left behind.
        const listed = await transport.request('git.worktree-list', { repo: folder });
        if (leftBy(listed.worktrees).length === 0) {
            return { folder, worktrees: [] };
        }
        const { worktrees } = await transport.request('git.worktree-list', { repo: folder, inspect: true });
        return { folder, worktrees: leftBy(worktrees) };
    };
    const files = going.flatMap((id) => {
        const node = nodes[id];
        return node?.kind === 'file' && node.path ? (resolveStoredPath(folder, node.path) ?? []) : [];
    });
    return new Promise((resolve) => {
        closeAfterSaving(currentEndpointId(), files, () => {
            void askBeforeEndingAgents(askerOf, sessions, what, () => deleteNodesAction(store, picked), leftBehind).finally(resolve);
        });
    });
}

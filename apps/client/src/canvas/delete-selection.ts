import type { StoreApi } from 'zustand';
import { isCanvasView } from '@ruimte/contracts';
import { askBeforeEndingAgents, type PendingEnd } from '@/agents/end-children';
import { worktreesLeftBy } from '@/shell/panels/worktree-rows';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import type { CanvasState } from '@/state/canvas';
import type { Transport } from '@/transport/transport';

/*
 * Deletes what is selected on a canvas, the way `deleteSelected` does, but asks first when the chats
 * and terminals going with it opened agents on the machine: those end too. The selection is kept, so
 * the delete that runs after the answer takes what the person picked, not what is selected by then.
 */
export const deleteSelectionAsking = (
    store: StoreApi<CanvasState>,
    transport: Pick<Transport, 'request'> | null,
    folder: string | null = useProject.getState().current?.folder ?? null
): Promise<void> => {
    const { nodes, selection } = store.getState();
    const picked = [...selection];
    const going = picked.flatMap((id) => {
        const node = nodes[id];
        // A collapsed group takes what it hid along, which `deleteSelected` does as well.
        return node?.kind === 'group' && node.collapsed ? [id, ...(node.memberIds ?? [])] : [id];
    });
    const sessions = going.filter((id) => nodes[id]?.kind === 'chat' || nodes[id]?.kind === 'terminal');
    const named = picked.filter((id) => nodes[id] !== undefined);
    const what = named.length === 1 ? nodes[named[0]!]!.title : `${named.length} nodes`;
    const goingIds = new Set(going);
    const leftBehind = async (): Promise<PendingEnd['worktrees']> => {
        if (transport === null || folder === null || sessions.length === 0) {
            return undefined;
        }
        const { worktrees } = await transport.request('git.worktree-list', { repo: folder, inspect: true });
        const staying = [
            ...Object.values(nodes).filter((node) => !goingIds.has(node.id)),
            ...useDocument
                .getState()
                .views.flatMap((view) => (isCanvasView(view) ? view.nodes : []))
                .filter((node) => nodes[node.id] === undefined)
        ];
        return {
            folder,
            worktrees: worktreesLeftBy(
                worktrees,
                going.map((id) => nodes[id]).filter((node) => node !== undefined),
                staying
            )
        };
    };
    return askBeforeEndingAgents(
        transport,
        sessions,
        what,
        () => {
            const now = store.getState();
            now.select(picked);
            now.deleteSelected();
        },
        leftBehind
    );
};

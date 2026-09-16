import type { StoreApi } from 'zustand';
import { askBeforeEndingAgents } from '@/agents/end-children';
import type { CanvasState } from '@/state/canvas';
import type { Transport } from '@/transport/transport';

/*
 * Deletes what is selected on a canvas, the way `deleteSelected` does, but asks first when the chats
 * and terminals going with it opened agents on the machine: those end too. The selection is kept, so
 * the delete that runs after the answer takes what the person picked, not what is selected by then.
 */
export const deleteSelectionAsking = (store: StoreApi<CanvasState>, transport: Pick<Transport, 'request'> | null): Promise<void> => {
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
    return askBeforeEndingAgents(transport, sessions, what, () => {
        const now = store.getState();
        now.select(picked);
        now.deleteSelected();
    });
};

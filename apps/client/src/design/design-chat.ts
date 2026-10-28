import { create } from 'zustand';
import { designNodeChats, viewChats, type DesignPlace, type ProjectDesignView, type ProjectNode } from '@ruimte/contracts';

interface DesignChatState {
    /* The chat a person picked per design, by the design's view id. One window's, never saved. */
    picked: Record<string, string>;
    pick(viewId: string, chatId: string): void;

    /* The page in front per design, null while none is, so the actions of a design act on the page it shows. */
    pages: Record<string, string | null>;
    showPage(viewId: string, file: string | null): void;
}

export const useDesignChat = create<DesignChatState>((set) => ({
    picked: {},
    pick: (viewId, chatId) => set((state) => ({ picked: { ...state.picked, [viewId]: chatId } })),
    pages: {},
    showPage: (viewId, file) => set((state) => (state.pages[viewId] === file ? state : { pages: { ...state.pages, [viewId]: file } }))
}));

/* The key that makes every saved version of a design one artifact of Output. */
export function designVersionKey(viewId: string): string {
    return `design-${viewId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 64);
}

/* The chat a design shows: the one a person picked while it is still there, else the newest, so a chat just started or forked comes into view. */
export function activeDesignChat(design: { id: string; chats: readonly { id: string }[] }, picked: Readonly<Record<string, string>>): string {
    const chosen = picked[design.id];

    return chosen !== undefined && design.chats.some((chat) => chat.id === chosen) ? chosen : (design.chats.at(-1)?.id ?? design.id);
}

/* The chat a node shows: a chat node its own, a design node the one in front of it; null for any other node. */
export function shownChatOfNode(node: { id: string; kind: string; chats?: ProjectNode['chats'] }): string | null {
    if (node.kind !== 'chat' && node.kind !== 'design') {
        return null;
    }
    const chats = [{ id: node.id }, ...designNodeChats(node)];
    return node.kind === 'design' ? activeDesignChat({ id: node.id, chats }, useDesignChat.getState().picked) : node.id;
}

/* A design of its own as the place it is, so what draws a design never asks whether it is a view or a node. */
export function placeOfView(view: ProjectDesignView): DesignPlace {
    return { id: view.id, name: view.name, path: view.path, chats: viewChats(view), canvasId: null };
}

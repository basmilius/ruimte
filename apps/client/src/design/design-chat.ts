import { create } from 'zustand';
import { viewChats, type ProjectDesignView } from '@ruimte/contracts';

interface DesignChatState {
    /* The chat a person picked per design, by the design's view id. One window's, never saved. */
    picked: Record<string, string>;
    pick(viewId: string, chatId: string): void;

    /* The page a person has in front per design, so the bar of the view acts on the page the stage shows. */
    pages: Record<string, string>;
    showPage(viewId: string, file: string): void;
}

export const useDesignChat = create<DesignChatState>((set) => ({
    picked: {},
    pick: (viewId, chatId) => set((state) => ({ picked: { ...state.picked, [viewId]: chatId } })),
    pages: {},
    showPage: (viewId, file) => set((state) => ({ pages: { ...state.pages, [viewId]: file } }))
}));

/* The key that makes every saved version of a design one artifact of Output. */
export function designVersionKey(viewId: string): string {
    return `design-${viewId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 64);
}

/* The chat a design shows: the one a person picked while it is still there, else the newest, so a chat just started or forked comes into view. */
export function activeDesignChat(view: ProjectDesignView, picked: Readonly<Record<string, string>>): string {
    const chats = viewChats(view);
    const chosen = picked[view.id];

    return chosen !== undefined && chats.some((chat) => chat.id === chosen) ? chosen : chats.at(-1)!.id;
}

import { designNodeChats, viewChats, type DesignPlace, type ProjectDesignView, type ProjectNode } from '@ruimte/contracts';
import { create } from 'zustand';

export interface DesignCamera {
    x: number;
    y: number;
    zoom: number;
}

interface DesignChatState {
    /* The chat a person picked per design, by the design's view id. One window's, never saved. */
    picked: Record<string, string>;
    pick(viewId: string, chatId: string): void;

    /* The page in front per design, null while none is, so the actions of a design act on the page it shows. */
    pages: Record<string, string | null>;
    showPage(viewId: string, file: string | null): void;

    /* The designs whose page in front a person picked themselves, by id; what `followNewPage` asks under `until-picked`. */
    pickedPages: Record<string, true>;
    pickPage(viewId: string, file: string): void;
    /* Shows a page the chat just made, unless the stage follows new pages only until a person picks one and they did. */
    followNewPage(viewId: string, file: string, follow: PageFollow): void;

    /* Where a person left each page, by `designCameraKey`. One window's, never saved: it outlives the stage, which goes with its view. */
    cameras: Record<string, DesignCamera>;
    keepCamera(key: string, camera: DesignCamera): void;

    /*
     * Puts a hidden design agent's design on `page` as it opens; `picked` says a person picked it themselves, which a
     * new page of the agent then leaves in front.
     */
    openAgentPage(agentId: string, page: string | null, picked: boolean): void;
}

/*
 * How a stage takes a page its chat makes. A Design view shows every new one, also over a page a person picked, since
 * a person there asked for it; the design of a hidden design agent only until a person picks a page, since the agent
 * writes on by itself while they look.
 */
export type PageFollow = 'every' | 'until-picked';

export const useDesignChat = create<DesignChatState>((set, get) => ({
    picked: {},
    pick: (viewId, chatId) => set((state) => ({ picked: { ...state.picked, [viewId]: chatId } })),
    pages: {},
    showPage: (viewId, file) => set((state) => (state.pages[viewId] === file ? state : { pages: { ...state.pages, [viewId]: file } })),
    pickedPages: {},
    pickPage: (viewId, file) => set((state) => ({ pages: { ...state.pages, [viewId]: file }, pickedPages: { ...state.pickedPages, [viewId]: true } })),
    followNewPage: (viewId, file, follow) => {
        if (follow === 'until-picked' && get().pickedPages[viewId] === true) {
            return;
        }

        get().showPage(viewId, file);
    },
    cameras: {},
    keepCamera: (key, camera) => set((state) => ({ cameras: { ...state.cameras, [key]: camera } })),
    openAgentPage: (agentId, page, picked) =>
        set((state) => {
            const { [agentId]: _before, ...pickedPages } = state.pickedPages;

            return {
                pages: { ...state.pages, [agentId]: page },
                pickedPages: picked ? { ...pickedPages, [agentId]: true } : pickedPages
            };
        })
}));

export function designCameraKey(designId: string, file: string): string {
    return `${designId}/${file}`;
}

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

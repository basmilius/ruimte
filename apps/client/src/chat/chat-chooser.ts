import { useMemo } from 'react';
import { create } from 'zustand';
import { isCanvasView, type AgentKind, type ProjectView, type SplitLayout } from '@ruimte/contracts';
import { useSidebarSource, type SidebarSource } from '@/shell/sidebar-source';
import { viewIdsIn } from '@/shell/split';
import { useDocument } from '@/state/document';
import type { SelectionOffer } from '@/chat/selection-to-chat';

export interface ChooserChat {
    readonly id: string;
    readonly title: string;
    /* Absent where the node names no CLI yet. */
    readonly provider: AgentKind | null;
}

/* The three lists of the chooser, each left out of the menu when empty. */
export interface ChooserSections {
    readonly linked: readonly ChooserChat[];
    readonly here: readonly ChooserChat[];
    readonly others: readonly ChooserChat[];
}

/* Every chat of the project with the CLI it runs, node or view, in sidebar order. */
export function chooserChats(source: Pick<SidebarSource, 'views' | 'canvases'>): ChooserChat[] {
    return source.views.flatMap((view): ChooserChat[] => {
        if (view.kind === 'chat') {
            return view.empty === true || view.hidden === true ? [] : [{ id: view.id, title: view.name, provider: view.node.provider ?? null }];
        }
        if (!isCanvasView(view)) {
            return [];
        }
        const nodes = source.canvases[view.id] ?? view.nodes;
        return nodes.filter((node) => node.kind === 'chat').map((node) => ({ id: node.id, title: node.title, provider: node.provider ?? null }));
    });
}

/*
 * The chats a person can see right now: a chat view in a cell, or a chat node on a canvas in a cell.
 * A canvas that is in a cell but panned away still counts, since it is one tap from the screen.
 */
export function chatsOpenHere(views: readonly ProjectView[], layout: SplitLayout | null, canvases: SidebarSource['canvases']): Set<string> {
    const inCells = new Set(layout === null ? [] : viewIdsIn(layout));
    const open = new Set<string>();
    for (const view of views) {
        if (!inCells.has(view.id)) {
            continue;
        }
        if (view.kind === 'chat') {
            open.add(view.id);
        } else if (isCanvasView(view)) {
            for (const node of canvases[view.id] ?? view.nodes) {
                if (node.kind === 'chat') {
                    open.add(node.id);
                }
            }
        }
    }
    return open;
}

/* Linked chats first, in the order of their lines; the open ones next, then the rest, each in sidebar order. */
export function chooserSections(chats: readonly ChooserChat[], linkedIds: readonly string[], openIds: ReadonlySet<string>): ChooserSections {
    const byId = new Map(chats.map((chat) => [chat.id, chat]));
    const linked = linkedIds.flatMap((id) => byId.get(id) ?? []);
    const taken = new Set(linked.map((chat) => chat.id));
    const rest = chats.filter((chat) => !taken.has(chat.id));
    return {
        linked,
        here: rest.filter((chat) => openIds.has(chat.id)),
        others: rest.filter((chat) => !openIds.has(chat.id))
    };
}

/* The sections for a source, from what the sidebar and the grid hold now. */
export function useChooserSections(linkedIds: readonly string[]): ChooserSections {
    const source = useSidebarSource();
    const layout = useDocument((s) => s.layout);
    return useMemo(() => chooserSections(chooserChats(source), linkedIds, chatsOpenHere(source.views, layout, source.canvases)), [source, layout, linkedIds]);
}

interface ChatChooserState {
    /* What is being offered and where the menu stands, in the page's pixels; null while it is closed. */
    readonly request: { readonly offer: SelectionOffer; readonly x: number; readonly y: number } | null;
    open(offer: SelectionOffer, at: { x: number; y: number }): void;
    close(): void;
}

export const useChatChooser = create<ChatChooserState>((set) => ({
    request: null,
    open: (offer, at) => set({ request: { offer, x: at.x, y: at.y } }),
    close: () => set({ request: null })
}));

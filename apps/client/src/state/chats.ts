import { create } from 'zustand';
import type { AgentStatus, ChatEvent, ChatInfo, ChatItem } from '@ruimte/contracts';
import { nodeStatus, useSessions, type StatusOf } from '@/state/sessions';

interface ChatState {
    info: ChatInfo;
    items: Record<string, ChatItem>;
    order: string[];
}

export type ChatsById = Record<string, ChatState>;

export interface ChatSink {
    reset(chatId: string, info: ChatInfo, items: ChatItem[]): void;
    apply(chatId: string, event: ChatEvent): void;
    forget(chatId: string): void;
}

interface ChatsStore extends ChatSink {
    byNodeId: ChatsById;
    /* Drops every thread. The chats keep running on the daemon; this client is done looking at them. */
    clear(): void;
}

const applyEvent = (state: ChatState, event: ChatEvent): ChatState => {
    switch (event.type) {
        case 'item': {
            const known = event.item.id in state.items;
            return {
                ...state,
                items: { ...state.items, [event.item.id]: event.item },
                order: known ? state.order : [...state.order, event.item.id]
            };
        }
        case 'delta': {
            const item = state.items[event.itemId];
            if (item?.kind === 'assistant') {
                return { ...state, items: { ...state.items, [event.itemId]: { ...item, text: item.text + event.text } } };
            }
            if (item?.kind === 'tool' && item.state === 'running') {
                const progress = item.progress ?? { startedAt: null, description: null, output: null };
                return {
                    ...state,
                    items: { ...state.items, [event.itemId]: { ...item, progress: { ...progress, output: (progress.output ?? '') + event.text } } }
                };
            }
            return state;
        }
        case 'info':
            return { ...state, info: event.info };
    }
};

export const useChats = create<ChatsStore>((set) => ({
    byNodeId: {},
    reset(chatId, info, items) {
        set((s) => ({
            byNodeId: {
                ...s.byNodeId,
                [chatId]: { info, items: Object.fromEntries(items.map((item) => [item.id, item])), order: items.map((item) => item.id) }
            }
        }));
    },
    apply(chatId, event) {
        set((s) => {
            const current = s.byNodeId[chatId];
            if (!current) {
                return {};
            }
            return { byNodeId: { ...s.byNodeId, [chatId]: applyEvent(current, event) } };
        });
    },
    forget(chatId) {
        set((s) => {
            const next = { ...s.byNodeId };
            delete next[chatId];
            return { byNodeId: next };
        });
    },
    clear() {
        set({ byNodeId: {} });
    }
}));

/* Status of one node, read from whichever store owns it. Both hooks subscribe, so a change in either re-renders. */
export const useNodeStatus = (node: StatusOf): AgentStatus | undefined => {
    const session = useSessions((s) => s.byNodeId[node.id]);
    const chat = useChats((s) => s.byNodeId[node.id]);
    return nodeStatus(node, session ? { [node.id]: session } : {}, chat ? { [node.id]: chat } : {});
};

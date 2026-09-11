import { create } from 'zustand';
import type { AgentStatus, ChatEvent, ChatInfo, ChatItem } from '@ruimte/contracts';
import { dropEndpoint, endpointKey, useEndpointId } from '@/state/keys';
import { nodeStatus, useSessions, type StatusOf } from '@/state/sessions';

export interface ChatState {
    info: ChatInfo;
    items: Record<string, ChatItem>;
    order: string[];
}

/* Rows keyed with `endpointKey`, so a thread says which daemon it runs on. */
export type ChatsById = Record<string, ChatState>;

/* What a chat client writes. It owns one machine's socket, so it speaks in node ids alone. */
export interface ChatSink {
    reset(chatId: string, info: ChatInfo, items: ChatItem[]): void;
    apply(chatId: string, event: ChatEvent): void;
    forget(chatId: string): void;
}

interface ChatsStore {
    byKey: ChatsById;
    reset(key: string, info: ChatInfo, items: ChatItem[]): void;
    apply(key: string, event: ChatEvent): void;
    forget(key: string): void;
    /* Drops one machine's threads. They keep running on the daemon; this client is done looking at them. */
    clear(endpointId: string): void;
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
    byKey: {},
    reset(key, info, items) {
        set((s) => ({
            byKey: {
                ...s.byKey,
                [key]: { info, items: Object.fromEntries(items.map((item) => [item.id, item])), order: items.map((item) => item.id) }
            }
        }));
    },
    apply(key, event) {
        set((s) => {
            const current = s.byKey[key];
            if (!current) {
                return {};
            }
            return { byKey: { ...s.byKey, [key]: applyEvent(current, event) } };
        });
    },
    forget(key) {
        set((s) => {
            const next = { ...s.byKey };
            delete next[key];
            return { byKey: next };
        });
    },
    clear(endpointId) {
        set((s) => ({ byKey: dropEndpoint(s.byKey, endpointId) }));
    }
}));

/* The sink of one daemon's chat client: it hands over node ids, this puts them under its machine. */
export const chatSinkFor = (endpointId: string): ChatSink => ({
    reset: (chatId, info, items) => useChats.getState().reset(endpointKey(endpointId, chatId), info, items),
    apply: (chatId, event) => useChats.getState().apply(endpointKey(endpointId, chatId), event),
    forget: (chatId) => useChats.getState().forget(endpointKey(endpointId, chatId))
});

/* One node's thread on the machine in scope. The selector keeps a render tied to the field it reads. */
export const useChatRow = <T>(chatId: string, select: (row: ChatState | undefined) => T): T => {
    const endpointId = useEndpointId();
    return useChats((s) => select(s.byKey[endpointKey(endpointId, chatId)]));
};

/* Status of one node, read from whichever store owns it. Both hooks subscribe, so a change in either re-renders. */
export const useNodeStatus = (node: StatusOf): AgentStatus | undefined => {
    const endpointId = useEndpointId();
    const key = endpointKey(endpointId, node.id);
    const session = useSessions((s) => s.byKey[key]);
    const chat = useChats((s) => s.byKey[key]);
    return nodeStatus(node, session ? { [key]: session } : {}, chat ? { [key]: chat } : {}, endpointId);
};

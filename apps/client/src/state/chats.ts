import { create } from 'zustand';
import type { AgentStatus, ChatEvent, ChatInfo, ChatItem } from '@ruimte/contracts';
import { dropEndpoint, endpointKey, useEndpointId } from '@/state/keys';
import { nodeStatus, useSessions, type StatusOf } from '@/state/sessions';

export interface ChatState {
    info: ChatInfo;
    items: Record<string, ChatItem>;
    /*
     * The items as the timeline groups them: the same map as `items`, except that a delta growing a
     * reply or a thought that already has text leaves it as it was. The rows are derived from this,
     * so a word arriving touches the row that draws it and not the whole thread; that row reads its
     * text from `items`.
     */
    structure: Record<string, ChatItem>;
    order: string[];
    historyCursor?: string | null;
    loadingHistory?: boolean;
}

/* Rows keyed with `endpointKey`, so a thread says which daemon it runs on. */
export type ChatsById = Record<string, ChatState>;

/* What a chat client writes. It owns one machine's socket, so it speaks in node ids alone. */
export interface ChatSink {
    reset(chatId: string, info: ChatInfo, items: ChatItem[], historyCursor?: string | null): void;
    prepend(chatId: string, items: ChatItem[], historyCursor: string | null): void;
    setHistoryLoading(chatId: string, loading: boolean): void;
    apply(chatId: string, event: ChatEvent): void;
    forget(chatId: string): void;
}

interface ChatsStore {
    byKey: ChatsById;
    reset(key: string, info: ChatInfo, items: ChatItem[], historyCursor?: string | null): void;
    prepend(key: string, items: ChatItem[], historyCursor: string | null): void;
    setHistoryLoading(key: string, loading: boolean): void;
    apply(key: string, event: ChatEvent): void;
    forget(key: string): void;
    /* Drops one machine's threads. They keep running on the daemon; this client is done looking at them. */
    clear(endpointId: string): void;
}

const stateOf = (info: ChatInfo, items: ChatItem[], historyCursor: string | null = null): ChatState => {
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    return { info, items: byId, structure: byId, order: items.map((item) => item.id), historyCursor, loadingHistory: false };
};

/* The state with one item replaced, in the thread and in the structure the rows come from. */
const withItem = (state: ChatState, item: ChatItem): ChatState => {
    const items = { ...state.items, [item.id]: item };
    return { ...state, items, structure: items };
};

export const applyEvent = (state: ChatState, event: ChatEvent): ChatState => {
    switch (event.type) {
        case 'item': {
            const known = event.item.id in state.items;
            return { ...withItem(state, event.item), order: known ? state.order : [...state.order, event.item.id] };
        }
        case 'delta': {
            const item = state.items[event.itemId];
            if (item?.kind === 'assistant' || item?.kind === 'thinking') {
                const grown = { ...item, text: item.text + event.text };
                // The first text is structure after all: an empty reply that is not streaming has no row.
                // A sub-agent's text is drawn from inside its parent's row, which only the rows carry.
                if (item.text === '' || (item.kind === 'assistant' && item.parentToolUseId)) {
                    return withItem(state, grown);
                }
                return { ...state, items: { ...state.items, [event.itemId]: grown } };
            }
            if (item?.kind === 'tool' && item.state === 'running') {
                const progress = item.progress ?? { startedAt: null, description: null, output: null };
                return withItem(state, { ...item, progress: { ...progress, output: (progress.output ?? '') + event.text } });
            }
            return state;
        }
        case 'info':
            return { ...state, info: event.info };
        case 'reset':
            return stateOf(event.info, event.items);
    }
};

export const useChats = create<ChatsStore>((set) => ({
    byKey: {},
    reset(key, info, items, historyCursor = null) {
        set((s) => ({
            byKey: {
                ...s.byKey,
                [key]: stateOf(info, items, historyCursor)
            }
        }));
    },
    prepend(key, items, historyCursor) {
        set((s) => {
            const current = s.byKey[key];
            if (!current) {
                return {};
            }
            const older = items.filter((item) => !(item.id in current.items));
            const byId = Object.fromEntries(older.map((item) => [item.id, item]));
            return {
                byKey: {
                    ...s.byKey,
                    [key]: {
                        ...current,
                        items: { ...byId, ...current.items },
                        structure: { ...byId, ...current.structure },
                        order: [...older.map((item) => item.id), ...current.order],
                        historyCursor,
                        loadingHistory: false
                    }
                }
            };
        });
    },
    setHistoryLoading(key, loading) {
        set((s) => {
            const current = s.byKey[key];
            return current ? { byKey: { ...s.byKey, [key]: { ...current, loadingHistory: loading } } } : {};
        });
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
    reset: (chatId, info, items, historyCursor) => useChats.getState().reset(endpointKey(endpointId, chatId), info, items, historyCursor),
    prepend: (chatId, items, historyCursor) => useChats.getState().prepend(endpointKey(endpointId, chatId), items, historyCursor),
    setHistoryLoading: (chatId, loading) => useChats.getState().setHistoryLoading(endpointKey(endpointId, chatId), loading),
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

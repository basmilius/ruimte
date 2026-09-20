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
}

/* Rows keyed with `endpointKey`, so a thread says which daemon it runs on. */
export type ChatsById = Record<string, ChatState>;

/* What a chat client writes. It owns one machine's socket, so it speaks in node ids alone. */
export interface ChatSink {
    reset(chatId: string, info: ChatInfo, items: ChatItem[]): void;
    apply(chatId: string, event: ChatEvent): void;
    /* What a chat is doing, for a thread nobody in this window has open. */
    status(chatId: string, info: ChatInfo): void;
    forget(chatId: string): void;
}

interface ChatsStore {
    byKey: ChatsById;
    reset(key: string, info: ChatInfo, items: ChatItem[]): void;
    apply(key: string, event: ChatEvent): void;
    status(key: string, info: ChatInfo): void;
    forget(key: string): void;
    /* Drops one machine's threads. They keep running on the daemon; this client is done looking at them. */
    clear(endpointId: string): void;
}

const stateOf = (info: ChatInfo, items: ChatItem[]): ChatState => {
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    return { info, items: byId, structure: byId, order: items.map((item) => item.id) };
};

/* The state with one item replaced, in the thread and in the structure the rows come from. */
const withItem = (state: ChatState, item: ChatItem): ChatState => {
    const items = { ...state.items, [item.id]: item };
    return { ...state, items, structure: items };
};

/* Cheap enough, since a status only arrives when the daemon saw one change, never on a streamed word. */
const sameInfo = (left: ChatInfo, right: ChatInfo): boolean => JSON.stringify(left) === JSON.stringify(right);

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
                // The first text is structure after all, since an empty reply that is not streaming has no row.
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
    reset(key, info, items) {
        set((s) => ({
            byKey: {
                ...s.byKey,
                [key]: stateOf(info, items)
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
    /*
     * The status of a chat this window is not reading, which the daemon sends for every chat it has
     * loaded. The thread stays empty until somebody attaches, since this is what a node header, the
     * sidebar and the counters need, and they ask the info and never the items.
     */
    status(key, info) {
        set((s) => {
            const current = s.byKey[key];
            if (!current) {
                return { byKey: { ...s.byKey, [key]: stateOf(info, []) } };
            }
            // An attached client already had this on `chat.event`; writing it again would redraw the thread.
            if (sameInfo(current.info, info)) {
                return {};
            }
            return { byKey: { ...s.byKey, [key]: { ...current, info } } };
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
    status: (chatId, info) => useChats.getState().status(endpointKey(endpointId, chatId), info),
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

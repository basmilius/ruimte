import { create } from 'zustand';
import type { ChatApprovalItem, ChatBookmark, ChatEvent, ChatHistoryResult, ChatInfo, ChatItem, ChatQuestionItem } from '@ruimte/agent-contracts';
import { useChatScope } from '../scope';

export interface ChatState {
    info: ChatInfo;
    items: Record<string, ChatItem>;
    /*
     * The items as the timeline groups them: the same map as `items`, except that a delta growing a
     * reply or a thought that already has text, or the output of a running call, leaves it as it was.
     * The rows are derived from this, so a word arriving touches the row that draws it and not the
     * whole thread; that row reads its text from `items` with `useCurrentItem`.
     */
    structure: Record<string, ChatItem>;
    order: string[];
    /* Where the part of the thread this client holds begins; absent when it holds the whole thread. */
    history?: ChatHistoryPage;
    /*
     * Requests from before that part that still wait, oldest first. They are in `items` and
     * `structure` but not in `order`, since the thread on screen does not reach back to them yet.
     */
    waitingBefore?: string[];
    /* The messages marked to come back to, as the host last said; absent until it said anything. */
    bookmarks?: ChatBookmark[];
}

export type ChatHistoryPage = ChatHistoryResult['history'];

/* The newest part of a thread, as `chat.attach` hands it over with a `historyLimit`. */
export interface ChatPage {
    history: ChatHistoryPage;
    /* Every request of the chat that still waits, wherever in the thread it is. */
    pending: ChatItem[];
}

/* Rows keyed with the scope's `keyOf`, so a thread says which host it runs on. */
export type ChatsById = Record<string, ChatState>;

/* What a chat is doing, without its thread. */
export type ChatStatuses = Record<string, Pick<ChatState, 'info'>>;

/* What a chat client writes. It owns one host's link, so it speaks in chat ids alone. */
export interface ChatSink {
    /* Without a page the items are the whole thread. */
    reset(chatId: string, info: ChatInfo, items: ChatItem[], page?: ChatPage): void;
    /* The page before the one the chat holds, read with `cursor`. */
    prepend(chatId: string, cursor: string, page: ChatHistoryResult): void;
    apply(chatId: string, event: ChatEvent): void;
    /* What a chat is doing, for a thread nobody in this window has open. */
    status(chatId: string, info: ChatInfo): void;
    bookmarks(chatId: string, bookmarks: ChatBookmark[]): void;
    forget(chatId: string): void;
}

interface ChatsStore {
    byKey: ChatsById;
    /* Replaced only when a chat's info is, never for a streamed word, so what reads the status alone is not redrawn by one. */
    statusByKey: ChatStatuses;
    reset(key: string, info: ChatInfo, items: ChatItem[], page?: ChatPage): void;
    prepend(key: string, cursor: string, page: ChatHistoryResult): void;
    apply(key: string, event: ChatEvent): void;
    status(key: string, info: ChatInfo): void;
    bookmarks(key: string, bookmarks: ChatBookmark[]): void;
    forget(key: string): void;
    /* Drops the threads whose key matches, such as every thread of one host. They keep running there; this client is done looking at them. */
    forgetWhere(matches: (key: string) => boolean): void;
}

const isWaiting = (item: ChatItem | undefined): item is ChatApprovalItem | ChatQuestionItem =>
    (item?.kind === 'approval' && item.decision === 'pending') || (item?.kind === 'question' && item.state === 'pending');

const stateOf = (info: ChatInfo, items: ChatItem[], page?: ChatPage): ChatState => {
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    const order = items.map((item) => item.id);
    if (page === undefined || page.history.cursor === null) {
        return { info, items: byId, structure: byId, order };
    }
    const before = page.pending.filter((item) => !(item.id in byId));
    for (const item of before) {
        byId[item.id] = item;
    }
    return { info, items: byId, structure: byId, order, history: page.history, waitingBefore: before.map((item) => item.id) };
};

/* An older host names no place in the thread, and it always hands over the whole of it. */
const isBeforePage = (state: ChatState, historyIndex: number | undefined): boolean =>
    state.history !== undefined && historyIndex !== undefined && historyIndex < state.history.start;

/* An item from before the page this client holds matters only as a request that waits, or one that stopped waiting. */
const withEarlierItem = (state: ChatState, item: ChatItem): ChatState => {
    const waiting = state.waitingBefore ?? [];
    const held = waiting.includes(item.id);
    if (isWaiting(item)) {
        return { ...withItem(state, item), waitingBefore: held ? waiting : [...waiting, item.id] };
    }
    return held ? { ...withItem(state, item), waitingBefore: waiting.filter((id) => id !== item.id) } : state;
};

/* The page before the one a chat holds, unless the thread was read again since that page was asked for. */
export const prependPage = (state: ChatState, cursor: string, page: ChatHistoryResult): ChatState => {
    if (state.history?.cursor !== cursor) {
        return state;
    }
    const held = new Set(state.order);
    const older = page.items.filter((item) => !held.has(item.id));
    const olderIds = new Set(older.map((item) => item.id));
    const items = { ...state.items };
    for (const item of older) {
        items[item.id] = item;
    }
    const order = [...olderIds, ...state.order];
    if (page.history.cursor === null) {
        const { history: _history, waitingBefore: _waitingBefore, ...rest } = state;
        return { ...rest, items, structure: items, order };
    }
    const waitingBefore = (state.waitingBefore ?? []).filter((id) => !olderIds.has(id));
    return { ...state, items, structure: items, order, history: page.history, waitingBefore };
};

/* The requests that still wait, oldest first: those from before the page this client holds, then the thread's own. */
export const waitingRequestsOf = (chat: Pick<ChatState, 'structure' | 'order' | 'waitingBefore'> | undefined): Array<ChatApprovalItem | ChatQuestionItem> =>
    [...(chat?.waitingBefore ?? []), ...(chat?.order ?? [])].map((id) => chat?.structure[id]).filter(isWaiting);

/* The state with one item replaced, in the thread and in the structure the rows come from. */
const withItem = (state: ChatState, item: ChatItem): ChatState => {
    const items = { ...state.items, [item.id]: item };
    return { ...state, items, structure: items };
};

/* Cheap enough, since a status only arrives when the host saw one change, never on a streamed word. */
const sameInfo = (left: ChatInfo, right: ChatInfo): boolean => JSON.stringify(left) === JSON.stringify(right);

/* The statuses with this chat's info in them, the same object when that info is already there. */
const withStatus = (statuses: ChatStatuses, key: string, info: ChatInfo): ChatStatuses =>
    statuses[key]?.info === info ? statuses : { ...statuses, [key]: { info } };

const without = <T>(rows: Record<string, T>, matches: (key: string) => boolean): Record<string, T> =>
    Object.fromEntries(Object.entries(rows).filter(([key]) => !matches(key)));

export const applyEvent = (state: ChatState, event: ChatEvent): ChatState => {
    switch (event.type) {
        case 'item': {
            if (isBeforePage(state, event.historyIndex)) {
                return withEarlierItem(state, event.item);
            }
            const known = event.item.id in state.items;
            return { ...withItem(state, event.item), order: known ? state.order : [...state.order, event.item.id] };
        }
        case 'delta': {
            const item = state.items[event.itemId];
            if (item?.kind === 'assistant' || item?.kind === 'thinking') {
                const grown = { ...item, text: item.text + event.text };
                // The first text is structure after all, since an empty reply that is not streaming has no row.
                if (item.text === '') {
                    return withItem(state, grown);
                }
                return { ...state, items: { ...state.items, [event.itemId]: grown } };
            }
            if (item?.kind === 'tool' && item.state === 'running') {
                const progress = item.progress ?? { startedAt: null, description: null, output: null };
                const grown = { ...item, progress: { ...progress, output: (progress.output ?? '') + event.text } };
                return { ...state, items: { ...state.items, [event.itemId]: grown } };
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
    statusByKey: {},
    reset(key, info, items, page) {
        set((s) => {
            // The bookmarks are not part of the thread; they come in on their own and outlive a reset of it.
            const bookmarks = s.byKey[key]?.bookmarks;
            const next = stateOf(info, items, page);
            return {
                byKey: { ...s.byKey, [key]: bookmarks === undefined ? next : { ...next, bookmarks } },
                statusByKey: withStatus(s.statusByKey, key, info)
            };
        });
    },
    prepend(key, cursor, page) {
        set((s) => {
            const current = s.byKey[key];
            if (!current) {
                return {};
            }
            const next = prependPage(current, cursor, page);
            return next === current ? {} : { byKey: { ...s.byKey, [key]: next } };
        });
    },
    apply(key, event) {
        set((s) => {
            const current = s.byKey[key];
            if (!current) {
                return {};
            }
            const next = applyEvent(current, event);
            return { byKey: { ...s.byKey, [key]: next }, statusByKey: withStatus(s.statusByKey, key, next.info) };
        });
    },
    /*
     * The status of a chat this window is not reading, which the host sends for every chat it has
     * loaded. The thread stays empty until somebody attaches, since this is what a header, a list and
     * the counters need, and they ask the info and never the items.
     */
    status(key, info) {
        set((s) => {
            const current = s.byKey[key];
            if (!current) {
                return { byKey: { ...s.byKey, [key]: stateOf(info, []) }, statusByKey: withStatus(s.statusByKey, key, info) };
            }
            // An attached client already had this on `chat.event`; writing it again would redraw the thread.
            if (sameInfo(current.info, info)) {
                return {};
            }
            return { byKey: { ...s.byKey, [key]: { ...current, info } }, statusByKey: withStatus(s.statusByKey, key, info) };
        });
    },
    bookmarks(key, bookmarks) {
        set((s) => {
            const current = s.byKey[key];
            if (!current) {
                return {};
            }
            return { byKey: { ...s.byKey, [key]: { ...current, bookmarks } } };
        });
    },
    forget(key) {
        set((s) => {
            const next = { ...s.byKey };
            delete next[key];
            const statuses = { ...s.statusByKey };
            delete statuses[key];
            return { byKey: next, statusByKey: statuses };
        });
    },
    forgetWhere(matches) {
        set((s) => ({ byKey: without(s.byKey, matches), statusByKey: without(s.statusByKey, matches) }));
    }
}));

/* The sink of one host's chat client: it hands over chat ids, this puts them under the keys of its scope. */
export const chatSink = (keyOf: (chatId: string) => string): ChatSink => ({
    reset: (chatId, info, items, page) => useChats.getState().reset(keyOf(chatId), info, items, page),
    prepend: (chatId, cursor, page) => useChats.getState().prepend(keyOf(chatId), cursor, page),
    apply: (chatId, event) => useChats.getState().apply(keyOf(chatId), event),
    status: (chatId, info) => useChats.getState().status(keyOf(chatId), info),
    bookmarks: (chatId, bookmarks) => useChats.getState().bookmarks(keyOf(chatId), bookmarks),
    forget: (chatId) => useChats.getState().forget(keyOf(chatId))
});

/* One chat's thread in the scope this is rendered in. The selector keeps a render tied to the field it reads. */
export const useChatRow = <T>(chatId: string, select: (row: ChatState | undefined) => T): T => {
    const { keyOf } = useChatScope();
    return useChats((s) => select(s.byKey[keyOf(chatId)]));
};

/* The item as the thread holds it now, for a row derived from the structure, which a delta leaves alone. */
export const useCurrentItem = <T extends ChatItem>(chatId: string, derived: T): T =>
    useChatRow(chatId, (row) => {
        const item = row?.items[derived.id];
        return item?.kind === derived.kind ? (item as T) : derived;
    });

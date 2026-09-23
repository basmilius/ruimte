import i18next from 'i18next';
import type { ChatItem, ChatSubagentResult } from '@ruimte/contracts';
import { isConnectionError, TransportError, type Transport } from '../transport/transport';

// What the panel opens on: the newest end of the conversation, which is where an agent that works is.
export const SUBAGENT_PAGE = 60;

export interface SubagentConversationState {
    status: 'loading' | 'ready' | 'failed';
    items: ChatItem[];
    /* Where the page before the oldest item on screen starts; null once the start is there. */
    cursor: string | null;
    live: boolean;
    loadingEarlier: boolean;
    /* Why nothing could be read, as the machine said it. */
    error: string | null;
    /* The machine answered that it knows no such request, which is a machine from before this panel. */
    unsupported: boolean;
}

export const INITIAL_CONVERSATION: SubagentConversationState = {
    status: 'loading',
    items: [],
    cursor: null,
    live: false,
    loadingEarlier: false,
    error: null,
    unsupported: false
};

/*
 * The newest page laid over what is on screen. An item that is already there is replaced where it
 * stands and a new one goes after them all. A page that shares nothing with what is held means more
 * happened than one page holds, so what is held is dropped for it rather than shown with a hole.
 */
export const mergeNewest = (
    current: ChatItem[],
    currentCursor: string | null,
    page: ChatItem[],
    pageCursor: string | null
): { items: ChatItem[]; cursor: string | null } => {
    const known = new Map(current.map((item, index) => [item.id, index]));
    if (current.length > 0 && page.length > 0 && !page.some((item) => known.has(item.id))) {
        return { items: page, cursor: pageCursor };
    }
    const items = [...current];
    for (const item of page) {
        const index = known.get(item.id);
        if (index === undefined) {
            items.push(item);
        } else {
            items[index] = item;
        }
    }
    return { items, cursor: current.length === 0 ? pageCursor : currentCursor };
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : i18next.t('chat:subagents.noAnswer'));

/*
 * One subagent's conversation as a panel follows it. Opening asks for the newest page and holds the
 * conversation on the machine, which then says whenever it grew; each time, the newest page is asked
 * again and laid over what is there. A socket that comes back holds it again, and letting go is the
 * last thing it says.
 */
export class SubagentConversation {
    private readonly transport: Transport;
    private readonly chatId: string;
    private readonly toolUseId: string;
    private readonly onChange: (state: SubagentConversationState) => void;
    private readonly unsubscribe: Array<() => void> = [];
    private state: SubagentConversationState = INITIAL_CONVERSATION;
    private disposed = false;
    // One request at a time, so a refresh never lands under an older page that arrived after it.
    private queue: Promise<void> = Promise.resolve();
    private refreshWaiting = false;

    constructor(transport: Transport, chatId: string, toolUseId: string, onChange: (state: SubagentConversationState) => void) {
        this.transport = transport;
        this.chatId = chatId;
        this.toolUseId = toolUseId;
        this.onChange = onChange;
    }

    get current(): SubagentConversationState {
        return this.state;
    }

    start(): Promise<void> {
        this.unsubscribe.push(
            this.transport.on('chat.subagentChanged', (event) => {
                if (event.chatId === this.chatId && event.toolUseId === this.toolUseId) {
                    void this.refresh();
                }
            }),
            this.transport.subscribeStatus((status) => {
                if (status === 'open') {
                    void this.enqueue(() => this.readNewest(true));
                }
            })
        );
        return this.enqueue(() => this.readNewest(true));
    }

    /* The newest page again; calls that arrive while one waits become that one. */
    refresh(): Promise<void> {
        if (this.refreshWaiting) {
            return this.queue;
        }
        this.refreshWaiting = true;
        return this.enqueue(() => {
            this.refreshWaiting = false;
            return this.readNewest(false);
        });
    }

    loadEarlier(): Promise<void> {
        return this.enqueue(async () => {
            const cursor = this.state.cursor;
            if (cursor === null) {
                return;
            }
            this.set({ loadingEarlier: true });
            try {
                const page = await this.ask({ cursor, limit: SUBAGENT_PAGE });
                this.set({ items: [...page.items, ...this.state.items], cursor: page.history.cursor, live: page.live, loadingEarlier: false });
            } catch (error) {
                if (error instanceof TransportError && error.code === 'history-expired') {
                    // The record was written again under this panel; what it holds now is the only truth.
                    this.set({ items: [], cursor: null, loadingEarlier: false });
                    await this.readNewest(false);
                    return;
                }
                this.set({ loadingEarlier: false, error: messageOf(error) });
            }
        });
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const off of this.unsubscribe.splice(0)) {
            off();
        }
        if (this.transport.status === 'open') {
            void this.transport.request('chat.subagent', { chatId: this.chatId, toolUseId: this.toolUseId, limit: 1, watch: false }).catch(() => undefined);
        }
    }

    private async readNewest(watch: boolean): Promise<void> {
        try {
            const page = await this.ask({ limit: SUBAGENT_PAGE, ...(watch ? { watch: true } : {}) });
            const merged = mergeNewest(this.state.items, this.state.cursor, page.items, page.history.cursor);
            this.set({ status: 'ready', items: merged.items, cursor: merged.cursor, live: page.live, error: null });
        } catch (error) {
            if (this.state.status === 'ready' && isConnectionError(error)) {
                // What is on screen stays; the socket that comes back asks again.
                return;
            }
            const unsupported = error instanceof TransportError && error.code === 'unknown-request';
            this.set({ status: 'failed', error: messageOf(error), unsupported });
        }
    }

    private ask(extra: { cursor?: string; limit: number; watch?: boolean }): Promise<ChatSubagentResult> {
        return this.transport.request('chat.subagent', { chatId: this.chatId, toolUseId: this.toolUseId, ...extra });
    }

    private enqueue(work: () => Promise<void>): Promise<void> {
        const next = this.queue.then(() => (this.disposed ? undefined : work()));
        this.queue = next.catch(() => undefined);
        return next;
    }

    private set(patch: Partial<SubagentConversationState>): void {
        if (this.disposed) {
            return;
        }
        this.state = { ...this.state, ...patch };
        this.onChange(this.state);
    }
}

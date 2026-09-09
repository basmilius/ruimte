import type { ChatAttachment, ChatConfigurePayload, ChatInfo, ChatItem, FsSearchResult, InteractionMode, ModelSelection, RuntimeMode } from '@ruimte/contracts';
import type { ChatSink } from '../state/chats';
import type { ProviderInfo } from '@ruimte/contracts';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';

export interface ChatOpenOptions {
    cwd?: string;
    /* A CLI session to continue, for a chat opened from a terminal that ran the agent. */
    resume?: string;
    /* What a fresh chat starts with; an existing chat keeps what it has. */
    selection?: ModelSelection;
    runtimeMode?: RuntimeMode;
    interactionMode?: InteractionMode;
}

export interface ChatSendExtras {
    /* Paths picked with `@`; they also sit in the text, this is what the timeline highlights. */
    mentions?: string[];
    attachments?: ChatAttachment[];
}

interface Mounted extends ChatOpenOptions {
    attached: boolean;
}

export interface ProviderSink {
    setProviders(providers: ProviderInfo[]): void;
}

const isConnectionError = (e: unknown): boolean => e instanceof TransportError && (e.code === 'not-connected' || e.code === 'disconnected');

/*
 * One daemon chat per node id. Like the terminal's session client: a node opens on mount and
 * detaches on unmount, and every mounted chat is attached again when the transport comes back.
 * The provider list is fetched once per connection and handed to its own store.
 */
export class ChatClient {
    private readonly transport: Transport;
    private readonly sink: ChatSink;
    private readonly providers: ProviderSink | null;
    private readonly mounted = new Map<string, Mounted>();
    private readonly unsubscribe: Array<() => void> = [];

    constructor(transport: Transport, sink: ChatSink, providers: ProviderSink | null = null) {
        this.transport = transport;
        this.sink = sink;
        this.providers = providers;
        this.unsubscribe.push(
            transport.on('chat.event', ({ chatId, event }) => this.sink.apply(chatId, event)),
            transport.subscribeStatus((status) => this.onStatus(status))
        );
        if (transport.status === 'open') {
            void this.loadProviders();
        }
    }

    /* Answers false when the transport is not connected; the chat opens once it is. */
    async open(chatId: string, options: ChatOpenOptions): Promise<boolean> {
        this.mounted.set(chatId, { ...options, attached: false });
        try {
            await this.attach(chatId);
            return true;
        } catch (e) {
            if (isConnectionError(e)) {
                return false;
            }
            throw e;
        }
    }

    async detach(chatId: string): Promise<void> {
        const entry = this.mounted.get(chatId);
        this.mounted.delete(chatId);
        if (!entry?.attached) {
            return;
        }
        try {
            await this.transport.request('chat.detach', { chatId });
        } catch {
            // The socket closing detaches every chat server-side anyway.
        }
    }

    async send(chatId: string, text: string, extras: ChatSendExtras = {}): Promise<void> {
        await this.transport.request('chat.send', { chatId, text, mentions: extras.mentions, attachments: extras.attachments });
    }

    /* Files under `cwd` that fuzzy-match `query`, for the composer's mention picker. */
    async searchFiles(cwd: string, query: string, limit = 8): Promise<FsSearchResult> {
        return this.transport.request('fs.search', { cwd, query, limit });
    }

    async compact(chatId: string): Promise<void> {
        await this.transport.request('chat.compact', { chatId });
    }

    async cancel(chatId: string): Promise<void> {
        await this.transport.request('chat.cancel', { chatId });
    }

    async configure(payload: ChatConfigurePayload): Promise<ChatInfo> {
        const info = await this.transport.request('chat.configure', payload);
        this.sink.apply(payload.chatId, { type: 'info', info });
        return info;
    }

    async approve(chatId: string, requestId: string, decision: 'allow' | 'allow-always' | 'deny', message?: string): Promise<void> {
        await this.transport.request('chat.approve', { chatId, requestId, decision, message });
    }

    async answer(chatId: string, requestId: string, answers: Record<string, string>): Promise<void> {
        await this.transport.request('chat.answer', { chatId, requestId, answers });
    }

    async kill(chatId: string): Promise<void> {
        this.mounted.delete(chatId);
        this.sink.forget(chatId);
        await this.transport.request('chat.kill', { chatId });
    }

    async loadProviders(): Promise<void> {
        if (!this.providers) {
            return;
        }
        try {
            const { providers } = await this.transport.request('provider.list', {});
            this.providers.setProviders(providers);
        } catch {
            // The list comes with the next connection; pickers show what they had.
        }
    }

    isMounted(chatId: string): boolean {
        return this.mounted.has(chatId);
    }

    dispose(): void {
        for (const off of this.unsubscribe) {
            off();
        }
        this.unsubscribe.length = 0;
    }

    private async attach(chatId: string): Promise<{ info: ChatInfo; items: ChatItem[] }> {
        const entry = this.mounted.get(chatId);
        await this.transport.request('chat.create', {
            chatId,
            cwd: entry?.cwd,
            resume: entry?.resume,
            selection: entry?.selection,
            runtimeMode: entry?.runtimeMode,
            interactionMode: entry?.interactionMode
        });
        const result = await this.transport.request('chat.attach', { chatId });
        const current = this.mounted.get(chatId);
        if (current) {
            current.attached = true;
            this.sink.reset(chatId, result.info, result.items);
        }
        return result;
    }

    private onStatus(status: TransportStatus): void {
        if (status === 'open') {
            void this.loadProviders();
            void this.reattachAll();
            return;
        }
        for (const entry of this.mounted.values()) {
            entry.attached = false;
        }
    }

    private async reattachAll(): Promise<void> {
        for (const [chatId, entry] of [...this.mounted]) {
            if (entry.attached) {
                continue;
            }
            try {
                await this.attach(chatId);
            } catch {
                // A socket that dropped again will trigger the next round.
            }
        }
    }
}

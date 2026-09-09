import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import type { ChatSink } from '../state/chats';
import { TransportError, type Transport, type TransportStatus } from '../transport/transport';

export interface ChatOpenOptions {
    cwd?: string;
    /* A CLI session to continue, for a chat opened from a terminal that ran the agent. */
    resume?: string;
}

interface Mounted extends ChatOpenOptions {
    attached: boolean;
}

const isConnectionError = (e: unknown): boolean => e instanceof TransportError && (e.code === 'not-connected' || e.code === 'disconnected');

/*
 * One daemon chat per node id. Like the terminal's session client: a node opens on mount and
 * detaches on unmount, and every mounted chat is attached again when the transport comes back.
 */
export class ChatClient {
    private readonly transport: Transport;
    private readonly sink: ChatSink;
    private readonly mounted = new Map<string, Mounted>();
    private readonly unsubscribe: Array<() => void> = [];

    constructor(transport: Transport, sink: ChatSink) {
        this.transport = transport;
        this.sink = sink;
        this.unsubscribe.push(
            transport.on('chat.event', ({ chatId, event }) => this.sink.apply(chatId, event)),
            transport.subscribeStatus((status) => this.onStatus(status))
        );
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

    async send(chatId: string, text: string): Promise<void> {
        await this.transport.request('chat.send', { chatId, text });
    }

    async cancel(chatId: string): Promise<void> {
        await this.transport.request('chat.cancel', { chatId });
    }

    async approve(chatId: string, requestId: string, decision: 'allow' | 'deny', message?: string): Promise<void> {
        await this.transport.request('chat.approve', { chatId, requestId, decision, message });
    }

    async kill(chatId: string): Promise<void> {
        this.mounted.delete(chatId);
        this.sink.forget(chatId);
        await this.transport.request('chat.kill', { chatId });
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
        await this.transport.request('chat.create', { chatId, cwd: entry?.cwd, resume: entry?.resume });
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

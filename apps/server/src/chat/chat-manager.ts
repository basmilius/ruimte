import { homedir } from 'node:os';
import type { ChatCreatePayload, ChatEvent, ChatInfo, ChatItem } from '@ruimte/contracts';
import type { SessionSink } from '../sessions/manager.ts';
import { ChatSession } from './chat-session.ts';
import type { ChatStore } from './chat-store.ts';

export type ChatErrorCode = 'chat-not-found' | 'chat-busy' | 'approval-not-found';

export class ChatError extends Error {
    readonly code: ChatErrorCode;

    constructor(code: ChatErrorCode, message: string) {
        super(message);
        this.name = 'ChatError';
        this.code = code;
    }
}

export interface ChatManagerOptions {
    store?: ChatStore;
    env?: Record<string, string | undefined>;
    // The CLI to run; a test points this at a script that speaks the same protocol.
    command?: string[];
}

export class ChatManager {
    private readonly store: ChatStore | null;
    private readonly env: Record<string, string>;
    private readonly command: string[];
    private readonly chats = new Map<string, ChatSession>();
    private readonly sinks = new Map<string, SessionSink>();
    private readonly attached = new Map<string, Set<string>>();

    constructor(options: ChatManagerOptions = {}) {
        this.store = options.store ?? null;
        this.command = options.command ?? ['claude'];
        this.env = {};
        for (const [key, value] of Object.entries(options.env ?? process.env)) {
            // The hook variables belong to terminal sessions; a chat reports through its own stream.
            if (value !== undefined && !key.startsWith('RUIMTE_HOOK_')) {
                this.env[key] = value;
            }
        }
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        return () => {
            if (this.sinks.get(clientId) === sink) {
                this.sinks.delete(clientId);
            }
        };
    }

    /* Registers a chat; nothing is spawned until the first message. An existing chat answers its current info. */
    async create(payload: ChatCreatePayload): Promise<ChatInfo> {
        const existing = this.chats.get(payload.chatId);
        if (existing) {
            return existing.info;
        }
        const stored = await this.store?.read(payload.chatId);
        const info: ChatInfo = stored?.info
            ? { ...stored.info, running: false, status: 'idle' }
            : {
                  chatId: payload.chatId,
                  cwd: payload.cwd ?? this.env.HOME ?? homedir(),
                  agentSessionId: payload.resume ?? null,
                  model: null,
                  status: 'idle',
                  running: false,
                  usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
                  createdAt: Date.now()
              };
        const items = stored?.items.map(settle) ?? [];
        const session = new ChatSession({
            info,
            items,
            command: this.command,
            env: this.env,
            model: payload.model,
            emit: (event) => this.emit(payload.chatId, event),
            persist: () => this.persist(payload.chatId)
        });
        this.chats.set(session.id, session);
        return session.info;
    }

    attach(chatId: string, clientId: string): { info: ChatInfo; items: ChatItem[] } {
        const session = this.require(chatId);
        let clients = this.attached.get(chatId);
        if (!clients) {
            clients = new Set();
            this.attached.set(chatId, clients);
        }
        clients.add(clientId);
        return session.thread.snapshot();
    }

    detach(chatId: string, clientId: string): void {
        this.attached.get(chatId)?.delete(clientId);
    }

    detachAll(clientId: string): void {
        for (const clients of this.attached.values()) {
            clients.delete(clientId);
        }
    }

    send(chatId: string, text: string): void {
        this.require(chatId).send(text);
    }

    cancel(chatId: string): void {
        this.require(chatId).cancel();
    }

    approve(chatId: string, requestId: string, decision: 'allow' | 'deny', message?: string): void {
        if (!this.require(chatId).approve(requestId, decision, message)) {
            throw new ChatError('approval-not-found', `Nothing waits for approval ${requestId}`);
        }
    }

    async kill(chatId: string): Promise<void> {
        const session = this.require(chatId);
        session.dispose();
        this.chats.delete(chatId);
        this.attached.delete(chatId);
        await this.store?.delete(chatId);
    }

    list(): ChatInfo[] {
        return [...this.chats.values()].map((session) => session.info);
    }

    get(chatId: string): ChatSession | undefined {
        return this.chats.get(chatId);
    }

    /* Ends every CLI and writes every thread; used when the daemon goes down. */
    async shutdown(): Promise<void> {
        for (const session of this.chats.values()) {
            session.stop();
        }
        await Promise.all([...this.chats.keys()].map((chatId) => this.persistNow(chatId)));
    }

    private persist(chatId: string): void {
        void this.persistNow(chatId).catch((e) => console.error(`Chat record for ${chatId} failed`, e));
    }

    private async persistNow(chatId: string): Promise<void> {
        const session = this.chats.get(chatId);
        if (!session || !this.store) {
            return;
        }
        const { info, items } = session.thread.snapshot();
        await this.store.write(chatId, info, items);
    }

    private emit(chatId: string, event: ChatEvent): void {
        const clients = this.attached.get(chatId);
        if (!clients) {
            return;
        }
        for (const clientId of clients) {
            this.sinks.get(clientId)?.({ event: 'chat.event', payload: { chatId, event } });
        }
    }

    private require(chatId: string): ChatSession {
        const session = this.chats.get(chatId);
        if (!session) {
            throw new ChatError('chat-not-found', `No chat ${chatId}`);
        }
        return session;
    }
}

// A thread read from disk cannot still be streaming or waiting; whatever was open is closed.
const settle = (item: ChatItem): ChatItem => {
    if (item.kind === 'assistant' && item.streaming) {
        return { ...item, streaming: false };
    }
    if (item.kind === 'approval' && item.decision === 'pending') {
        return { ...item, decision: 'cancelled' };
    }
    if (item.kind === 'tool' && item.state === 'running') {
        return { ...item, state: 'error' };
    }
    return item;
};

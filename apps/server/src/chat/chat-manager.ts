import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import type { ChatConfigurePayload, ChatCreatePayload, ChatEvent, ChatInfo, ChatItem } from '@ruimte/contracts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { ChatSession } from './chat-session.ts';
import type { ChatStore } from './chat-store.ts';

export type ChatErrorCode = 'chat-not-found' | 'chat-busy' | 'request-not-found' | 'provider-unsupported';

export class ChatError extends Error {
    readonly code: ChatErrorCode;

    constructor(code: ChatErrorCode, message: string) {
        super(message);
        this.name = 'ChatError';
        this.code = code;
    }
}

export interface ChatManagerOptions {
    providers: ProviderRegistry;
    store?: ChatStore;
    env?: Record<string, string | undefined>;
    // The CLI to run; a test points this at a script that speaks the same protocol.
    command?: string[];
    // Where an agent reads its linked context, and whether it has any.
    contextUrl?: string;
    hasContext?: (chatId: string) => boolean;
    // Put in front of PATH, so `ruimte-context` is there for the CLI's shell.
    binDir?: string;
}

export class ChatManager {
    private readonly providers: ProviderRegistry;
    private readonly store: ChatStore | null;
    private readonly env: Record<string, string>;
    private readonly command: string[];
    private readonly chats = new Map<string, ChatSession>();
    private readonly sinks = new Map<string, SessionSink>();
    private readonly attached = new Map<string, Set<string>>();
    private readonly tokens = new Map<string, string>();
    private readonly contextUrl: string | null;
    private readonly hasContext: (chatId: string) => boolean;

    constructor(options: ChatManagerOptions) {
        this.providers = options.providers;
        this.store = options.store ?? null;
        this.command = options.command ?? ['claude'];
        this.contextUrl = options.contextUrl ?? null;
        this.hasContext = options.hasContext ?? (() => false);
        this.env = {};
        for (const [key, value] of Object.entries(options.env ?? process.env)) {
            // The hook variables belong to terminal sessions; a chat reports through its own stream.
            if (value !== undefined && !key.startsWith('RUIMTE_HOOK_')) {
                this.env[key] = value;
            }
        }
        if (options.binDir) {
            this.env.PATH = this.env.PATH ? `${options.binDir}:${this.env.PATH}` : options.binDir;
        }
    }

    /* The chat a context token belongs to. */
    chatIdForToken(token: string): string | null {
        return this.tokens.get(token) ?? null;
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
        if (payload.provider && payload.provider !== 'claude') {
            throw new ChatError('provider-unsupported', `${payload.provider} has no chat backend yet`);
        }
        const catalog = this.providers.claude;
        const stored = await this.store?.read(payload.chatId);
        const selection = catalog.normalize(stored?.info.selection ?? payload.selection);
        const info: ChatInfo = stored?.info
            ? { ...stored.info, selection, running: false, status: 'idle', activeTurnId: null }
            : {
                  chatId: payload.chatId,
                  provider: 'claude',
                  cwd: payload.cwd ?? this.env.HOME ?? homedir(),
                  agentSessionId: payload.resume ?? null,
                  model: null,
                  selection,
                  runtimeMode: payload.runtimeMode ?? 'full-access',
                  interactionMode: payload.interactionMode ?? 'default',
                  status: 'idle',
                  running: false,
                  activeTurnId: null,
                  slashCommands: [],
                  usage: { contextTokens: 0, contextWindow: catalog.contextWindowFor(selection), costUsd: 0, turns: 0 },
                  createdAt: Date.now()
              };
        const items = stored?.items.map(settle) ?? [];
        const token = randomBytes(24).toString('base64url');
        this.tokens.set(token, payload.chatId);
        const session = new ChatSession({
            info,
            items,
            command: this.command,
            env: this.contextUrl ? { ...this.env, RUIMTE_CONTEXT_URL: this.contextUrl, RUIMTE_CONTEXT_TOKEN: token } : this.env,
            catalog,
            hasContext: () => this.hasContext(payload.chatId),
            emit: (event) => this.emit(payload.chatId, event),
            persist: () => this.persist(payload.chatId)
        });
        this.chats.set(session.id, session);
        return session.info;
    }

    configure(payload: ChatConfigurePayload): ChatInfo {
        return this.require(payload.chatId).configure(payload);
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
        const session = this.require(chatId);
        if (session.info.activeTurnId) {
            throw new ChatError('chat-busy', `Chat ${chatId} is still working on the previous message`);
        }
        session.send(text);
    }

    compact(chatId: string): void {
        const session = this.require(chatId);
        if (session.info.activeTurnId) {
            throw new ChatError('chat-busy', `Chat ${chatId} is still working on the previous message`);
        }
        session.compact();
    }

    cancel(chatId: string): void {
        this.require(chatId).cancel();
    }

    approve(chatId: string, requestId: string, decision: 'allow' | 'allow-always' | 'deny', message?: string): void {
        if (!this.require(chatId).approve(requestId, decision, message)) {
            throw new ChatError('request-not-found', `Nothing waits for approval ${requestId}`);
        }
    }

    answer(chatId: string, requestId: string, answers: Record<string, string>): void {
        if (!this.require(chatId).answer(requestId, answers)) {
            throw new ChatError('request-not-found', `No question waits under ${requestId}`);
        }
    }

    async kill(chatId: string): Promise<void> {
        const session = this.require(chatId);
        session.dispose();
        this.chats.delete(chatId);
        this.attached.delete(chatId);
        for (const [token, id] of this.tokens) {
            if (id === chatId) {
                this.tokens.delete(token);
            }
        }
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
    if (item.kind === 'question' && item.state === 'pending') {
        return { ...item, state: 'cancelled' };
    }
    if (item.kind === 'tool' && item.state === 'running') {
        return { ...item, state: 'error' };
    }
    if (item.kind === 'turn' && item.state === 'running') {
        return { ...item, state: 'error', endedAt: item.endedAt ?? item.createdAt };
    }
    return item;
};

import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import type {
    AgentKind,
    ChatAttachment,
    ChatAttachmentUpload,
    ChatCheckpointDiff,
    ChatConfigurePayload,
    ChatCreatePayload,
    ChatEvent,
    ChatInfo,
    ChatItem,
    ChatSkill,
    ContextSource
} from '@ruimte/contracts';
import type { CheckpointService } from '../git/checkpoints.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { SkillIndex } from '../skills/skills.ts';
import type { AttachmentStore } from './attachment-store.ts';
import { ChatSession, type ChatSendExtras } from './chat-session.ts';
import type { ChatStore } from './chat-store.ts';
import { ChatError } from './errors.ts';
interface ChatManagerOptions {
    providers: ProviderRegistry;
    store?: ChatStore;
    // Takes a git tree per turn; without it a turn has no checkpoint and the card falls back to the CLI's own changes.
    checkpoints?: CheckpointService;
    env?: Record<string, string | undefined>;
    // The CLIs to run, when they are not the ones the providers name; a test points these at fakes.
    command?: string[];
    // Where an agent reads its linked context, and whether it has any.
    contextUrl?: string;
    hasContext?: (chatId: string) => boolean;
    // The sources themselves, so a chat can tell its agent what came and went between turns.
    contextSources?: (chatId: string) => ContextSource[];
    // Put in front of PATH, so `ruimte-context` is there for the CLI's shell.
    binDir?: string;
    codexCommand?: string[];
    // Where the skill folders are looked for; a test points it at a temporary tree.
    skills?: SkillIndex;
    // Where the files people attach are written.
    attachments: AttachmentStore;
}

// Above this the record is big enough that rewriting it on every tool call costs more than it saves.
const DEBOUNCE_ABOVE_BYTES = 256 * 1024;
const DEBOUNCE_MS = 500;

export class ChatManager {
    private readonly providers: ProviderRegistry;
    private readonly store: ChatStore | null;
    private readonly checkpoints: CheckpointService | null;
    private readonly skillIndex: SkillIndex;
    private readonly attachments: AttachmentStore;
    private readonly env: Record<string, string>;
    private readonly commands: Partial<Record<AgentKind, string[]>>;
    private readonly chats = new Map<string, ChatSession>();
    private readonly sinks = new Map<string, SessionSink>();
    private readonly attached = new Map<string, Set<string>>();
    private readonly tokens = new Map<string, string>();
    // How big each record was the last time it went to disk, and the writes waiting for a big one.
    private readonly sizes = new Map<string, number>();
    private readonly waiting = new Map<string, ReturnType<typeof setTimeout>>();
    // The write in flight per chat, so the next one queues behind it instead of racing it.
    private readonly writes = new Map<string, Promise<void>>();
    private readonly contextUrl: string | null;
    private readonly hasContext: (chatId: string) => boolean;
    private readonly contextSources: (chatId: string) => ContextSource[];

    constructor(options: ChatManagerOptions) {
        this.providers = options.providers;
        this.store = options.store ?? null;
        this.checkpoints = options.checkpoints ?? null;
        this.skillIndex = options.skills ?? new SkillIndex();
        this.attachments = options.attachments;
        this.contextUrl = options.contextUrl ?? null;
        this.hasContext = options.hasContext ?? (() => false);
        this.contextSources = options.contextSources ?? (() => []);
        this.commands = {
            ...(options.command ? { claude: options.command } : {}),
            ...(options.codexCommand ? { codex: options.codexCommand } : {})
        };
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
        const stored = await this.store?.read(payload.chatId);
        // A thread on disk keeps its provider; the selection it stored only makes sense in that catalog.
        const kind = stored?.info.provider ?? payload.provider ?? 'claude';
        const provider = this.providers.get(kind);
        const catalog = provider.catalog;
        const selection = catalog.normalize(stored?.info.selection ?? payload.selection);
        const info: ChatInfo = stored?.info
            ? { ...stored.info, selection, running: false, status: 'idle', activeTurnId: null }
            : {
                  chatId: payload.chatId,
                  provider: kind,
                  cwd: payload.cwd ?? this.env.HOME ?? homedir(),
                  agentSessionId: payload.resume ?? null,
                  model: null,
                  selection,
                  runtimeMode: payload.runtimeMode ?? 'full-access',
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
            provider,
            command: this.commands[kind] ?? provider.command,
            env: this.contextUrl ? { ...this.env, RUIMTE_CONTEXT_URL: this.contextUrl, RUIMTE_CONTEXT_TOKEN: token } : this.env,
            hasContext: () => this.hasContext(payload.chatId),
            contextSources: () => this.contextSources(payload.chatId),
            ...(this.checkpoints ? { checkpoints: this.checkpoints } : {}),
            emit: (event: ChatEvent) => this.emit(payload.chatId, event),
            persist: () => this.persist(payload.chatId),
            persistSoon: () => this.persistSoon(payload.chatId)
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

    /*
     * Answers whether the message went into the chat's queue because a turn was still running. The
     * uploads become files first, so a queued message carries paths and never its own bytes.
     */
    async send(chatId: string, text: string, extras: ChatSendExtras = {}, uploads: ChatAttachmentUpload[] = []): Promise<{ queued: boolean }> {
        const session = this.require(chatId);
        const attachments = await Promise.all(uploads.map((upload) => this.attachments.save(chatId, upload)));
        return session.send(text, { ...extras, ...(attachments.length > 0 ? { attachments } : {}) });
    }

    /* The file behind `/attachments/<chatId>/<id>`: what this chat's thread or queue says it is. */
    attachment(chatId: string, id: string): ChatAttachment | null {
        const session = this.chats.get(chatId);
        if (!session) {
            return null;
        }
        for (const item of session.thread.list()) {
            const found = item.kind === 'user' ? item.attachments?.find((attachment) => attachment.id === id) : undefined;
            if (found) {
                return found;
            }
        }
        for (const message of session.info.queue ?? []) {
            const found = message.attachments?.find((attachment) => attachment.id === id);
            if (found) {
                return found;
            }
        }
        return null;
    }

    unqueue(chatId: string, messageId: string): void {
        if (!this.require(chatId).unqueue(messageId)) {
            throw new ChatError('request-not-found', `No queued message ${messageId} in chat ${chatId}`);
        }
    }

    sendNow(chatId: string, messageId: string): void {
        if (!this.require(chatId).sendNow(messageId)) {
            throw new ChatError('request-not-found', `No queued message ${messageId} in chat ${chatId}`);
        }
    }

    /* What the chat's CLI would run as a skill, for the composer's `$` picker. */
    skills(chatId: string): Promise<ChatSkill[]> {
        const session = this.require(chatId);
        return session.skills(() => this.skillIndex.list(session.info.provider, session.info.cwd));
    }

    compact(chatId: string): void {
        const session = this.require(chatId);
        if (session.busy) {
            throw new ChatError('chat-busy', `Chat ${chatId} is still working on the previous message`);
        }
        session.compact();
    }

    cancel(chatId: string): void {
        this.require(chatId).cancel();
    }

    /* What a turn changed against the tree it started from; null when it has no checkpoint. */
    turnDiff(chatId: string, turnId: string): Promise<ChatCheckpointDiff | null> {
        return this.require(chatId).turnDiff(turnId);
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

    dismiss(chatId: string, itemId: string): void {
        if (!this.require(chatId).dismiss(itemId)) {
            throw new ChatError('request-not-found', `No question to dismiss under ${itemId}`);
        }
    }

    async kill(chatId: string): Promise<void> {
        const session = this.require(chatId);
        session.dispose();
        this.cancelWaiting(chatId);
        this.sizes.delete(chatId);
        this.writes.delete(chatId);
        this.chats.delete(chatId);
        this.attached.delete(chatId);
        for (const [token, id] of this.tokens) {
            if (id === chatId) {
                this.tokens.delete(token);
            }
        }
        await Promise.all([this.store?.delete(chatId), this.attachments.removeAll(chatId)]);
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
        for (const chatId of this.chats.keys()) {
            this.cancelWaiting(chatId);
        }
        await Promise.all([...this.chats.keys()].map((chatId) => this.persistNow(chatId)));
    }

    /*
     * Every thread to disk without awaiting anything. A `bun --watch` reload restarts the module while
     * the signal handler is still on its first await, so the threads go down before that first await.
     */
    persistAllSync(): void {
        if (!this.store) {
            return;
        }
        for (const [chatId, session] of this.chats) {
            this.cancelWaiting(chatId);
            const { info, items } = session.thread.snapshot();
            try {
                this.store.writeSync(chatId, info, items);
            } catch (e) {
                console.error(`Chat record for ${chatId} failed`, e);
            }
        }
    }

    private persist(chatId: string): void {
        this.cancelWaiting(chatId);
        void this.persistNow(chatId).catch((e) => console.error(`Chat record for ${chatId} failed`, e));
    }

    /* A write that may wait: a long thread is not rewritten for every tool call that settles. */
    private persistSoon(chatId: string): void {
        if ((this.sizes.get(chatId) ?? 0) < DEBOUNCE_ABOVE_BYTES) {
            this.persist(chatId);
            return;
        }
        if (this.waiting.has(chatId)) {
            return;
        }
        const timer = setTimeout(() => {
            this.waiting.delete(chatId);
            this.persist(chatId);
        }, DEBOUNCE_MS);
        // A pending write must never be the reason the process stays up.
        timer.unref?.();
        this.waiting.set(chatId, timer);
    }

    private cancelWaiting(chatId: string): void {
        const timer = this.waiting.get(chatId);
        if (timer) {
            clearTimeout(timer);
            this.waiting.delete(chatId);
        }
    }

    /*
     * One write at a time per chat. Two records in flight together rename in whichever order the
     * file system finishes them, so an older snapshot could land last and undo what just happened.
     */
    private persistNow(chatId: string): Promise<void> {
        const next = (this.writes.get(chatId) ?? Promise.resolve()).then(async () => {
            const session = this.chats.get(chatId);
            if (!session || !this.store) {
                return;
            }
            const { info, items } = session.thread.snapshot();
            this.sizes.set(chatId, await this.store.write(chatId, info, items));
        });
        this.writes.set(
            chatId,
            next.catch(() => undefined)
        );
        return next;
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

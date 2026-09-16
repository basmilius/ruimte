import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import type {
    AgentKind,
    ChatAttachment,
    ChatAttachResult,
    ChatHistoryResult,
    ChatAttachmentUpload,
    ChatCheckpointDiff,
    ChatConfigurePayload,
    ChatCreatePayload,
    ChatEvent,
    ChatInfo,
    ChatItem,
    ChatSkill,
    ChatSubagentPayload,
    ChatSubagentResult,
    ContextSource
} from '@ruimte/contracts';
import type { CheckpointService } from '../git/checkpoints.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { SkillIndex } from '../skills/skills.ts';
import type { LimitsUpdate } from '../usage/limits/normalize.ts';
import type { AttachmentStore } from './attachment-store.ts';
import type { SpawnChatProcess } from './chat-process.ts';
import { ChatSession, type ChatSendExtras, type ResumeDecision } from './chat-session.ts';
import { ChatLog, COMPACT_ABOVE_BYTES } from './chat-log.ts';
import type { ChatTitleInput } from './chat-title.ts';
import type { ChatRecord, ChatStore } from './chat-store.ts';
import { ComposerPreferences } from './composer-preferences.ts';
import { DeltaCoalescer } from './delta-coalescer.ts';
import { ChatError } from './errors.ts';
import { SubagentReader, type SubagentReaderOptions } from './subagent-reader.ts';
import { errorText } from '../error-text.ts';
import { usageRoots } from '../usage/roots.ts';

/* A turn that was running when the daemon went down, and the attempt that would take it up again. */
export interface InterruptedRun {
    chatId: string;
    turnId: string;
    attempt: number;
}

// One process worked on the turn and one more may take it up after a restart; a loop of resumes could redo a command forever.
const MAX_ATTEMPTS = 2;

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
    // What another node left for this chat, taken once and put in front of the next prompt.
    messages?: (chatId: string) => string[];
    // The prompt an agent node was made with, taken once; it becomes the thread's first message.
    firstPrompt?: (chatId: string) => Promise<string | null>;
    // Put in front of PATH, so `ruimte-context` is there for the CLI's shell.
    binDir?: string;
    codexCommand?: string[];
    // How a CLI is started; a test runs a fake in the same process instead of spawning one.
    spawn?: SpawnChatProcess;
    // Where the skill folders are looked for; a test points it at a temporary tree.
    skills?: SkillIndex;
    // Where the files people attach are written.
    attachments: AttachmentStore;
    // What a running turn says about the plan its CLI runs on; the usage monitor takes it from here.
    onLimits?: (update: LimitsUpdate) => void;
    // Where Claude Code's own name for a session is read; the other CLIs write none down.
    claudeTitles?: { forSession(agentSessionId: string): Promise<string | null> };
    // A name for a Codex chat, asked of a one-shot CLI: its app-server names no thread on its own.
    nameChat?: (provider: AgentKind, input: ChatTitleInput) => Promise<string | null>;
    // Where a subagent's whole conversation is read and how its growth is noticed; a test hands in fakes.
    subagents?: Partial<Pick<SubagentReaderOptions, 'claudeProjectsDir' | 'seams' | 'now' | 'listOnce'>>;
    /*
     * Asked when a chat is loaded with a turn that could be resumed: true once the resume is owed
     * (written to the outbox), and the turn stays running. False means no project holds the chat; then, or without it,
     * the turn ends aborted with a note that says why.
     */
    onInterruptedRun?: (run: InterruptedRun) => Promise<boolean>;
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
    private readonly onLimits: ((update: LimitsUpdate) => void) | null;
    private readonly env: Record<string, string>;
    private readonly commands: Partial<Record<AgentKind, string[]>>;
    private readonly spawn: SpawnChatProcess | null;
    private readonly chats = new Map<string, ChatSession>();
    private readonly creating = new Map<string, Promise<ChatInfo>>();
    private readonly sinks = new Map<string, SessionSink>();
    private readonly attached = new Map<string, Set<string>>();
    private readonly coalescers = new Map<string, DeltaCoalescer>();
    private readonly logs = new Map<string, ChatLog>();
    private readonly tokens = new Map<string, string>();
    // How big each record was the last time it went to disk, and the writes waiting for a big one.
    private readonly sizes = new Map<string, number>();
    private readonly waiting = new Map<string, ReturnType<typeof setTimeout>>();
    // The write in flight per chat, so the next one queues behind it instead of racing it.
    private readonly writes = new Map<string, Promise<void>>();
    // When each chat last said anything, which is what a chat has instead of a hook event.
    private readonly activity = new Map<string, number>();
    private readonly contextUrl: string | null;
    private readonly hasContext: (chatId: string) => boolean;
    private readonly contextSources: (chatId: string) => ContextSource[];
    private readonly messages: (chatId: string) => string[];
    private readonly firstPrompt: (chatId: string) => Promise<string | null>;
    private readonly claudeTitles: ChatManagerOptions['claudeTitles'] | null;
    private readonly nameChat: ChatManagerOptions['nameChat'] | null;
    private readonly subagents: SubagentReader;
    private readonly onInterruptedRun: ChatManagerOptions['onInterruptedRun'] | null;

    constructor(options: ChatManagerOptions) {
        this.onInterruptedRun = options.onInterruptedRun ?? null;
        this.providers = options.providers;
        this.claudeTitles = options.claudeTitles ?? null;
        this.nameChat = options.nameChat ?? null;
        this.store = options.store ?? null;
        this.checkpoints = options.checkpoints ?? null;
        this.skillIndex = options.skills ?? new SkillIndex();
        this.attachments = options.attachments;
        this.onLimits = options.onLimits ?? null;
        this.contextUrl = options.contextUrl ?? null;
        this.hasContext = options.hasContext ?? (() => false);
        this.contextSources = options.contextSources ?? (() => []);
        this.messages = options.messages ?? (() => []);
        this.firstPrompt = options.firstPrompt ?? (() => Promise.resolve(null));
        this.commands = {
            ...(options.command ? { claude: options.command } : {}),
            ...(options.codexCommand ? { codex: options.codexCommand } : {})
        };
        this.spawn = options.spawn ?? null;
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
        this.subagents = new SubagentReader({
            claudeProjectsDir: usageRoots(options.env ?? process.env).find((root) => root.provider === 'claude')?.path ?? '',
            ...options.subagents,
            chat: (chatId) => {
                const session = this.chats.get(chatId);
                return session
                    ? {
                          info: session.info,
                          running: session.running,
                          items: () => session.thread.list(),
                          listThreadItems: (params) => session.listThreadItems(params),
                          noteNative: (toolUseId, native) => session.noteSubagentNative(toolUseId, native)
                      }
                    : null;
            },
            codexProcess: (info) => ({
                command: this.commands.codex ?? this.providers.get('codex').command,
                cwd: info.cwd,
                env: this.env,
                ...(this.spawn ? { spawn: this.spawn } : {})
            }),
            notify: (clientId, event) => this.sinks.get(clientId)?.({ event: 'chat.subagentChanged', payload: event })
        });
    }

    /* The chat a context token belongs to. */
    chatIdForToken(token: string): string | null {
        return this.tokens.get(token) ?? null;
    }

    private readonly observers = new Set<SessionSink>();
    readonly composerPreferences = new ComposerPreferences();

    observe(sink: SessionSink): () => void {
        this.observers.add(sink);
        return () => {
            this.observers.delete(sink);
        };
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        return () => {
            if (this.sinks.get(clientId) === sink) {
                this.sinks.delete(clientId);
                this.composerPreferences.forget(clientId);
            }
        };
    }

    /* Registers a chat; nothing is spawned until the first message. An existing chat answers its current info. */
    create(payload: ChatCreatePayload): Promise<ChatInfo> {
        // A create in flight has the chat in the map before its first prompt is sent, so a second caller waits for all of it.
        const inFlight = this.creating.get(payload.chatId);
        if (inFlight) {
            return inFlight;
        }
        const existing = this.chats.get(payload.chatId);
        if (existing) {
            return Promise.resolve(existing.info);
        }
        const created = this.createNow(payload).finally(() => this.creating.delete(payload.chatId));
        this.creating.set(payload.chatId, created);
        return created;
    }

    private async createNow(payload: ChatCreatePayload): Promise<ChatInfo> {
        const stored = await this.store?.read(payload.chatId);
        // A thread on disk keeps its provider; the selection it stored only makes sense in that catalog.
        const kind = stored?.info.provider ?? payload.provider ?? 'claude';
        const provider = this.providers.get(kind);
        const catalog = provider.catalog;
        const selection = catalog.normalize(stored?.info.selection ?? payload.selection);
        const info: ChatInfo = stored?.info
            ? stored.info
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
        const resume: ResumeDecision = stored ? await this.owedResume(payload.chatId, stored) : { resumeTurnId: null, reason: null };
        const token = randomBytes(24).toString('base64url');
        this.tokens.set(token, payload.chatId);
        const claudeTitles = this.claudeTitles;
        const nameChat = this.nameChat;
        this.logs.set(payload.chatId, await this.openLog(payload.chatId, stored ?? null));
        const session = new ChatSession({
            info,
            items: stored?.items ?? [],
            provider,
            command: this.commands[kind] ?? provider.command,
            ...(this.spawn ? { spawn: this.spawn } : {}),
            env: this.contextUrl ? { ...this.env, RUIMTE_CONTEXT_URL: this.contextUrl, RUIMTE_CONTEXT_TOKEN: token } : this.env,
            hasContext: () => this.hasContext(payload.chatId),
            contextSources: () => this.contextSources(payload.chatId),
            messages: () => this.messages(payload.chatId),
            ...(this.checkpoints ? { checkpoints: this.checkpoints } : {}),
            emit: (event: ChatEvent) => this.emit(payload.chatId, event),
            ...(this.onLimits ? { onLimits: this.onLimits } : {}),
            persist: () => this.persist(payload.chatId),
            persistSoon: () => this.persistSoon(payload.chatId),
            ...(kind === 'claude' && claudeTitles ? { readTitle: (agentSessionId: string) => claudeTitles.forSession(agentSessionId) } : {}),
            ...(kind === 'codex' && nameChat ? { nameThread: (input: ChatTitleInput) => nameChat(kind, input) } : {})
        });
        this.chats.set(session.id, session);
        if (stored) {
            session.settleStored(selection, resume);
        }
        // Sent before the info goes back, so the client's attach already carries it: a prompt an
        // agent was made with has to read as the first message of the thread, not as a turn out of
        // nowhere. The send is what spawns the process, which is the CLI's own rule for a chat.
        const prompt = await this.firstPrompt(payload.chatId);
        if (prompt !== null) {
            try {
                session.send(prompt);
            } catch (e) {
                // A CLI that will not start must not take chat.create down with it: the node is there either way.
                console.error(`The first prompt of chat ${payload.chatId} failed:`, errorText(e));
            }
        }
        return session.info;
    }

    configure(payload: ChatConfigurePayload): ChatInfo {
        return this.require(payload.chatId).configure(payload);
    }

    /*
     * With `since` a client that was here a moment ago gets only what came after it, when the log still
     * holds all of that; otherwise the whole thread, or its newest page with `historyLimit`.
     */
    attach(chatId: string, clientId: string, historyLimit?: number, since?: number): ChatAttachResult {
        const session = this.require(chatId);
        let clients = this.attached.get(chatId);
        if (!clients) {
            clients = new Set();
            this.attached.set(chatId, clients);
        }
        // The snapshot already holds the text of a delta that is waiting, so it goes out before this
        // client is on the list: the text is either in the snapshot or in the stream, never both.
        this.coalescers.get(chatId)?.flush();
        clients.add(clientId);
        const log = this.logs.get(chatId)!;
        const events = since === undefined ? null : log.after(since);
        if (events !== null) {
            return { info: session.info, items: [], events, seq: log.seq };
        }
        return historyLimit === undefined
            ? { ...session.thread.snapshot(), seq: log.seq }
            : { info: session.info, ...session.thread.history(historyLimit), pending: session.thread.pending(), seq: log.seq };
    }

    history(chatId: string, cursor: string, limit?: number): ChatHistoryResult {
        const session = this.require(chatId);
        this.coalescers.get(chatId)?.flush();
        return session.thread.history(limit, cursor);
    }

    detach(chatId: string, clientId: string): void {
        this.coalescers.get(chatId)?.flush();
        this.attached.get(chatId)?.delete(clientId);
    }

    detachAll(clientId: string): void {
        for (const [chatId, clients] of this.attached) {
            if (clients.has(clientId)) {
                this.coalescers.get(chatId)?.flush();
                clients.delete(clientId);
            }
        }
        this.subagents.releaseClient(clientId);
    }

    /*
     * A page of a subagent's own conversation. Letting go comes before the read, so a panel that closes
     * on a conversation that is gone still lets go; holding comes after it, so a hold is only ever on
     * something that was found.
     */
    async subagent(clientId: string, payload: ChatSubagentPayload): Promise<ChatSubagentResult> {
        if (payload.watch === false) {
            this.subagents.release(clientId, payload.chatId, payload.toolUseId);
        }
        const result = await this.subagents.read(payload.chatId, payload.toolUseId, payload.cursor, payload.limit);
        if (payload.watch === true) {
            this.subagents.hold(clientId, payload.chatId, payload.toolUseId);
        }
        return result;
    }

    /* The whole conversation of a subagent, for an agent that reads it as text. */
    subagentItems(chatId: string, toolUseId: string): Promise<ChatItem[]> {
        return this.subagents.readAll(chatId, toolUseId);
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

    /* Empties the thread and drops the CLI's session; `force` stops a turn that is in the way. */
    async clear(chatId: string, force = false): Promise<void> {
        const session = this.require(chatId);
        session.clear(force);
        // A debounced write still waiting holds the old thread and must not land after the empty one.
        this.cancelWaiting(chatId);
        // Folded right away: every line before the reset describes a thread that is gone.
        await Promise.all([this.persistNow(chatId, true), this.attachments.removeAll(chatId)]);
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
        await this.creating.get(chatId)?.catch(() => undefined);
        const session = this.require(chatId);
        session.dispose();
        this.subagents.releaseChat(chatId);
        this.coalescers.get(chatId)?.dispose();
        this.coalescers.delete(chatId);
        this.logs.get(chatId)?.close();
        this.logs.delete(chatId);
        this.cancelWaiting(chatId);
        this.sizes.delete(chatId);
        this.writes.delete(chatId);
        this.activity.delete(chatId);
        this.chats.delete(chatId);
        this.attached.delete(chatId);
        for (const [token, id] of this.tokens) {
            if (id === chatId) {
                this.tokens.delete(token);
            }
        }
        await Promise.all([this.store?.delete(chatId), this.attachments.removeAll(chatId)]);
    }

    /* The chats with a CLI process, for the process monitor. */
    processTargets(): { id: string; pid: number; provider: AgentKind; status: ChatInfo['status']; updatedAt: number }[] {
        const targets = [];
        for (const [id, session] of this.chats) {
            const pid = session.pid;
            if (pid !== null) {
                targets.push({ id, pid, provider: session.info.provider, status: session.info.status, updatedAt: this.activity.get(id) ?? 0 });
            }
        }
        return targets;
    }

    list(): ChatInfo[] {
        return [...this.chats.values()].map((session) => session.info);
    }

    get(chatId: string): ChatSession | undefined {
        return this.chats.get(chatId);
    }

    /*
     * Takes up a turn the daemon went down in, under the same turn with the next attempt. Loads the
     * chat when nobody has yet, which asks `onInterruptedRun` again and finds the resume already owed.
     * Throws when the CLI will not start, so the outbox tries again.
     */
    async resumeRun(chatId: string, turnId: string, attempt: number): Promise<void> {
        await this.creating.get(chatId)?.catch(() => undefined);
        if (!this.chats.has(chatId)) {
            if (!(await this.store?.has(chatId))) {
                return;
            }
            await this.create({ chatId });
        }
        await this.chats.get(chatId)?.resume(turnId, attempt);
    }

    /* A resume that never came about: the turn ends as aborted, with the reason in the thread. */
    abandonRun(chatId: string, turnId: string, reason: string): void {
        this.chats.get(chatId)?.abandon(turnId, reason);
    }

    /*
     * Loads every stored chat whose turn was running when the daemon went down, so the rule in `create`
     * decides whether it is resumed without waiting for a client to open it. One file at a time: it
     * runs beside the daemon answering, not in front of it.
     */
    async recoverInterrupted(): Promise<void> {
        if (!this.store) {
            return;
        }
        for (const chatId of await this.store.list()) {
            if (this.chats.has(chatId) || this.creating.has(chatId)) {
                continue;
            }
            const record = await this.store.read(chatId).catch(() => null);
            if (record !== null && interruptedTurn(record) !== null) {
                await this.create({ chatId }).catch((e: unknown) => console.error(`Loading chat ${chatId} after a restart failed:`, errorText(e)));
            }
        }
    }

    /* Ends every CLI and writes every thread; used when the daemon goes down. */
    async shutdown(): Promise<void> {
        for (const session of this.chats.values()) {
            session.freeze();
        }
        for (const chatId of this.chats.keys()) {
            this.cancelWaiting(chatId);
        }
        await Promise.all([...this.chats.keys()].map((chatId) => this.persistNow(chatId, true)));
    }

    /*
     * Every thread to disk without awaiting anything. A `bun --watch` reload restarts the module while
     * the signal handler is still on its first await, so the threads go down before that first await.
     */
    persistAllSync(): void {
        if (!this.store) {
            return;
        }
        for (const session of this.chats.values()) {
            session.freeze();
        }
        for (const [chatId, session] of this.chats) {
            this.cancelWaiting(chatId);
            this.coalescers.get(chatId)?.flush();
            const { info, items } = session.thread.snapshot();
            const log = this.logs.get(chatId);
            // Not folded here: an older write still in flight may land after this one, and the log is what covers for it.
            try {
                this.store.writeSync(chatId, info, items, { seq: log?.seq ?? 0, resetSeq: log?.resetSeq ?? 0 });
            } catch (e) {
                console.error(`Chat record for ${chatId} failed:`, errorText(e));
            }
        }
    }

    private persist(chatId: string): void {
        this.cancelWaiting(chatId);
        void this.persistNow(chatId).catch((e) => console.error(`Chat record for ${chatId} failed:`, errorText(e)));
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
    private persistNow(chatId: string, fold = false): Promise<void> {
        const next = (this.writes.get(chatId) ?? Promise.resolve()).then(async () => {
            const session = this.chats.get(chatId);
            const log = this.logs.get(chatId);
            if (!session || !this.store || !log) {
                return;
            }
            // A delta held back is already in the thread, so it gets its seq before the snapshot says where it ends.
            this.coalescers.get(chatId)?.flush();
            const { info, items } = session.thread.snapshot();
            const at = { seq: log.seq, resetSeq: log.resetSeq };
            this.sizes.set(chatId, await this.store.write(chatId, info, items, at));
            // A chat killed while the write was out has no log left to fold.
            if (this.logs.get(chatId) === log && (fold || log.size > COMPACT_ABOVE_BYTES)) {
                log.compact(at.seq);
            }
        });
        this.writes.set(
            chatId,
            next.catch(() => undefined)
        );
        return next;
    }

    private emit(chatId: string, event: ChatEvent): void {
        this.activity.set(chatId, Date.now());
        let coalescer = this.coalescers.get(chatId);
        if (!coalescer) {
            coalescer = new DeltaCoalescer((coalesced) => this.broadcast(chatId, coalesced));
            this.coalescers.set(chatId, coalescer);
        }
        coalescer.push(event);
    }

    /* Written down before anyone hears it, so no client holds a seq the log does not. */
    private broadcast(chatId: string, event: ChatEvent): void {
        const seq = this.logs.get(chatId)?.append(event, Date.now());
        const payload = seq === undefined ? { chatId, event } : { chatId, event, seq };
        for (const sink of this.observers) {
            sink({ event: 'chat.event', payload });
        }
        const clients = this.attached.get(chatId);
        if (!clients) {
            return;
        }
        for (const clientId of clients) {
            this.sinks.get(clientId)?.({ event: 'chat.event', payload });
        }
    }

    /*
     * The stream of a chat as its files left it. A chat with no record starts its stream over, after
     * whatever seq a log left behind by a life that never wrote a snapshot handed out, with a reset
     * marked just past it: a client still holding one of those seqs gets the whole thread.
     */
    private async openLog(chatId: string, stored: ChatRecord | null): Promise<ChatLog> {
        if (!this.store) {
            return new ChatLog(null);
        }
        const path = this.store.logPath(chatId);
        if (stored) {
            return new ChatLog(path, stored);
        }
        const left = await this.store.discardLog(chatId);
        return new ChatLog(path, { seq: left, resetSeq: left === 0 ? 0 : left + 1, lines: [] });
    }

    /* The running turn of a stored chat, when it may be resumed and the resume is now owed; null otherwise. */
    /* Every reason says why in the words of the note the turn ends with, so a person can tell a skip from a failure. */
    private async owedResume(chatId: string, stored: ChatRecord): Promise<ResumeDecision> {
        const turn = interruptedTurn(stored);
        const skip = (reason: string): ResumeDecision => ({ resumeTurnId: null, reason });
        if (turn === null) {
            return { resumeTurnId: null, reason: null };
        }
        if (!this.onInterruptedRun) {
            return skip('this machine does not resume turns');
        }
        if (stored.info.agentSessionId === null) {
            return skip('the agent had not started a session to resume yet');
        }
        if ((turn.attempt ?? 1) >= MAX_ATTEMPTS) {
            return skip('it was already resumed after an earlier restart');
        }
        try {
            const owed = await this.onInterruptedRun({ chatId, turnId: turn.id, attempt: (turn.attempt ?? 1) + 1 });
            return owed ? { resumeTurnId: turn.id, reason: null } : skip('no project holds this chat any more');
        } catch (e) {
            console.error(`Owing a resume for chat ${chatId} failed:`, errorText(e));
            return skip(errorText(e));
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

const interruptedTurn = (record: { info: ChatInfo; items: ChatItem[] }): Extract<ChatItem, { kind: 'turn' }> | null => {
    const turnId = record.info.activeTurnId;
    const turn = turnId === null ? undefined : record.items.find((item) => item.id === turnId);
    return turn?.kind === 'turn' && turn.state === 'running' ? turn : null;
};

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
    ChatAttachmentUploadsSchema,
    type AgentKind,
    type ChatAttachment,
    type ChatAttachResult,
    type ChatAttachmentUpload,
    type ChatBookmark,
    type ChatCheckpointDiff,
    type ChatConfigurePayload,
    type ChatCreatePayload,
    type ChatEvent,
    type ChatHistoryResult,
    type ChatInfo,
    type ChatItem,
    type ChatQueuedMessage,
    type ChatSkill,
    type ChatSubagentPayload,
    type ChatSubagentResult,
    type ChatTurnItem,
    type ModelSelection,
    type RuntimeMode
} from '@ruimte/agent-contracts';
import { ClientSinks } from '../client-sinks.ts';
import { errorText } from '../error-text.ts';
import type { AgentEvent, AgentSink } from '../events.ts';
import { AccountError, definedEnv, isDefaultAccountOf, launchEnv, storedAccount, type AccountLaunches } from '../providers/accounts/launch.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { SkillIndex } from '../skills.ts';
import type { LimitsUpdate } from '../usage/limits/normalize.ts';
import { usageRoots } from '../usage/roots.ts';
import type { AttachmentStore } from './attachment-store.ts';
import type { BookmarkStore } from './bookmark-store.ts';
import { ChatLog, COMPACT_ABOVE_BYTES } from './chat-log.ts';
import type { SpawnChatProcess } from './chat-process.ts';
import {
    ChatSession,
    type ChatReferences,
    type ChatSendExtras,
    type LimitResumeHooks,
    type PromptNotes,
    type ResumeDecision,
    type ResumeWords,
    type TurnCheckpoints
} from './chat-session.ts';
import type { ChatRecord, ChatRecordExtras, ChatStore } from './chat-store.ts';
import type { ChatTitleInput } from './chat-title.ts';
import type { CodexProcessSpec } from './codex-thread.ts';
import type { CodexClientInfo } from './codex-transport.ts';
import { ComposerPreferences } from './composer-preferences.ts';
import { DeltaCoalescer } from './delta-coalescer.ts';
import { ChatError } from './errors.ts';
import { SubagentReader, type SubagentReaderOptions } from './subagent-reader.ts';

/* A turn that was running when the host went down, and the attempt that would take it up again. */
export interface InterruptedRun {
    chatId: string;
    turnId: string;
    attempt: number;
}

type BookmarkableItem = Extract<ChatItem, { kind: 'user' | 'assistant' }>;

/* A message a person or the agent wrote in the chat's own thread; a subagent's words belong to its row. */
const isBookmarkable = (item: ChatItem): item is BookmarkableItem =>
    item.kind === 'user' || (item.kind === 'assistant' && (item.parentToolUseId ?? null) === null);

/* The start of a message on one line; a message of only attachments is its file names. */
const excerptOf = (item: BookmarkableItem): string => {
    const files = item.kind === 'user' ? (item.attachments ?? []).map((attachment) => attachment.name).join(', ') : '';
    return (item.text.trim() === '' ? files : item.text).replace(/\s+/g, ' ').trim();
};

// One process worked on the turn and one more may take it up after a restart; a loop of resumes could redo a command forever.
const MAX_ATTEMPTS = 2;

// Above this the record is big enough that rewriting it for every small change costs more than it saves.
const DEBOUNCE_ABOVE_BYTES = 256 * 1024;
const DEBOUNCE_MS = 500;

const DEFAULT_RESUME_WORDS: ResumeWords = {
    prompt: 'The app restarted while you were working on the previous message. Continue where you left off.',
    note: 'Resumed after a restart',
    preamble: null
};

export interface ChatCoreOptions {
    providers: ProviderRegistry;
    // Where the threads are kept; without it a chat lives as long as the process.
    store?: ChatStore;
    // Takes a tree per turn; without it a turn has no checkpoint and the card falls back to the CLI's own changes.
    checkpoints?: TurnCheckpoints;
    // The environment every CLI starts in, `cliEnvironment` for one that holds nothing of another host.
    env?: Record<string, string | undefined>;
    // What the agent is told once, at the start of every process, when the host has one note for every chat.
    instructions?: string;
    // The CLIs to run, when they are not the ones the providers name; a test points these at fakes.
    command?: string[];
    codexCommand?: string[];
    // How a CLI is started; a test runs a fake in the same process instead of spawning one.
    spawn?: SpawnChatProcess;
    // How the host names itself to an app-server it opens for a question about a thread.
    codexClient?: CodexClientInfo;
    // Where the skill folders are looked for; a test points it at a temporary tree.
    skills?: SkillIndex;
    // Where the files people attach are written.
    attachments: AttachmentStore;
    bookmarks?: BookmarkStore;
    // What a running turn says about the plan its CLI runs on; the usage monitor takes it from here.
    onLimits?: (update: LimitsUpdate) => void;
    // Where Claude Code's own name for a session is read, in the projects folder of the chat's account; the other CLIs write none down.
    claudeTitles?: { forSession(agentSessionId: string, projectsDir: string): Promise<string | null> };
    // A name for a Codex chat, asked of a one-shot CLI: its app-server names no thread on its own.
    nameChat?: (provider: AgentKind, input: ChatTitleInput) => Promise<string | null>;
    // Where a subagent's whole conversation is read and how its growth is noticed; a test hands in fakes.
    subagents?: Partial<Pick<SubagentReaderOptions, 'claudeProjectsDir' | 'seams' | 'now' | 'listOnce'>>;
    /*
     * Asked when a chat is loaded with a turn that could be resumed: true once the resume is owed,
     * and the turn stays running. False, or without it, the turn ends aborted with a note that says why.
     */
    onInterruptedRun?: (run: InterruptedRun) => Promise<boolean>;
    // Where a turn that stopped on a limit is owed a resume on a clock, when the host allows it.
    limitResume?: {
        allowed(): boolean;
        now(): number;
        owe(chatId: string, turnId: string, at: number): Promise<void>;
        lapse(chatId: string): Promise<void>;
        // Whether an entry is owed for this chat now.
        owed(chatId: string): boolean;
    };
    // The accounts a chat may run under; without them every chat runs under its CLI's default account.
    accounts?: AccountLaunches;
}

/*
 * The chats of one host: a `ChatSession` per chat, its record and its log, and the clients that read
 * them. Everything here holds for any host. What a host adds (notes for the agent, rows of its own,
 * what a clear or a removal takes along) it adds by overriding the protected methods below, which
 * do nothing of their own.
 */
export class ChatCore {
    protected readonly providers: ProviderRegistry;
    protected readonly store: ChatStore | null;
    protected readonly bookmarks: BookmarkStore | null;
    protected readonly accounts: AccountLaunches | null;
    protected readonly attachments: AttachmentStore;
    protected readonly env: Record<string, string>;
    protected readonly chats = new Map<string, ChatSession>();
    protected readonly creating = new Map<string, Promise<ChatInfo>>();
    protected readonly sinks = new ClientSinks<AgentEvent>((clientId) => this.composerPreferences.forget(clientId));
    protected readonly attached = new Map<string, Set<string>>();
    protected readonly coalescers = new Map<string, DeltaCoalescer>();
    protected readonly subagents: SubagentReader;
    /* Where Claude Code keeps the projects of its default account on this machine; empty when it has none. */
    readonly claudeProjectsDir: string;
    readonly composerPreferences = new ComposerPreferences();
    private readonly checkpoints: TurnCheckpoints | null;
    private readonly instructions: string | null;
    private readonly skillIndex: SkillIndex;
    private readonly onLimits: ((update: LimitsUpdate) => void) | null;
    private readonly commands: Partial<Record<AgentKind, string[]>>;
    private readonly spawn: SpawnChatProcess | null;
    private readonly codexClient: CodexClientInfo | null;
    // What `chat.status` last said about each chat, so the broadcast is one per change and not one per info event.
    private readonly announced = new Map<string, string>();
    private readonly logs = new Map<string, ChatLog>();
    // How big each record was the last time it went to disk, and the writes waiting for a big one.
    private readonly sizes = new Map<string, number>();
    private readonly waiting = new Map<string, ReturnType<typeof setTimeout>>();
    // What the last record held that no event carries (preambles, the host's extras), as its JSON.
    private readonly unlogged = new Map<string, string>();
    // The write in flight per chat, so the next one queues behind it instead of racing it.
    private readonly writes = new Map<string, Promise<void>>();
    // When each chat last said anything, which is what a chat has instead of a hook event.
    private readonly activity = new Map<string, number>();
    private readonly observers = new Set<AgentSink>();
    private readonly claudeTitles: ChatCoreOptions['claudeTitles'] | null;
    private readonly nameChat: ChatCoreOptions['nameChat'] | null;
    private readonly onInterruptedRun: ChatCoreOptions['onInterruptedRun'] | null;
    private readonly limitResume: ChatCoreOptions['limitResume'] | null;

    constructor(options: ChatCoreOptions) {
        this.providers = options.providers;
        this.store = options.store ?? null;
        this.bookmarks = options.bookmarks ?? null;
        this.accounts = options.accounts ?? null;
        this.attachments = options.attachments;
        this.checkpoints = options.checkpoints ?? null;
        this.instructions = options.instructions ?? null;
        this.skillIndex = options.skills ?? new SkillIndex();
        this.onLimits = options.onLimits ?? null;
        this.claudeTitles = options.claudeTitles ?? null;
        this.nameChat = options.nameChat ?? null;
        this.onInterruptedRun = options.onInterruptedRun ?? null;
        this.limitResume = options.limitResume ?? null;
        this.commands = {
            ...(options.command ? { claude: options.command } : {}),
            ...(options.codexCommand ? { codex: options.codexCommand } : {})
        };
        this.spawn = options.spawn ?? null;
        this.codexClient = options.codexClient ?? null;
        this.env = definedEnv(options.env ?? process.env);
        // Only whoever reads the thread has anything to point a bookmark at, so the list goes where the thread goes.
        this.bookmarks?.listen((chatId, bookmarks) => {
            for (const clientId of this.attached.get(chatId) ?? []) {
                this.sinks.to(clientId, { event: 'chat.bookmarks', payload: { chatId, bookmarks } });
            }
        });
        this.claudeProjectsDir =
            options.subagents?.claudeProjectsDir ?? usageRoots(options.env ?? process.env).find((root) => root.provider === 'claude')?.path ?? '';
        this.subagents = new SubagentReader({
            ...options.subagents,
            claudeProjectsDir: this.claudeProjectsDir,
            claudeProjectsDirOf: (info) => this.claudeProjectsDirOf(info),
            chatInfo: async (chatId) => (await this.readChat(chatId))?.info ?? null,
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
            codexProcess: (info) => this.codexProcess(info),
            notify: (clientId, event) => this.sinks.to(clientId, { event: 'chat.subagentChanged', payload: event })
        });
    }

    /* How an app-server is started for a question about a thread of this chat, under its account, apart from any chat's own process. */
    codexProcess(info: Pick<ChatInfo, 'cwd' | 'account'>): CodexProcessSpec {
        return {
            command: this.commands.codex ?? this.providers.get('codex').command,
            cwd: info.cwd,
            env: definedEnv(launchEnv(this.accounts, 'codex', info.account, this.env)),
            ...(this.codexClient ? { client: this.codexClient } : {}),
            ...(this.spawn ? { spawn: this.spawn } : {})
        };
    }

    /* Where Claude Code keeps the projects of this chat's account; empty for an account this machine does not have. */
    claudeProjectsDirOf(info: Pick<ChatInfo, 'account'>): string {
        if (isDefaultAccountOf('claude', info.account)) {
            return this.claudeProjectsDir;
        }
        const folder = this.accounts?.transcriptFolder('claude', info.account) ?? null;
        return folder === null ? '' : join(folder, 'projects');
    }

    /* Whether a conversation of one account of this CLI can go on under the other. */
    canContinue(kind: AgentKind, from: string | undefined, to: string | undefined): boolean {
        if ((from ?? kind) === (to ?? kind)) {
            return true;
        }
        return this.accounts?.canContinue(kind, from, to) ?? false;
    }

    /* Throws for an account a CLI of this kind cannot start under on this machine. */
    requireAccount(kind: AgentKind, account: string | undefined): void {
        launchEnv(this.accounts, kind, account, this.env);
    }

    /* What a person calls an account of this CLI. */
    accountLabel(kind: AgentKind, account: string | undefined): string {
        return isDefaultAccountOf(kind, account) || account === undefined ? this.providers.get(kind).name : (this.accounts?.labelOf(account) ?? account);
    }

    /* A chat as it stands: the thread in memory, else the record on disk; null when this host has no such chat. */
    async readChat(chatId: string): Promise<{ info: ChatInfo; items: ChatItem[] } | null> {
        await this.loaded(chatId);
        const session = this.chats.get(chatId);
        if (session) {
            return session.thread.snapshot();
        }
        const stored = await this.store?.read(chatId);
        return stored ? { info: stored.info, items: stored.items } : null;
    }

    /* What a chat of this CLI starts with when nobody else says: the model named, else the newest composer pick, in that CLI's catalog. */
    startingPoint(provider: AgentKind, selection?: ModelSelection): { selection: ModelSelection; runtimeMode?: RuntimeMode; contextWindow: number | null } {
        const catalog = this.providers.get(provider).catalog;
        const preference = this.composerPreferences.for(provider);
        const normalized = catalog.normalize(selection ?? preference.selection);
        return {
            selection: normalized,
            ...(preference.runtimeMode ? { runtimeMode: preference.runtimeMode } : {}),
            contextWindow: catalog.contextWindowFor(normalized)
        };
    }

    /*
     * An observer only notes things (a record, a file) and never acts: a turn sent from inside an
     * event runs in the first chat's call stack and is gone in a crash.
     */
    observe(sink: AgentSink): () => void {
        this.observers.add(sink);
        return () => {
            this.observers.delete(sink);
        };
    }

    subscribe(clientId: string, sink: AgentSink): () => void {
        return this.sinks.subscribe(clientId, sink);
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
        const selection = catalog.normalize(stored?.info.selection ?? this.openingSelection(payload.chatId, kind) ?? payload.selection);
        const cwd = stored?.info.cwd ?? payload.cwd ?? this.env.HOME ?? homedir();
        await this.admit(payload.chatId, cwd);
        // A thread on disk keeps its account too. One it lost still opens, and says why on its next turn.
        // A new one without an account takes the person's pick for this CLI, which is refused rather than replaced when it went.
        const account = stored ? stored.info.account : storedAccount(kind, payload.account ?? this.composerPreferences.for(kind).account);
        if (!stored) {
            this.requireAccount(kind, account);
        }
        const info: ChatInfo = stored?.info
            ? { ...stored.info, runtimeMode: this.runtimeModeFor(payload.chatId, stored.info.runtimeMode) }
            : {
                  chatId: payload.chatId,
                  provider: kind,
                  ...(account === undefined ? {} : { account }),
                  cwd,
                  agentSessionId: payload.resume ?? null,
                  model: null,
                  selection,
                  runtimeMode: this.runtimeModeFor(payload.chatId, payload.runtimeMode ?? 'full-access'),
                  status: 'idle',
                  running: false,
                  activeTurnId: null,
                  slashCommands: [],
                  usage: { contextTokens: 0, contextWindow: catalog.contextWindowFor(selection), costUsd: 0, turns: 0 },
                  createdAt: Date.now()
              };
        const resume: ResumeDecision = stored ? await this.owedResume(payload.chatId, stored) : { resumeTurnId: null, reason: null };
        const claudeTitles = this.claudeTitles;
        const nameChat = this.nameChat;
        const base = this.envFor(payload.chatId, this.env);
        this.logs.set(payload.chatId, await this.openLog(payload.chatId, stored ?? null));
        const promptNotes = this.promptNotesFor(payload.chatId);
        const references = this.referencesFor(payload.chatId);
        const session = new ChatSession({
            info,
            items: stored?.items ?? [],
            preambles: stored?.preambles ?? [],
            provider,
            command: this.commands[kind] ?? provider.command,
            ...(this.spawn ? { spawn: this.spawn } : {}),
            env: (chatAccount) => {
                const env = definedEnv(launchEnv(this.accounts, kind, chatAccount, base));
                this.accounts?.launched?.(kind, chatAccount);
                return env;
            },
            instructions: () => this.instructionsFor(payload.chatId),
            resumeNote: () => this.resumeNoteFor(payload.chatId),
            ...(promptNotes ? { promptNotes } : {}),
            ...(references ? { references } : {}),
            ...(this.checkpoints ? { checkpoints: this.checkpoints } : {}),
            emit: (event: ChatEvent) => this.emit(payload.chatId, event),
            ...(this.onLimits ? { onLimits: this.onLimits } : {}),
            persist: () => this.persist(payload.chatId),
            persistSoon: () => this.persistSoon(payload.chatId),
            ...(kind === 'claude' && claudeTitles
                ? { readTitle: (agentSessionId: string) => claudeTitles.forSession(agentSessionId, this.claudeProjectsDirOf(session.info)) }
                : {}),
            ...(kind === 'codex' && nameChat ? { nameThread: (input: ChatTitleInput) => nameChat(kind, input) } : {}),
            ...(kind === 'claude' ? { subagentSettlement: (toolUseId: string) => this.subagents.claudeSettlement(payload.chatId, toolUseId) } : {}),
            ...(this.limitResume ? { limitResume: limitHooks(this.limitResume, payload.chatId) } : {})
        });
        this.chats.set(session.id, session);
        if (stored) {
            session.settleStored(selection, resume);
            session.settleOwedResume();
            await session.settleOrphanedSubagents();
        }
        await this.opened(session, stored ?? null);
        return session.info;
    }

    configure(payload: ChatConfigurePayload): ChatInfo {
        const session = this.require(payload.chatId);
        if (payload.account !== undefined) {
            this.switchAccount(session, payload.account);
        }
        return session.configure(payload);
    }

    /*
     * Any account of the chat's CLI before its first turn. After it only one that reads the same
     * transcripts, since the CLI would not find the conversation in another folder.
     */
    protected switchAccount(session: ChatSession, requested: string): void {
        const { provider: kind, account: from } = session.info;
        const to = storedAccount(kind, requested);
        if (to === from) {
            return;
        }
        this.requireAccount(kind, to);
        const spoke = session.info.agentSessionId !== null || session.info.usage.turns > 0;
        if (spoke && !this.canContinue(kind, from, to)) {
            const label = this.accountLabel(kind, to);
            throw new AccountError(
                'account-incompatible',
                `This conversation is kept by the account '${this.accountLabel(kind, from)}', which '${label}' cannot read. Fork the chat to go on under '${label}'.`
            );
        }
        session.setAccount(to);
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

    /*
     * `attach` with the chat's bookmarks. They are read before the client joins, so a change written
     * after the read reaches it as `chat.bookmarks` and never falls between the two. A file that
     * cannot be read leaves the list out rather than the thread.
     */
    async attachWithBookmarks(chatId: string, clientId: string, historyLimit?: number, since?: number): Promise<ChatAttachResult> {
        this.require(chatId);
        const bookmarks = await this.bookmarks?.read(chatId).catch((e: unknown) => {
            console.error(`The bookmarks of chat ${chatId} could not be read:`, errorText(e));
            return undefined;
        });
        const result = this.attach(chatId, clientId, historyLimit, since);
        return bookmarks === undefined ? result : { ...result, bookmarks };
    }

    /* Marks a message of the chat's own thread; a message that already has one keeps it. */
    addBookmark(chatId: string, itemId: string, name?: string): Promise<ChatBookmark[]> {
        const item = this.require(chatId).thread.get(itemId);
        if (!item || !isBookmarkable(item)) {
            throw new ChatError('item-not-found', `Chat ${chatId} has no message ${itemId} to bookmark`);
        }
        return this.requireBookmarks().add(chatId, { itemId, excerpt: excerptOf(item), ...(name === undefined ? {} : { name }) }, Date.now());
    }

    renameBookmark(chatId: string, itemId: string, name: string): Promise<ChatBookmark[]> {
        this.require(chatId);
        return this.requireBookmarks().rename(chatId, itemId, name);
    }

    removeBookmark(chatId: string, itemId: string): Promise<ChatBookmark[]> {
        this.require(chatId);
        return this.requireBookmarks().remove(chatId, itemId);
    }

    private requireBookmarks(): BookmarkStore {
        if (!this.bookmarks) {
            throw new ChatError('chat-unsupported', 'This host keeps no bookmarks');
        }
        return this.bookmarks;
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
        await this.chats.get(payload.chatId)?.recheckOrphan(payload.toolUseId);
        if (payload.watch === true) {
            this.subagents.hold(clientId, payload.chatId, payload.toolUseId);
        }
        return result;
    }

    /*
     * Stops one running sub-agent of the CLI's own. It cannot be stopped apart from its CLI, so its row
     * is only marked, and only while no turn runs: stopping that turn is the composer's Stop.
     */
    async stopSubagent(chatId: string, toolUseId: string): Promise<void> {
        await this.loaded(chatId);
        const session = this.require(chatId);
        const row = session.thread.find('subagent', (item) => item.toolUseId === toolUseId);
        if (!row) {
            throw new ChatError('subagent-not-found', 'This chat has no such sub-agent');
        }
        if (row.status !== 'running') {
            return;
        }
        if (row.origin === 'ruimte') {
            throw new ChatError('chat-unsupported', 'This row stands for work the host runs; stop it there');
        }
        session.markSubagentStopped(toolUseId);
    }

    /* Ends a command or a monitor a chat's CLI runs in the background, for a person who pressed Stop on it. */
    async stopTask(chatId: string, taskId: string): Promise<void> {
        await this.loaded(chatId);
        this.require(chatId).stopTask(taskId);
    }

    /* The whole conversation of a subagent of the CLI's own, for an agent that reads it as text. */
    async subagentItems(chatId: string, toolUseId: string): Promise<ChatItem[]> {
        return this.subagents.readAll(chatId, toolUseId);
    }

    /* Whether a chat has a thread on disk, for work that must not make an empty chat of an id it only remembers. */
    async hasStored(chatId: string): Promise<boolean> {
        return this.chats.has(chatId) || (await this.store?.has(chatId)) === true;
    }

    /* The turn a chat took last, read off the record without loading a chat nobody has; null before its first. */
    async lastTurn(chatId: string): Promise<ChatTurnItem | null> {
        const session = this.chats.get(chatId);
        if (session) {
            return session.thread.find('turn', () => true) ?? null;
        }
        const stored = await this.store?.read(chatId);
        return stored?.items.findLast((item): item is ChatTurnItem => item.kind === 'turn') ?? null;
    }

    /* A line from the host in a chat's thread, loading the chat when nobody has; nothing for a chat that is gone. */
    async addNote(chatId: string, level: 'info' | 'warning' | 'error', text: string): Promise<void> {
        await this.loaded(chatId);
        if (!(await this.hasStored(chatId))) {
            return;
        }
        if (!this.chats.has(chatId)) {
            await this.create({ chatId });
        }
        this.chats.get(chatId)?.addNote(level, text);
    }

    /* Leaves a note and its preamble in a chat, loading that chat when nobody has; false when it was there already. */
    async deliverNote(chatId: string, delivery: { noteId: string; note: string; from?: string; preamble: string }): Promise<boolean> {
        await this.loaded(chatId);
        if (!this.chats.has(chatId)) {
            await this.create({ chatId });
        }
        return this.require(chatId).deliverNote(delivery);
    }

    /*
     * Answers whether the message went into the chat's queue because a turn was still running. The
     * uploads become files first, so a queued message carries paths and never its own bytes.
     */
    async send(chatId: string, text: string, extras: ChatSendExtras = {}, uploads: ChatAttachmentUpload[] = []): Promise<{ queued: boolean; turnId: string }> {
        const session = this.require(chatId);
        const checked = ChatAttachmentUploadsSchema.safeParse(uploads);
        if (!checked.success) {
            throw new ChatError('invalid-attachments', checked.error.issues[0]!.message);
        }
        const attachments = await Promise.all(uploads.map((upload) => this.attachments.save(chatId, upload)));
        return session.send(text, { ...extras, ...(attachments.length > 0 ? { attachments } : {}) });
    }

    /* The file behind an attachment id: what this chat's thread or queue says it is. */
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

    unqueue(chatId: string, messageId: string): ChatQueuedMessage {
        const message = this.require(chatId).unqueue(messageId);
        if (!message) {
            throw new ChatError('request-not-found', `No queued message ${messageId} in chat ${chatId}`);
        }
        return message;
    }

    sendNow(chatId: string, messageId: string): void {
        if (!this.require(chatId).sendNow(messageId)) {
            throw new ChatError('request-not-found', `No queued message ${messageId} in chat ${chatId}`);
        }
    }

    /* What the chat's CLI would run as a skill. */
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

    /* Empties the thread and drops the CLI's session and the chat's bookmarks; `force` stops a turn that is in the way. */
    async clear(chatId: string, force = false): Promise<void> {
        const session = this.require(chatId);
        session.clear(force);
        // Before the record is written, so what it takes along from the record is gone from the write as well.
        const cleared = this.cleared(chatId);
        // A debounced write still waiting holds the old thread and must not land after the empty one.
        this.cancelWaiting(chatId);
        // Folded right away: every line before the reset describes a thread that is gone.
        await Promise.all([this.persistNow(chatId, true), this.attachments.removeAll(chatId), this.bookmarks?.removeChat(chatId), cleared]);
    }

    /* Stops the running turn; with `subagents` also marks the CLI's own subagents stopped, which that turn no longer waits on. */
    cancel(chatId: string, subagents = false): void {
        const session = this.require(chatId);
        session.cancel();
        if (subagents) {
            session.markSubagentsStopped();
        }
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

    /* Removes a chat: its CLI, its record, its log, its attachments and its bookmarks. */
    async kill(chatId: string): Promise<void> {
        await this.loaded(chatId);
        const session = this.require(chatId);
        // A write already out would put the record back after the delete.
        const writing = this.writes.get(chatId);
        void session.dispose();
        this.subagents.releaseChat(chatId);
        this.coalescers.get(chatId)?.dispose();
        this.coalescers.delete(chatId);
        this.logs.get(chatId)?.close();
        this.logs.delete(chatId);
        this.cancelWaiting(chatId);
        this.sizes.delete(chatId);
        this.unlogged.delete(chatId);
        this.writes.delete(chatId);
        this.activity.delete(chatId);
        this.chats.delete(chatId);
        this.attached.delete(chatId);
        this.announced.delete(chatId);
        const snapshot = session.thread.snapshot();
        this.forgotten(chatId);
        await writing;
        await Promise.all([this.store?.delete(chatId), this.attachments.removeAll(chatId), this.bookmarks?.removeChat(chatId), this.removed(chatId, snapshot)]);
    }

    /*
     * Ends the CLI of a chat and keeps its thread. A chat nobody loaded has no CLI to end, and a host
     * that must not resume its turn later says so through `endedAt`.
     */
    async stop(chatId: string, reason: string): Promise<void> {
        await this.loaded(chatId);
        this.chats.get(chatId)?.end(reason);
    }

    /* The chats with a CLI process, for a process monitor. */
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
     * Takes up a turn the host went down in, under the same turn with the next attempt. Loads the
     * chat when nobody has yet, which asks `onInterruptedRun` again and finds the resume already owed.
     * Throws when the CLI will not start, so whoever owes it tries again.
     */
    async resumeRun(chatId: string, turnId: string, attempt: number): Promise<void> {
        await this.loaded(chatId);
        if (!this.chats.has(chatId)) {
            if (!(await this.store?.has(chatId))) {
                return;
            }
            await this.create({ chatId });
        }
        await this.chats.get(chatId)?.resume(turnId, attempt, await this.resumeWords(chatId));
    }

    /*
     * Takes up a turn that stopped on a limit, once its reset or its retry came. Loads the chat when
     * nobody has; a chat whose opener was stopped since that turn is left as it is.
     */
    async takeUpAfterLimit(chatId: string, turnId: string): Promise<void> {
        await this.loaded(chatId);
        if (!this.chats.has(chatId)) {
            if (!(await this.store?.has(chatId))) {
                return;
            }
            await this.create({ chatId });
        }
        const session = this.chats.get(chatId);
        const turn = session?.thread.get(turnId);
        const ended = this.endedAt(chatId);
        if (!session || turn === undefined || (ended !== null && ended >= turn.createdAt)) {
            return;
        }
        session.takeUpAfterLimit(turnId);
    }

    /* The host's switch for resuming after a limit changed; every chat loaded here looks again. */
    resumeSettingChanged(): void {
        for (const session of this.chats.values()) {
            session.resumeSettingChanged();
        }
    }

    /* A resume that never came about: the turn ends as aborted, with the reason in the thread. */
    abandonRun(chatId: string, turnId: string, reason: string): void {
        this.chats.get(chatId)?.abandon(turnId, reason);
    }

    /*
     * Loads every stored chat whose turn was running when the host went down, or that shows a resume
     * after a limit nobody owes, so `create` decides what becomes of it without waiting for a client to
     * open it. One file at a time: it runs beside the host answering, not in front of it.
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
            const unowed = record?.info.resumeAt !== undefined && this.limitResume?.owed(chatId) === false;
            if (record !== null && (interruptedTurn(record) !== null || unowed)) {
                await this.create({ chatId }).catch((e: unknown) => console.error(`Loading chat ${chatId} after a restart failed:`, errorText(e)));
            }
        }
    }

    /*
     * Writes every thread and ends every CLI, waiting for them as long as the grace of a SIGKILL. A
     * turn that was running is taken up after the restart, never finished by a CLI nobody hears.
     */
    async shutdown(): Promise<void> {
        for (const session of this.chats.values()) {
            session.freeze();
        }
        for (const chatId of this.chats.keys()) {
            this.cancelWaiting(chatId);
        }
        await Promise.all([...this.chats.keys()].map((chatId) => this.persistNow(chatId, true)));
        await Promise.all([...this.chats.values()].map((session) => session.dispose()));
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
                this.store.writeSync(chatId, info, items, { seq: log?.seq ?? 0, resetSeq: log?.resetSeq ?? 0 }, session.preambles, this.recordExtras(chatId));
            } catch (e) {
                console.error(`Chat record for ${chatId} failed:`, errorText(e));
            }
        }
    }

    /* Resolves once every write of the chat's record asked for so far has landed or was found unneeded. */
    async persisted(chatId: string): Promise<void> {
        await this.writes.get(chatId);
    }

    /* Waits for a create of this chat that is under way, whatever came of it. */
    protected async loaded(chatId: string): Promise<void> {
        await this.creating.get(chatId)?.catch(() => undefined);
    }

    protected persist(chatId: string): void {
        this.cancelWaiting(chatId);
        void this.persistNow(chatId).catch((e) => console.error(`Chat record for ${chatId} failed:`, errorText(e)));
    }

    protected require(chatId: string): ChatSession {
        const session = this.chats.get(chatId);
        if (!session) {
            throw new ChatError('chat-not-found', `No chat ${chatId}`);
        }
        return session;
    }

    /* What the agent is told once at the start of every process of this chat; null for nothing. */
    protected instructionsFor(_chatId: string): string | null {
        return this.instructions;
    }

    /* What of the instructions a resumed thread hears again in front of its next prompt, for a CLI that ignores them on a resume. */
    protected resumeNoteFor(_chatId: string): string | null {
        return null;
    }

    /* What the host says in front of a chat's next real prompt, beside what the chat keeps itself. */
    protected promptNotesFor(_chatId: string): PromptNotes | undefined {
        return undefined;
    }

    /* How the chats a person attached to a message are named to the agent; without it they are dropped. */
    protected referencesFor(_chatId: string): ChatReferences | undefined {
        return undefined;
    }

    /* The environment of this chat's CLI before its account adds its own. */
    protected envFor(_chatId: string, base: Record<string, string>): Record<string, string | undefined> {
        return base;
    }

    /* Throws for a folder this chat may not start in; asked every time a chat is loaded. */
    protected async admit(_chatId: string, _cwd: string): Promise<void> {}

    /* The model a new chat starts on when the host already knows; the explicit one still wins. */
    protected openingSelection(_chatId: string, _kind: AgentKind): ModelSelection | undefined {
        return undefined;
    }

    /* The mode a chat runs in, which a host may narrow whatever its record or its client says. */
    protected runtimeModeFor(_chatId: string, mode: RuntimeMode): RuntimeMode {
        return mode;
    }

    /* A chat just loaded or made, its stored turns settled; whatever the host lays down in it goes here. */
    protected async opened(_session: ChatSession, _stored: ChatRecord | null): Promise<void> {}

    /* What the host keeps in the chat's record beside the thread. */
    protected recordExtras(_chatId: string): ChatRecordExtras {
        return {};
    }

    /* The chat was cleared; what runs before the first await is in the record written right after. */
    protected async cleared(_chatId: string): Promise<void> {}

    /* The chat left memory for good, before its files go. */
    protected forgotten(_chatId: string): void {}

    /* The chat was removed; what the host keeps of it goes along. */
    protected async removed(_chatId: string, _chat: { info: ChatInfo; items: ChatItem[] }): Promise<void> {}

    /* An event of a chat went out, after the observers and before the clients reading its thread. */
    protected broadcasted(_chatId: string, _event: ChatEvent): void {}

    /* When whoever opened this chat stopped it; a turn from before that is never taken up again. */
    protected endedAt(_chatId: string): number | null {
        return null;
    }

    /* Why a turn the host went down in stays down when `onInterruptedRun` says no, in the words of the note it ends with. */
    protected unownedReason(_chatId: string): string {
        return 'nothing holds this chat any more';
    }

    /* How a turn the host went down in is taken up in this chat. */
    protected async resumeWords(_chatId: string): Promise<ResumeWords> {
        return DEFAULT_RESUME_WORDS;
    }

    /* A write that may wait: a long thread is not rewritten for every small change. */
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
            const extras = this.recordExtras(chatId);
            const unlogged = JSON.stringify([session.preambles, extras]);
            const folds = fold || log.size > COMPACT_ABOVE_BYTES || !log.onDisk;
            // The log already holds every change to the thread, so the whole record is rewritten only to fold
            // the log, on a chat's first write, or for what no event carries.
            if (!folds && this.sizes.has(chatId) && this.unlogged.get(chatId) === unlogged) {
                return;
            }
            const { info, items } = session.thread.snapshot();
            const at = { seq: log.seq, resetSeq: log.resetSeq };
            this.sizes.set(chatId, await this.store.write(chatId, info, items, at, session.preambles, extras));
            this.unlogged.set(chatId, unlogged);
            // A chat killed while the write was out has no log left to fold.
            if (this.logs.get(chatId) === log && folds) {
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
        this.broadcasted(chatId, event);
        for (const clientId of this.attached.get(chatId) ?? []) {
            this.sinks.to(clientId, { event: 'chat.event', payload });
        }
        // After the thread, so a client reading it has already had this info and the status is a no-op there.
        if (event.type === 'info' || event.type === 'reset') {
            this.announceStatus(chatId, event.info);
        }
    }

    /*
     * What a chat is doing goes to every client of this host, not only to the ones reading its thread:
     * a chat waiting on a person has to say so where nobody has it open. The thread itself stays with
     * whoever attached, since it streams word by word. Only a change is sent; `chat.list` hands out the
     * rest on connect.
     */
    private announceStatus(chatId: string, info: ChatInfo): void {
        // A limit and the resume owed after it are what a header shows of an idle chat, so they count as a change too.
        const said = JSON.stringify([info.status, info.limit ?? null, info.resumeAt ?? null, info.resumeAtReset ?? null]);
        if (this.announced.get(chatId) === said) {
            return;
        }
        this.announced.set(chatId, said);
        this.sinks.emit({ event: 'chat.status', payload: { chatId, info } });
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
        const ended = this.endedAt(chatId);
        if (ended !== null && ended >= turn.createdAt) {
            return skip('the agent that opened it was stopped');
        }
        if ((turn.attempt ?? 1) >= MAX_ATTEMPTS) {
            return skip('it was already resumed after an earlier restart');
        }
        try {
            const owed = await this.onInterruptedRun({ chatId, turnId: turn.id, attempt: (turn.attempt ?? 1) + 1 });
            return owed ? { resumeTurnId: turn.id, reason: null } : skip(this.unownedReason(chatId));
        } catch (e) {
            console.error(`Owing a resume for chat ${chatId} failed:`, errorText(e));
            return skip(errorText(e));
        }
    }
}

/* The hooks of one chat, over the core's own. */
const limitHooks = (hooks: NonNullable<ChatCoreOptions['limitResume']>, chatId: string): LimitResumeHooks => ({
    allowed: () => hooks.allowed(),
    now: () => hooks.now(),
    owe: (turnId, at) => hooks.owe(chatId, turnId, at),
    lapse: () => hooks.lapse(chatId),
    owed: () => hooks.owed(chatId)
});

/* The running turn of a stored chat, when it may be resumed and the resume is now owed; null otherwise. */
const interruptedTurn = (record: { info: ChatInfo; items: ChatItem[] }): Extract<ChatItem, { kind: 'turn' }> | null => {
    const turnId = record.info.activeTurnId;
    const turn = turnId === null ? undefined : record.items.find((item) => item.id === turnId);
    return turn?.kind === 'turn' && turn.state === 'running' ? turn : null;
};

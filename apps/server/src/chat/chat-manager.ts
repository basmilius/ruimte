import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ChatAttachmentUploadsSchema } from '@ruimte/contracts';
import type {
    AgentKind,
    ChatAttachment,
    ChatAttachResult,
    ChatBookmark,
    ChatHistoryResult,
    ChatAttachmentUpload,
    ChatCheckpointDiff,
    ChatConfigurePayload,
    ChatCreatePayload,
    ChatEvent,
    ChatInfo,
    ChatItem,
    ChatQueuedMessage,
    ChatSkill,
    ChatSubagentPayload,
    ChatSubagentResult,
    ChatTurnItem,
    ChatTurnLimit,
    ContextSource,
    ModelSelection,
    RuntimeMode,
    Task
} from '@ruimte/contracts';
import { narrowerMode } from '../canvas/mode.ts';
import { chatPrompt, contextPrompt } from '../context/context-note.ts';
import type { CheckpointService } from '../git/checkpoints.ts';
import { AccountError, definedEnv, isDefaultAccountOf, launchEnv, storedAccount, type AccountLaunches } from '../providers/accounts/launch.ts';
import { RUIMTE_CODEX_CLIENT } from '../providers/codex-provider.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { SkillIndex } from '../skills/skills.ts';
import type { LimitsUpdate } from '@ruimte/agents/usage/limits/normalize';
import type { AttachmentStore } from './attachment-store.ts';
import type { BookmarkStore } from './bookmark-store.ts';
import type { SpawnChatProcess } from '@ruimte/agents/chat/chat-process';
import { ChatSession, PLAN_RESUME_PREAMBLE, type ChatSendExtras, type LimitResumeHooks, type ResumeDecision } from './chat-session.ts';
import { ChatLog, COMPACT_ABOVE_BYTES } from './chat-log.ts';
import type { ChatTitleInput } from './chat-title.ts';
import type { ChatRecord, ChatStore } from './chat-store.ts';
import { ComposerPreferences } from './composer-preferences.ts';
import { DeltaCoalescer } from '@ruimte/agents/chat/delta-coalescer';
import { ChatError } from './errors.ts';
import { continueOnWake, continuedInForkNote, limitedTurn } from './limit-resume.ts';
import type { CodexProcessSpec } from '@ruimte/agents/chat/codex-thread';
import { claudeProjectSlug } from '@ruimte/agents/chat/claude-transcript';
import { SubagentReader, type SubagentReaderOptions } from '@ruimte/agents/chat/subagent-reader';
import { errorText } from '../error-text.ts';
import { usageRoots } from '../usage/roots.ts';
import { ClientSinks } from '../client-sinks.ts';

/* A turn that was running when the daemon went down, and the attempt that would take it up again. */
export interface InterruptedRun {
    chatId: string;
    turnId: string;
    attempt: number;
}

// Why a task a person stopped from the list of the chat that gave it ended, in that chat's note and the child's thread.
export const STOPPED_TASK_REASON = 'a person stopped it';

/* The plans kept beside a chat's record, which live and die with the chat. */
export interface ChatPlans {
    removeChat(chatId: string): Promise<void>;
    copyChat(fromChatId: string, toChatId: string): Promise<void>;
    hasOpenSteps(chatId: string): Promise<boolean>;
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

interface ChatManagerOptions {
    providers: ProviderRegistry;
    store?: ChatStore;
    // Takes a git tree per turn; without it a turn has no checkpoint and the card falls back to the CLI's own changes.
    checkpoints?: CheckpointService;
    env?: Record<string, string | undefined>;
    // The CLIs to run, when they are not the ones the providers name; a test points these at fakes.
    command?: string[];
    // Where an agent reads its linked context.
    contextUrl?: string;
    // How deep a chat sits in a chain of agents; an unknown chat is one a person opened.
    depthOf?: (chatId: string) => number;
    standalone?: (chatId: string) => boolean;
    // Whether computer use is on for this machine, read when a chat's CLI starts.
    computer?: () => boolean;
    // A client may create an agent chat before the outbox starts it; the explicit model still wins.
    openingSelection?: (chatId: string, provider: AgentKind) => ModelSelection | undefined;
    // The sources themselves, so a chat can name them to its agent and tell it what came and went between turns.
    contextSources?: (chatId: string) => ContextSource[];
    // The name of a chat of the same project, for a message a person attached it to; null for any other id.
    chatTitle?: (chatId: string, id: string) => string | null;
    // What another node left for this chat, taken once and put in front of the next prompt.
    messages?: (chatId: string) => string[];
    // The same messages, as the lines a person reads in the thread; asked once, when the chat is loaded.
    unshownMessages?: (chatId: string) => Promise<string[]>;
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
    // Where Claude Code's own name for a session is read, in the projects folder of the chat's account; the other CLIs write none down.
    claudeTitles?: { forSession(agentSessionId: string, projectsDir: string): Promise<string | null> };
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
    // When stopping the agent that opened a chat ended it too; a turn from before that is never resumed.
    endedAt?: (chatId: string) => number | null;
    // The tasks a chat gave, so a chat loaded from disk shows a row for each even when a crash lost the write of one.
    taskRows?: (chatId: string) => Task[];
    // A cleared chat is a conversation that gave no task, so what it gave before wakes it no more; the rows stay for a person.
    dropWakes?: (chatId: string) => Promise<void>;
    plans?: ChatPlans;
    bookmarks?: BookmarkStore;
    // The widest mode this chat may run in, whatever its record or its node says; null for no limit.
    modeCeiling?: (chatId: string) => RuntimeMode | null;
    // Refuses a directory this chat may not start in, asked every time a chat is loaded.
    checkCwd?: (chatId: string, cwd: string) => Promise<void>;
    // Where a turn that stopped on a limit is owed a resume on a clock, when the machine allows it.
    limitResume?: {
        allowed(): boolean;
        now(): number;
        owe(chatId: string, turnId: string, at: number): Promise<void>;
        lapse(chatId: string): Promise<void>;
        // Whether the outbox holds that entry for this chat now.
        owed(chatId: string): boolean;
    };
    // The accounts a chat may run under; without them every chat runs under its CLI's default account.
    accounts?: AccountLaunches;
}

// Above this the record is big enough that rewriting it for every small change costs more than it saves.
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
    private readonly sinks = new ClientSinks((clientId) => this.composerPreferences.forget(clientId));
    private readonly attached = new Map<string, Set<string>>();
    private readonly coalescers = new Map<string, DeltaCoalescer>();
    // What `chat.status` last said about each chat, so the broadcast is one per change and not one per info event.
    private readonly announced = new Map<string, string>();
    private readonly logs = new Map<string, ChatLog>();
    private readonly tokens = new Map<string, string>();
    // How big each record was the last time it went to disk, and the writes waiting for a big one.
    private readonly sizes = new Map<string, number>();
    private readonly waiting = new Map<string, ReturnType<typeof setTimeout>>();
    // What the last record held that no event carries (preambles, cleared task ids), as its JSON.
    private readonly unlogged = new Map<string, string>();
    // The write in flight per chat, so the next one queues behind it instead of racing it.
    private readonly writes = new Map<string, Promise<void>>();
    // When each chat last said anything, which is what a chat has instead of a hook event.
    private readonly activity = new Map<string, number>();
    private readonly contextUrl: string | null;
    private readonly depthOf: (chatId: string) => number;
    private readonly standalone: (chatId: string) => boolean;
    private readonly computer: () => boolean;
    private readonly openingSelection: NonNullable<ChatManagerOptions['openingSelection']>;
    private readonly contextSources: (chatId: string) => ContextSource[];
    private readonly chatTitle: (chatId: string, id: string) => string | null;
    private readonly messages: (chatId: string) => string[];
    private readonly unshownMessages: (chatId: string) => Promise<string[]>;
    private readonly firstPrompt: (chatId: string) => Promise<string | null>;
    private readonly modeCeiling: (chatId: string) => RuntimeMode | null;
    private readonly checkCwd: (chatId: string, cwd: string) => Promise<void>;
    private readonly claudeTitles: ChatManagerOptions['claudeTitles'] | null;
    private readonly nameChat: ChatManagerOptions['nameChat'] | null;
    private readonly subagents: SubagentReader;
    private readonly onInterruptedRun: ChatManagerOptions['onInterruptedRun'] | null;
    private readonly limitResume: ChatManagerOptions['limitResume'] | null;
    private readonly endedAt: (chatId: string) => number | null;
    private readonly taskRows: (chatId: string) => Task[];
    private readonly dropWakes: (chatId: string) => Promise<void>;
    private readonly plans: ChatPlans | null;
    private readonly bookmarks: BookmarkStore | null;
    /* Where Claude Code keeps the projects of its default account on this machine; empty when it has none. */
    readonly claudeProjectsDir: string;
    private readonly accounts: AccountLaunches | null;
    // Clients following the conversation of a node a task opened, per row of the chat that gave it.
    private readonly childHolds = new Map<string, { parentId: string; toolUseId: string; childId: string; clients: Set<string> }>();

    constructor(options: ChatManagerOptions) {
        this.onInterruptedRun = options.onInterruptedRun ?? null;
        this.limitResume = options.limitResume ?? null;
        this.endedAt = options.endedAt ?? (() => null);
        this.taskRows = options.taskRows ?? (() => []);
        this.dropWakes = options.dropWakes ?? (() => Promise.resolve());
        this.plans = options.plans ?? null;
        this.bookmarks = options.bookmarks ?? null;
        this.accounts = options.accounts ?? null;
        // Only whoever reads the thread has anything to point a bookmark at, so the list goes where the thread goes.
        this.bookmarks?.listen((chatId, bookmarks) => {
            for (const clientId of this.attached.get(chatId) ?? []) {
                this.sinks.to(clientId, { event: 'chat.bookmarks', payload: { chatId, bookmarks } });
            }
        });
        this.providers = options.providers;
        this.claudeTitles = options.claudeTitles ?? null;
        this.nameChat = options.nameChat ?? null;
        this.store = options.store ?? null;
        this.checkpoints = options.checkpoints ?? null;
        this.skillIndex = options.skills ?? new SkillIndex();
        this.attachments = options.attachments;
        this.onLimits = options.onLimits ?? null;
        this.contextUrl = options.contextUrl ?? null;
        this.depthOf = options.depthOf ?? (() => 0);
        this.openingSelection = options.openingSelection ?? (() => undefined);
        this.standalone = options.standalone ?? (() => false);
        this.computer = options.computer ?? (() => false);
        this.contextSources = options.contextSources ?? (() => []);
        this.chatTitle = options.chatTitle ?? (() => null);
        this.messages = options.messages ?? (() => []);
        this.unshownMessages = options.unshownMessages ?? (() => Promise.resolve([]));
        this.firstPrompt = options.firstPrompt ?? (() => Promise.resolve(null));
        this.modeCeiling = options.modeCeiling ?? (() => null);
        this.checkCwd = options.checkCwd ?? (() => Promise.resolve());
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
        this.claudeProjectsDir =
            options.subagents?.claudeProjectsDir ?? usageRoots(options.env ?? process.env).find((root) => root.provider === 'claude')?.path ?? '';
        this.subagents = new SubagentReader({
            ...options.subagents,
            claudeProjectsDir: this.claudeProjectsDir,
            claudeProjectsDirOf: (info) => this.claudeProjectsDirOf(info),
            chatInfo: async (chatId) => (await this.forkSource(chatId))?.info ?? null,
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
            client: RUIMTE_CODEX_CLIENT,
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

    /* A chat as it stands: the thread in memory, else the record on disk; null when this machine has no such chat. */
    async forkSource(chatId: string): Promise<{ info: ChatInfo; items: ChatItem[] } | null> {
        await this.creating.get(chatId)?.catch(() => undefined);
        const session = this.chats.get(chatId);
        if (session) {
            return session.thread.snapshot();
        }
        const stored = await this.store?.read(chatId);
        return stored ? { info: stored.info, items: stored.items } : null;
    }

    /* The record of a chat nobody has loaded, written whole: a fork's thread before its node exists. */
    async writeRecord(chatId: string, info: ChatInfo, items: ChatItem[], preambles: string[]): Promise<void> {
        if (!this.store) {
            throw new ChatError('chat-unsupported', 'This machine keeps no chat records');
        }
        if (this.chats.has(chatId) || this.creating.has(chatId)) {
            throw new ChatError('chat-busy', `Chat ${chatId} is already loaded`);
        }
        await this.store.write(chatId, info, items, { seq: 0, resetSeq: 0 }, preambles);
    }

    /* Takes back a record `writeRecord` wrote, as long as nobody loaded the chat since. */
    async deleteRecord(chatId: string): Promise<void> {
        if (!this.chats.has(chatId) && !this.creating.has(chatId)) {
            await Promise.all([this.store?.delete(chatId), this.plans?.removeChat(chatId), this.bookmarks?.removeChat(chatId)]);
        }
    }

    /* Gives a fork the plans of the chat it was forked from. */
    async copyPlans(fromChatId: string, toChatId: string): Promise<void> {
        await this.plans?.copyChat(fromChatId, toChatId);
    }

    /* Gives a fork the bookmarks on the messages it copied. */
    async copyBookmarks(fromChatId: string, toChatId: string, itemIds: ReadonlySet<string>): Promise<void> {
        await this.bookmarks?.copyChat(fromChatId, toChatId, (itemId) => itemIds.has(itemId));
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

    /* The chat a context token belongs to. */
    chatIdForToken(token: string): string | null {
        return this.tokens.get(token) ?? null;
    }

    private readonly observers = new Set<SessionSink>();
    readonly composerPreferences = new ComposerPreferences();

    /*
     * An observer only notes things (a task record, an outbox file) and never acts: a turn sent from
     * inside an event runs in the first chat's call stack and is gone in a crash. The outbox executes.
     */
    observe(sink: SessionSink): () => void {
        this.observers.add(sink);
        return () => {
            this.observers.delete(sink);
        };
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
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
        await this.checkCwd(payload.chatId, cwd);
        // A thread on disk keeps its account too. One it lost still opens, and says why on its next turn.
        // A new one without an account takes the person's pick for this CLI, which is refused rather than replaced when it went.
        const account = stored ? stored.info.account : storedAccount(kind, payload.account ?? this.composerPreferences.for(kind).account);
        if (!stored) {
            this.requireAccount(kind, account);
        }
        const ceiling = this.modeCeiling(payload.chatId);
        const withinCeiling = (mode: RuntimeMode): RuntimeMode => (ceiling === null ? mode : narrowerMode(mode, ceiling));
        const info: ChatInfo = stored?.info
            ? { ...stored.info, runtimeMode: withinCeiling(stored.info.runtimeMode) }
            : {
                  chatId: payload.chatId,
                  provider: kind,
                  ...(account === undefined ? {} : { account }),
                  cwd,
                  agentSessionId: payload.resume ?? null,
                  model: null,
                  selection,
                  runtimeMode: withinCeiling(payload.runtimeMode ?? 'full-access'),
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
        const base = this.contextUrl ? { ...this.env, RUIMTE_CONTEXT_URL: this.contextUrl, RUIMTE_CONTEXT_TOKEN: token } : this.env;
        this.logs.set(payload.chatId, await this.openLog(payload.chatId, stored ?? null));
        const session = new ChatSession({
            info,
            items: stored?.items ?? [],
            preambles: stored?.preambles ?? [],
            clearedTaskIds: stored?.clearedTaskIds ?? [],
            provider,
            command: this.commands[kind] ?? provider.command,
            ...(this.spawn ? { spawn: this.spawn } : {}),
            env: (chatAccount) => {
                const env = definedEnv(launchEnv(this.accounts, kind, chatAccount, base));
                this.accounts?.launched?.(kind, chatAccount);
                return env;
            },
            instructions: () =>
                chatPrompt({
                    sources: this.contextSources(payload.chatId),
                    depth: this.depthOf(payload.chatId),
                    standalone: this.standalone(payload.chatId),
                    computer: this.computer()
                }),
            resumeNote: () => contextPrompt(this.contextSources(payload.chatId)),
            contextSources: () => this.contextSources(payload.chatId),
            chatTitle: (id: string) => this.chatTitle(payload.chatId, id),
            messages: () => this.messages(payload.chatId),
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
        for (const task of this.taskRows(payload.chatId)) {
            session.upsertTaskRow(task);
        }
        /* A message that landed while nobody held this chat is in the thread before its first prompt,
           so a person reads it here; the model still hears it from the queue, in front of that prompt. */
        try {
            for (const text of await this.unshownMessages(payload.chatId)) {
                session.addNote('info', text);
            }
        } catch (e) {
            // The messages themselves wait in the queue either way, and a chat must open regardless.
            console.error(`Showing the messages left for chat ${payload.chatId} failed:`, errorText(e));
        }
        // Send before returning info so attach includes the initial prompt as the thread's first message.
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
        const session = this.require(payload.chatId);
        if (payload.account !== undefined) {
            this.switchAccount(session, payload.account);
        }
        return session.configure(payload);
    }

    /*
     * Any account of the chat's CLI before its first turn. After it only one that reads the same
     * transcripts, since the CLI would not find the conversation in another folder; a fork carries it over instead.
     */
    private switchAccount(session: ChatSession, requested: string): void {
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
            throw new ChatError('chat-unsupported', 'This machine keeps no bookmarks');
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
        for (const [key, hold] of this.childHolds) {
            hold.clients.delete(clientId);
            if (hold.clients.size === 0) {
                this.childHolds.delete(key);
            }
        }
    }

    /*
     * A page of a subagent's own conversation. Letting go comes before the read, so a panel that closes
     * on a conversation that is gone still lets go; holding comes after it, so a hold is only ever on
     * something that was found.
     */
    async subagent(clientId: string, payload: ChatSubagentPayload): Promise<ChatSubagentResult> {
        const childId = this.taskChildOf(payload.chatId, payload.toolUseId);
        if (childId !== null) {
            return this.childConversation(clientId, payload, childId);
        }
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
     * Stops one running sub-agent of a chat. A task's row stands for a node, which `stopNode` stops as
     * a node is stopped. A subagent of the CLI's own cannot be stopped apart from its CLI, so its row is
     * only marked, and only while no turn runs: stopping that turn is the composer's Stop.
     */
    async stopSubagent(chatId: string, toolUseId: string, stopNode?: (nodeId: string, reason: string) => Promise<void>): Promise<void> {
        await this.creating.get(chatId)?.catch(() => undefined);
        const session = this.require(chatId);
        const row = session.thread.find('subagent', (item) => item.toolUseId === toolUseId);
        if (!row) {
            throw new ChatError('subagent-not-found', 'This chat has no such sub-agent');
        }
        if (row.status !== 'running') {
            return;
        }
        if (row.origin === 'ruimte') {
            if (row.childId === undefined || !stopNode) {
                throw new ChatError('chat-unsupported', 'This task cannot be stopped from here; stop its node instead');
            }
            await stopNode(row.childId, STOPPED_TASK_REASON);
            return;
        }
        session.markSubagentStopped(toolUseId);
    }

    /* Ends a command or a monitor a chat's CLI runs in the background, for a person who pressed Stop on it. */
    async stopTask(chatId: string, taskId: string): Promise<void> {
        await this.creating.get(chatId)?.catch(() => undefined);
        this.require(chatId).stopTask(taskId);
    }

    /* The whole conversation of a subagent, for an agent that reads it as text. */
    async subagentItems(chatId: string, toolUseId: string): Promise<ChatItem[]> {
        const childId = this.taskChildOf(chatId, toolUseId);
        if (childId !== null) {
            return (await this.childChat(childId)).thread.list();
        }
        return this.subagents.readAll(chatId, toolUseId);
    }

    /* Writes the row of a task into the chat that gave it, when that chat is loaded; loading it lays every row down anyway. */
    syncTaskRow(task: Task): void {
        this.chats.get(task.parentId)?.upsertTaskRow(task);
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

    /* A line from the daemon in a chat's thread, loading the chat when nobody has; nothing for a chat that is gone. */
    async addNote(chatId: string, level: 'info' | 'warning' | 'error', text: string): Promise<void> {
        await this.creating.get(chatId)?.catch(() => undefined);
        if (!(await this.hasStored(chatId))) {
            return;
        }
        if (!this.chats.has(chatId)) {
            await this.create({ chatId });
        }
        this.chats.get(chatId)?.addNote(level, text);
    }

    /* Opens the turn a fork writes its summary in, loading the fork when nobody has; null while a turn is in the way. */
    async openSummaryTurn(chatId: string, wake: { text: string; label: string; note: string; summaryFor: string }): Promise<string | null> {
        await this.creating.get(chatId)?.catch(() => undefined);
        if (!this.chats.has(chatId)) {
            if (!(await this.hasStored(chatId))) {
                throw new ChatError('chat-not-found', `No chat ${chatId}`);
            }
            await this.create({ chatId });
        }
        return this.require(chatId).wake({ ...wake, taskIds: [] });
    }

    /* Leaves a note and its preamble in a chat, loading that chat when nobody has; false when it was there already. */
    async deliverNote(chatId: string, delivery: { noteId: string; note: string; from?: string; preamble: string }): Promise<boolean> {
        await this.creating.get(chatId)?.catch(() => undefined);
        if (!this.chats.has(chatId)) {
            await this.create({ chatId });
        }
        return this.require(chatId).deliverNote(delivery);
    }

    /* The node a row of this chat stands for when a task opened it, or null for a subagent of the CLI's own. */
    private taskChildOf(chatId: string, toolUseId: string): string | null {
        const row = this.chats.get(chatId)?.thread.find('subagent', (item) => item.toolUseId === toolUseId);
        return row?.origin === 'ruimte' && row.childId !== undefined ? row.childId : null;
    }

    private async childChat(childId: string): Promise<ChatSession> {
        await this.creating.get(childId)?.catch(() => undefined);
        if (!this.chats.has(childId)) {
            if (!(await this.store?.has(childId))) {
                throw new ChatError('chat-unsupported', 'This task runs in a terminal or has not started; its node shows what it does');
            }
            await this.create({ chatId: childId });
        }
        return this.require(childId);
    }

    /*
     * A row a task opened reads the child's own thread, a page at a time like the chat's history, and
     * holding it tells the client whenever an item of that thread lands; a delta alone does not.
     */
    private async childConversation(clientId: string, payload: ChatSubagentPayload, childId: string): Promise<ChatSubagentResult> {
        const key = `${payload.chatId}\n${payload.toolUseId}`;
        if (payload.watch === false) {
            const hold = this.childHolds.get(key);
            hold?.clients.delete(clientId);
            if (hold?.clients.size === 0) {
                this.childHolds.delete(key);
            }
        }
        const child = await this.childChat(childId);
        this.coalescers.get(childId)?.flush();
        const page = child.thread.history(payload.limit ?? 60, payload.cursor);
        if (payload.watch === true) {
            const hold = this.childHolds.get(key) ?? { parentId: payload.chatId, toolUseId: payload.toolUseId, childId, clients: new Set<string>() };
            hold.clients.add(clientId);
            this.childHolds.set(key, hold);
        }
        return {
            items: page.items,
            history: page.history,
            // The closed set a result carries; the child's thread is that CLI's conversation.
            source: child.info.provider === 'codex' ? 'codex-thread' : 'claude-transcript',
            live: child.info.activeTurnId !== null
        };
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

    /* Empties the thread and drops the CLI's session, the chat's plans and its bookmarks; `force` stops a turn that is in the way. */
    async clear(chatId: string, force = false): Promise<void> {
        const session = this.require(chatId);
        session.clear(force, this.taskRows(chatId));
        // A debounced write still waiting holds the old thread and must not land after the empty one.
        this.cancelWaiting(chatId);
        // Folded right away: every line before the reset describes a thread that is gone.
        await Promise.all([
            this.persistNow(chatId, true),
            this.attachments.removeAll(chatId),
            this.plans?.removeChat(chatId),
            this.bookmarks?.removeChat(chatId),
            this.dropWakes(chatId)
        ]);
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

    async kill(chatId: string): Promise<void> {
        await this.creating.get(chatId)?.catch(() => undefined);
        const session = this.require(chatId);
        // A write already out would put the record back after the delete.
        const writing = this.writes.get(chatId);
        void session.dispose();
        this.subagents.releaseChat(chatId);
        for (const [key, hold] of this.childHolds) {
            if (hold.parentId === chatId) {
                this.childHolds.delete(key);
            }
        }
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
        for (const [token, id] of this.tokens) {
            if (id === chatId) {
                this.tokens.delete(token);
            }
        }
        await writing;
        await Promise.all([
            this.store?.delete(chatId),
            this.attachments.removeAll(chatId),
            this.plans?.removeChat(chatId),
            this.bookmarks?.removeChat(chatId),
            this.dropForkCopy(session.thread.snapshot())
        ]);
    }

    /*
     * Removes what a fork nobody ever wrote in leaves behind once its node is gone: the record and the
     * transcript copy made for it. A loaded chat goes through `kill`; a fork that has turns of its
     * own is a conversation, and a worktree is never removed on its own.
     */
    async dropUnspokenFork(chatId: string): Promise<void> {
        await this.creating.get(chatId)?.catch(() => undefined);
        if (this.chats.has(chatId) || !this.store) {
            return;
        }
        const stored = await this.store.read(chatId);
        if (stored === null || !unspokenFork(stored.items, stored.info)) {
            return;
        }
        await Promise.all([
            this.store.delete(chatId),
            this.attachments.removeAll(chatId),
            this.plans?.removeChat(chatId),
            this.bookmarks?.removeChat(chatId),
            this.dropForkCopy(stored)
        ]);
    }

    /* The transcript copy of a Claude fork nobody resumed; Codex keeps its forked thread where Ruimte cannot remove it. */
    private async dropForkCopy(chat: { info: ChatInfo; items: readonly ChatItem[] }): Promise<void> {
        const { info } = chat;
        const projectsDir = this.claudeProjectsDirOf(info);
        if (info.provider !== 'claude' || info.agentSessionId === null || projectsDir === '' || !unspokenFork(chat.items, info)) {
            return;
        }
        if (/[/\\]|\.\./.test(info.agentSessionId)) {
            return;
        }
        await rm(join(projectsDir, claudeProjectSlug(info.cwd), `${info.agentSessionId}.jsonl`), { force: true });
    }

    /*
     * Ends the CLI of a chat and keeps its thread, for a child whose parent was stopped. A chat nobody
     * loaded has no CLI to end; `endedAt` keeps a restart from resuming its turn when it is loaded.
     */
    async stop(chatId: string, reason: string): Promise<void> {
        await this.creating.get(chatId)?.catch(() => undefined);
        this.chats.get(chatId)?.end(reason);
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
        await this.chats.get(chatId)?.resume(turnId, attempt, await this.resumePreamble(chatId));
    }

    /* A resumed agent that keeps a plan hears where to find it, since the restart may have cut it off in the middle of one. */
    private async resumePreamble(chatId: string): Promise<string | null> {
        const open = await (this.plans?.hasOpenSteps(chatId) ?? Promise.resolve(false)).catch((e: unknown) => {
            console.error(`Reading the plans of chat ${chatId} failed:`, errorText(e));
            return false;
        });
        return open ? PLAN_RESUME_PREAMBLE : null;
    }

    /*
     * Takes up a turn that stopped on a limit, once its reset or its retry came. Loads the chat when
     * nobody has; a chat whose opener was stopped since that turn is left as it is.
     */
    async takeUpAfterLimit(chatId: string, turnId: string): Promise<void> {
        await this.creating.get(chatId)?.catch(() => undefined);
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

    /*
     * The turn to go on after under another account: the chat's last one, which stopped on a limit.
     * `inPlace` says whether that account reads the chat's conversation, which is when the chat itself
     * can go on under it. Refuses an account it cannot start, and a chat with nothing to go on after.
     */
    async limitedTurnFor(chatId: string, account: string): Promise<{ turnId: string; limit: ChatTurnLimit['kind']; inPlace: boolean }> {
        await this.creating.get(chatId)?.catch(() => undefined);
        if (!this.chats.has(chatId) && (await this.store?.has(chatId))) {
            await this.create({ chatId });
        }
        const session = this.require(chatId);
        const { provider: kind, account: from } = session.info;
        const to = storedAccount(kind, account);
        if (to === from) {
            throw new ChatError('same-account', `The chat already runs under the account '${this.accountLabel(kind, to)}'`);
        }
        this.requireAccount(kind, to);
        if (session.info.activeTurnId !== null) {
            throw new ChatError('chat-busy', 'The chat is working on a turn; go on under another account once it ends');
        }
        const turn = limitedTurn(session.thread.list());
        if (turn === null) {
            throw new ChatError('not-limited', 'The last turn of this chat did not stop on a limit');
        }
        return { turnId: turn.id, limit: turn.limit.kind, inPlace: this.canContinue(kind, from, to) };
    }

    /*
     * Moves the chat to an account that reads its conversation and takes its limited turn up there at
     * once, carrying the tasks and messages that turn answered, the way a resume at the reset does.
     */
    continueInPlace(chatId: string, account: string): void {
        const session = this.require(chatId);
        const turn = limitedTurn(session.thread.list());
        if (turn === null) {
            throw new ChatError('not-limited', 'The last turn of this chat did not stop on a limit');
        }
        this.switchAccount(session, account);
        const { provider: kind, account: to } = session.info;
        session.wake({
            ...continueOnWake(turn.limit.kind, this.accountLabel(kind, to), false),
            taskIds: turn.taskIds ?? [],
            ...(turn.messageFrom === undefined ? {} : { messageFrom: turn.messageFrom })
        });
    }

    /* Opens the first turn of a fork that goes on after the limited turn of its original. */
    async continueInFork(forkId: string, limit: ChatTurnLimit['kind']): Promise<void> {
        const info = await this.create({ chatId: forkId });
        this.require(forkId).wake({ ...continueOnWake(limit, this.accountLabel(info.provider, info.account), true), taskIds: [] });
    }

    /* The limited turn of the chat went on in a fork under `account`, so the chat itself never takes it up. */
    continuedInFork(chatId: string, account: string | undefined): void {
        const session = this.chats.get(chatId);
        session?.continuedInFork(continuedInForkNote(this.accountLabel(session.info.provider, account)));
    }

    /* The machine's switch for resuming after a limit changed; every chat loaded here looks again. */
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
     * Loads every stored chat whose turn was running when the daemon went down, or that shows a resume
     * after a limit the outbox does not hold, so `create` decides what becomes of it without waiting for
     * a client to open it. One file at a time: it runs beside the daemon answering, not in front of it.
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
                this.store.writeSync(chatId, info, items, { seq: log?.seq ?? 0, resetSeq: log?.resetSeq ?? 0 }, session.preambles, session.clearedTaskIds);
            } catch (e) {
                console.error(`Chat record for ${chatId} failed:`, errorText(e));
            }
        }
    }

    /* Resolves once every write of the chat's record asked for so far has landed or was found unneeded. */
    async persisted(chatId: string): Promise<void> {
        await this.writes.get(chatId);
    }

    private persist(chatId: string): void {
        this.cancelWaiting(chatId);
        void this.persistNow(chatId).catch((e) => console.error(`Chat record for ${chatId} failed:`, errorText(e)));
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
            const unlogged = JSON.stringify([session.preambles, session.clearedTaskIds]);
            const folds = fold || log.size > COMPACT_ABOVE_BYTES || !log.onDisk;
            // The log already holds every change to the thread, so the whole record is rewritten only to fold
            // the log, on a chat's first write, or for what no event carries.
            if (!folds && this.sizes.has(chatId) && this.unlogged.get(chatId) === unlogged) {
                return;
            }
            const { info, items } = session.thread.snapshot();
            const at = { seq: log.seq, resetSeq: log.resetSeq };
            this.sizes.set(chatId, await this.store.write(chatId, info, items, at, session.preambles, session.clearedTaskIds));
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
        if (event.type !== 'delta') {
            for (const hold of this.childHolds.values()) {
                if (hold.childId === chatId) {
                    for (const clientId of hold.clients) {
                        this.sinks.to(clientId, { event: 'chat.subagentChanged', payload: { chatId: hold.parentId, toolUseId: hold.toolUseId } });
                    }
                }
            }
        }
        for (const clientId of this.attached.get(chatId) ?? []) {
            this.sinks.to(clientId, { event: 'chat.event', payload });
        }
        // After the thread, so a client reading it has already had this info and the status is a no-op there.
        if (event.type === 'info' || event.type === 'reset') {
            this.announceStatus(chatId, event.info);
        }
    }

    /*
     * What a chat is doing goes to every client on this machine, not only to the ones reading its
     * thread: a node waiting on a person has to say so on a view nobody has open, and a terminal has
     * said it this way all along (`session.status`). The thread itself stays with whoever attached,
     * since it streams word by word. Only a change is sent; `chat.list` hands out the rest on connect.
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

/* The hooks of one chat, over the manager's own. */
const limitHooks = (hooks: NonNullable<ChatManagerOptions['limitResume']>, chatId: string): LimitResumeHooks => ({
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

/* A fork with no turn after the one it was cut at: nobody wrote in it, so its CLI never touched the copy. */
export const unspokenFork = (items: readonly ChatItem[], info: ChatInfo): boolean => {
    const forkOf = info.forkOf;
    if (forkOf === undefined) {
        return false;
    }
    const turns = items.filter((item) => item.kind === 'turn');
    return turns.at(-1)?.id === forkOf.turnId;
};

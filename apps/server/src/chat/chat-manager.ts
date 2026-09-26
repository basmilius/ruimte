import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
    AgentKind,
    ChatEvent,
    ChatInfo,
    ChatItem,
    ChatSubagentPayload,
    ChatSubagentResult,
    ChatSubagentItem,
    ChatTurnLimit,
    ContextSource,
    ModelSelection,
    RuntimeMode,
    Task
} from '@ruimte/contracts';
import { ChatCore, type ChatCoreOptions } from '@ruimte/agents/chat/chat-core';
import type { ChatReferences, ChatSession, PromptNotes, ResumeWords } from '@ruimte/agents/chat/chat-session';
import type { ChatRecord, ChatRecordExtras } from '@ruimte/agents/chat/chat-store';
import { claudeProjectSlug } from '@ruimte/agents/chat/claude-transcript';
import { limitedTurn } from '@ruimte/agents/chat/limit-resume';
import { storedAccount } from '@ruimte/agents/providers/accounts/launch';
import { narrowerMode } from '../canvas/mode.ts';
import { chatReferenceNote, resolveChatReferences } from '../context/chat-references.ts';
import { chatPrompt, contextChangeNote, contextPrompt } from '../context/context-note.ts';
import { errorText } from '../error-text.ts';
import { RUIMTE_CODEX_CLIENT } from '../providers/codex-provider.ts';
import { continueOnWake, continuedInForkNote } from './continue-on.ts';
import { ChatError } from './errors.ts';

export type { InterruptedRun } from '@ruimte/agents/chat/chat-core';

// Why a task a person stopped from the list of the chat that gave it ended, in that chat's note and the child's thread.
export const STOPPED_TASK_REASON = 'a person stopped it';

// What a resumed CLI is told: its transcript ends where the process did, and a tool call that was out is lost to it.
export const RESUME_PROMPT = 'The machine restarted while you were working on the previous message. Continue where you left off.';

// Said in front of a resume when the chat keeps a plan with steps left.
export const PLAN_RESUME_PREAMBLE = 'You keep a plan in this chat: ruimte-context plan read shows where you were.';

/* The plans kept beside a chat's record, which live and die with the chat. */
export interface ChatPlans {
    removeChat(chatId: string): Promise<void>;
    copyChat(fromChatId: string, toChatId: string): Promise<void>;
    hasOpenSteps(chatId: string): Promise<boolean>;
}

interface ChatManagerOptions extends ChatCoreOptions {
    // Where an agent reads its linked context.
    contextUrl?: string;
    // Put in front of PATH, so `ruimte-context` is there for the CLI's shell.
    binDir?: string;
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
    // When stopping the agent that opened a chat ended it too; a turn from before that is never resumed.
    endedAt?: (chatId: string) => number | null;
    // The tasks a chat gave, so a chat loaded from disk shows a row for each even when a crash lost the write of one.
    taskRows?: (chatId: string) => Task[];
    // A cleared chat is a conversation that gave no task, so what it gave before wakes it no more; the rows stay for a person.
    dropWakes?: (chatId: string) => Promise<void>;
    plans?: ChatPlans;
    // The widest mode this chat may run in, whatever its record or its node says; null for no limit.
    modeCeiling?: (chatId: string) => RuntimeMode | null;
    // Refuses a directory this chat may not start in, asked every time a chat is loaded.
    checkCwd?: (chatId: string, cwd: string) => Promise<void>;
}

/* The environment every CLI of a chat starts in: the daemon's own, without a terminal's hook variables, with `ruimte-context` on the PATH. */
const chatEnvOf = (env: Record<string, string | undefined>, binDir: string | undefined): Record<string, string> => {
    const chat: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        // The hook variables belong to terminal sessions; a chat reports through its own stream.
        if (value !== undefined && !key.startsWith('RUIMTE_HOOK_')) {
            chat[key] = value;
        }
    }
    if (binDir) {
        chat.PATH = chat.PATH ? `${binDir}:${chat.PATH}` : binDir;
    }
    return chat;
};

/* What a chat hears about its links in front of a prompt: a link made or removed since the last one, and what another node left for it. */
class ContextNotes implements PromptNotes {
    private readonly sources: () => ContextSource[];
    private readonly messages: () => string[];
    // The links at the previous prompt; null before the first, whose CLI hears about them at launch.
    private last: ContextSource[] | null = null;

    constructor(sources: () => ContextSource[], messages: () => string[]) {
        this.sources = sources;
        this.messages = messages;
    }

    /*
     * A message is written in the thread as it lands, by whichever channel got it first, so repeating it
     * above the turn it opened tells a person the same thing twice; a change of links nobody has read yet.
     */
    next(): { shown: string[]; heard: string[] } {
        const current = this.sources();
        const previous = this.last;
        this.last = current;
        const change = previous === null ? null : contextChangeNote(previous, current);
        return { shown: change === null ? [] : [change], heard: this.messages() };
    }

    reset(): void {
        this.last = null;
    }
}

/* The rows of tasks a clear hid, as the record keeps them beside the thread. */
const clearedExtras = (ids: ReadonlySet<string> | undefined): ChatRecordExtras => (ids === undefined || ids.size === 0 ? {} : { clearedTaskIds: [...ids] });

const clearedTaskIdsOf = (extras: ChatRecordExtras): string[] =>
    Array.isArray(extras.clearedTaskIds) ? extras.clearedTaskIds.filter((id): id is string => typeof id === 'string') : [];

/*
 * The chat row of a task in the thread of the chat that gave it, written from the task alone so writing
 * it twice changes nothing. A new row joins the turn that is running, which is the turn that ran the
 * verb; a cancelled task gets a note saying why its row failed.
 */
const taskRowItems = (session: ChatSession, task: Task): ChatItem[] => {
    const id = `task-${task.id}`;
    const existing = session.thread.get(id);
    const row: ChatSubagentItem = {
        id,
        kind: 'subagent',
        createdAt: task.createdAt,
        turnId: existing?.turnId ?? session.info.activeTurnId,
        toolUseId: id,
        description: task.title,
        subagentType: null,
        prompt: task.prompt,
        background: true,
        status: task.status === 'open' ? 'running' : task.status === 'done' ? 'done' : 'failed',
        startedAt: task.createdAt,
        finishedAt: task.settledAt,
        summary: null,
        result: task.result?.text ?? null,
        usage: null,
        lastTool: null,
        itemsTruncated: false,
        origin: 'ruimte',
        childId: task.childId
    };
    const noteId = `${id}-cancelled`;
    if (task.status !== 'cancelled' || session.thread.get(noteId) !== undefined) {
        return [row];
    }
    return [
        row,
        {
            id: noteId,
            kind: 'note',
            createdAt: task.settledAt ?? task.createdAt,
            turnId: null,
            level: 'warning',
            text: `The task "${task.title}" was cancelled: ${task.result?.text ?? 'its node was removed'}`
        }
    ];
};

/*
 * Ruimte's chats: the generic core with what the daemon adds to it. A chat runs in a project, hears
 * about the verbs and its links, draws a row per task it gave, keeps its plans beside its record and
 * forks into the canvas, and a turn cut off by a restart or a limit is taken up through the outbox.
 */
export class ChatManager extends ChatCore {
    private readonly contextUrl: string | null;
    private readonly depthOf: (chatId: string) => number;
    private readonly standalone: (chatId: string) => boolean;
    private readonly computer: () => boolean;
    private readonly opening: NonNullable<ChatManagerOptions['openingSelection']>;
    private readonly contextSources: (chatId: string) => ContextSource[];
    private readonly chatTitle: (chatId: string, id: string) => string | null;
    private readonly messages: (chatId: string) => string[];
    private readonly unshownMessages: (chatId: string) => Promise<string[]>;
    private readonly firstPrompt: (chatId: string) => Promise<string | null>;
    private readonly modeCeiling: (chatId: string) => RuntimeMode | null;
    private readonly checkCwd: (chatId: string, cwd: string) => Promise<void>;
    private readonly ended: (chatId: string) => number | null;
    private readonly taskRows: (chatId: string) => Task[];
    private readonly dropWakes: (chatId: string) => Promise<void>;
    private readonly plans: ChatPlans | null;
    private readonly tokens = new Map<string, string>();
    // The tasks whose rows a clear hid, per chat.
    private readonly clearedTasks = new Map<string, Set<string>>();
    // Clients following the conversation of a node a task opened, per row of the chat that gave it.
    private readonly childHolds = new Map<string, { parentId: string; toolUseId: string; childId: string; clients: Set<string> }>();

    constructor(options: ChatManagerOptions) {
        super({ codexClient: RUIMTE_CODEX_CLIENT, ...options, env: chatEnvOf(options.env ?? process.env, options.binDir) });
        this.contextUrl = options.contextUrl ?? null;
        this.depthOf = options.depthOf ?? (() => 0);
        this.standalone = options.standalone ?? (() => false);
        this.computer = options.computer ?? (() => false);
        this.opening = options.openingSelection ?? (() => undefined);
        this.contextSources = options.contextSources ?? (() => []);
        this.chatTitle = options.chatTitle ?? (() => null);
        this.messages = options.messages ?? (() => []);
        this.unshownMessages = options.unshownMessages ?? (() => Promise.resolve([]));
        this.firstPrompt = options.firstPrompt ?? (() => Promise.resolve(null));
        this.modeCeiling = options.modeCeiling ?? (() => null);
        this.checkCwd = options.checkCwd ?? (() => Promise.resolve());
        this.ended = options.endedAt ?? (() => null);
        this.taskRows = options.taskRows ?? (() => []);
        this.dropWakes = options.dropWakes ?? (() => Promise.resolve());
        this.plans = options.plans ?? null;
    }

    /* The chat a context token belongs to. */
    chatIdForToken(token: string): string | null {
        return this.tokens.get(token) ?? null;
    }

    /* A chat as it stands, for a fork of it. */
    forkSource(chatId: string): Promise<{ info: ChatInfo; items: ChatItem[] } | null> {
        return this.readChat(chatId);
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

    override detachAll(clientId: string): void {
        super.detachAll(clientId);
        for (const [key, hold] of this.childHolds) {
            hold.clients.delete(clientId);
            if (hold.clients.size === 0) {
                this.childHolds.delete(key);
            }
        }
    }

    /* A row a task opened reads the conversation of the node it stands for; any other row, the CLI's own subagent. */
    override async subagent(clientId: string, payload: ChatSubagentPayload): Promise<ChatSubagentResult> {
        const childId = this.taskChildOf(payload.chatId, payload.toolUseId);
        if (childId !== null) {
            return this.childConversation(clientId, payload, childId);
        }
        return super.subagent(clientId, payload);
    }

    /* A task's row stands for a node, which `stopNode` stops as a node is stopped. */
    override async stopSubagent(chatId: string, toolUseId: string, stopNode?: (nodeId: string, reason: string) => Promise<void>): Promise<void> {
        await this.loaded(chatId);
        const row = this.require(chatId).thread.find('subagent', (item) => item.toolUseId === toolUseId);
        if (row?.origin === 'ruimte' && row.status === 'running') {
            if (row.childId === undefined || !stopNode) {
                throw new ChatError('chat-unsupported', 'This task cannot be stopped from here; stop its node instead');
            }
            await stopNode(row.childId, STOPPED_TASK_REASON);
            return;
        }
        await super.stopSubagent(chatId, toolUseId);
    }

    override async subagentItems(chatId: string, toolUseId: string): Promise<ChatItem[]> {
        const childId = this.taskChildOf(chatId, toolUseId);
        if (childId !== null) {
            return (await this.childChat(childId)).thread.list();
        }
        return super.subagentItems(chatId, toolUseId);
    }

    /* Writes the row of a task into the chat that gave it, when that chat is loaded; loading it lays every row down anyway. */
    syncTaskRow(task: Task): void {
        const session = this.chats.get(task.parentId);
        if (session) {
            this.upsertTaskRow(session, task);
        }
    }

    /* Opens the turn a fork writes its summary in, loading the fork when nobody has; null while a turn is in the way. */
    async openSummaryTurn(chatId: string, wake: { text: string; label: string; note: string; summaryFor: string }): Promise<string | null> {
        await this.loaded(chatId);
        if (!this.chats.has(chatId)) {
            if (!(await this.hasStored(chatId))) {
                throw new ChatError('chat-not-found', `No chat ${chatId}`);
            }
            await this.create({ chatId });
        }
        return this.require(chatId).wake({ ...wake, taskIds: [] });
    }

    /*
     * Removes what a fork nobody ever wrote in leaves behind once its node is gone: the record and the
     * transcript copy made for it. A loaded chat goes through `kill`; a fork that has turns of its
     * own is a conversation, and a worktree is never removed on its own.
     */
    async dropUnspokenFork(chatId: string): Promise<void> {
        await this.loaded(chatId);
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

    /*
     * The turn to go on after under another account: the chat's last one, which stopped on a limit.
     * `inPlace` says whether that account reads the chat's conversation, which is when the chat itself
     * can go on under it. Refuses an account it cannot start, and a chat with nothing to go on after.
     */
    async limitedTurnFor(chatId: string, account: string): Promise<{ turnId: string; limit: ChatTurnLimit['kind']; inPlace: boolean }> {
        await this.loaded(chatId);
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
        session?.continuedElsewhere(continuedInForkNote(this.accountLabel(session.info.provider, account)));
    }

    protected override instructionsFor(chatId: string): string {
        return chatPrompt({
            sources: this.contextSources(chatId),
            depth: this.depthOf(chatId),
            standalone: this.standalone(chatId),
            computer: this.computer()
        });
    }

    protected override resumeNoteFor(chatId: string): string | null {
        return contextPrompt(this.contextSources(chatId));
    }

    protected override promptNotesFor(chatId: string): PromptNotes {
        return new ContextNotes(
            () => this.contextSources(chatId),
            () => this.messages(chatId)
        );
    }

    protected override referencesFor(chatId: string): ChatReferences {
        return (ids) => {
            const references = resolveChatReferences(ids, (id) => this.chatTitle(chatId, id));
            return { ids: references.map((reference) => reference.id), note: chatReferenceNote(references) };
        };
    }

    /* A token per load of the chat, which the CLI's `ruimte-context` presents to the daemon. */
    protected override envFor(chatId: string, base: Record<string, string>): Record<string, string> {
        if (this.contextUrl === null) {
            return base;
        }
        const token = randomBytes(24).toString('base64url');
        this.tokens.set(token, chatId);
        return { ...base, RUIMTE_CONTEXT_URL: this.contextUrl, RUIMTE_CONTEXT_TOKEN: token };
    }

    protected override admit(chatId: string, cwd: string): Promise<void> {
        return this.checkCwd(chatId, cwd);
    }

    protected override openingSelection(chatId: string, kind: AgentKind): ModelSelection | undefined {
        return this.opening(chatId, kind);
    }

    protected override runtimeModeFor(chatId: string, mode: RuntimeMode): RuntimeMode {
        const ceiling = this.modeCeiling(chatId);
        return ceiling === null ? mode : narrowerMode(mode, ceiling);
    }

    protected override async opened(session: ChatSession, stored: ChatRecord | null): Promise<void> {
        const chatId = session.id;
        this.clearedTasks.set(chatId, new Set(clearedTaskIdsOf(stored?.extras ?? {})));
        for (const task of this.taskRows(chatId)) {
            this.upsertTaskRow(session, task);
        }
        /* A message that landed while nobody held this chat is in the thread before its first prompt,
           so a person reads it here; the model still hears it from the queue, in front of that prompt. */
        try {
            for (const text of await this.unshownMessages(chatId)) {
                session.addNote('info', text);
            }
        } catch (e) {
            // The messages themselves wait in the queue either way, and a chat must open regardless.
            console.error(`Showing the messages left for chat ${chatId} failed:`, errorText(e));
        }
        // Send before returning info so attach includes the initial prompt as the thread's first message.
        const prompt = await this.firstPrompt(chatId);
        if (prompt !== null) {
            try {
                session.send(prompt);
            } catch (e) {
                // A CLI that will not start must not take chat.create down with it: the node is there either way.
                console.error(`The first prompt of chat ${chatId} failed:`, errorText(e));
            }
        }
    }

    protected override recordExtras(chatId: string): ChatRecordExtras {
        return clearedExtras(this.clearedTasks.get(chatId));
    }

    /* A cleared chat hides the rows of the tasks it gave, and loses its plans and what those tasks still owed it. */
    protected override async cleared(chatId: string): Promise<void> {
        const cleared = this.clearedTasks.get(chatId) ?? new Set<string>();
        for (const task of this.taskRows(chatId)) {
            cleared.add(task.id);
        }
        this.clearedTasks.set(chatId, cleared);
        await Promise.all([this.plans?.removeChat(chatId), this.dropWakes(chatId)]);
    }

    protected override forgotten(chatId: string): void {
        for (const [key, hold] of this.childHolds) {
            if (hold.parentId === chatId) {
                this.childHolds.delete(key);
            }
        }
        for (const [token, id] of this.tokens) {
            if (id === chatId) {
                this.tokens.delete(token);
            }
        }
        this.clearedTasks.delete(chatId);
    }

    protected override async removed(chatId: string, chat: { info: ChatInfo; items: ChatItem[] }): Promise<void> {
        await Promise.all([this.plans?.removeChat(chatId), this.dropForkCopy(chat)]);
    }

    /* A client following a task's node hears whenever an item of that node's thread lands; a delta alone does not. */
    protected override broadcasted(chatId: string, event: ChatEvent): void {
        if (event.type === 'delta') {
            return;
        }
        for (const hold of this.childHolds.values()) {
            if (hold.childId === chatId) {
                for (const clientId of hold.clients) {
                    this.sinks.to(clientId, { event: 'chat.subagentChanged', payload: { chatId: hold.parentId, toolUseId: hold.toolUseId } });
                }
            }
        }
    }

    protected override endedAt(chatId: string): number | null {
        return this.ended(chatId);
    }

    protected override unownedReason(): string {
        return 'no project holds this chat any more';
    }

    /* A resumed agent that keeps a plan hears where to find it, since the restart may have cut it off in the middle of one. */
    protected override async resumeWords(chatId: string): Promise<ResumeWords> {
        const open = await (this.plans?.hasOpenSteps(chatId) ?? Promise.resolve(false)).catch((e: unknown) => {
            console.error(`Reading the plans of chat ${chatId} failed:`, errorText(e));
            return false;
        });
        return { prompt: RESUME_PROMPT, note: 'Resumed after the machine restarted', preamble: open ? PLAN_RESUME_PREAMBLE : null };
    }

    private upsertTaskRow(session: ChatSession, task: Task): void {
        if (this.clearedTasks.get(session.id)?.has(task.id)) {
            return;
        }
        session.upsertItems(taskRowItems(session, task));
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

    /* The node a row of this chat stands for when a task opened it, or null for a subagent of the CLI's own. */
    private taskChildOf(chatId: string, toolUseId: string): string | null {
        const row = this.chats.get(chatId)?.thread.find('subagent', (item) => item.toolUseId === toolUseId);
        return row?.origin === 'ruimte' && row.childId !== undefined ? row.childId : null;
    }

    private async childChat(childId: string): Promise<ChatSession> {
        await this.loaded(childId);
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
}

/* A fork with no turn after the one it was cut at: nobody wrote in it, so its CLI never touched the copy. */
export const unspokenFork = (items: readonly ChatItem[], info: ChatInfo): boolean => {
    const forkOf = info.forkOf;
    if (forkOf === undefined) {
        return false;
    }
    const turns = items.filter((item) => item.kind === 'turn');
    return turns.at(-1)?.id === forkOf.turnId;
};

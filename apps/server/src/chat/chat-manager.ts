import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
    AgentKind,
    ChatAttachment,
    ChatCreatePayload,
    ChatEvent,
    ChatInfo,
    ChatItem,
    ChatNoteMessage,
    ChatSubagentPayload,
    ChatSubagentResult,
    ChatSubagentItem,
    ChatTurnLimit,
    ChatUiLinkPayload,
    ChatUiLinkReading,
    ChatUiQueryPayload,
    ChatUiQueryReading,
    ChatVisual,
    ContextSource,
    RuntimeMode,
    Task
} from '@ruimte/contracts';
import { HOST_TASK_ORIGIN } from '@ruimte/contracts';
import { ChatCore, type ChatCoreOptions, claudeProjectSlug, limitedTurn } from '@adecore/agents/chat';
import type { ChatReferences, ChatSession, PromptNotes, ResumeWords, ChatRecord, ChatRecordExtras } from '@adecore/agents/chat';
import { storedAccount, narrowerMode, type AccountUnusable } from '@adecore/agents/providers';
import { attachedReferences, type Reference } from '../context/references.ts';
import {
    chatNote,
    chatPrompt,
    contextChangeNote,
    contextPrompt,
    designMovedNote,
    type ChatPromptOptions,
    VISUAL_RESUME_NOTE
} from '../context/context-note.ts';
import { errorText } from '../error-text.ts';
import { passedOverNote, type ProjectAccountChooser } from '../projects/project-accounts.ts';
import { RUIMTE_CODEX_CLIENT } from '../providers/codex-provider.ts';
import { continueOnWake, continuedInForkNote } from './continue-on.ts';
import { AgentImages } from './agent-images.ts';
import { appleHomeOf, removeAppleSession } from './apple-sessions.ts';
import { ChatError } from './errors.ts';
import { RUIMTE_UI_FENCE } from './ui-fence.ts';
import { InlineEditNotes } from './inline-edit.ts';
import type { FirstPrompt } from '../agents/pending-prompts.ts';
import { TurnUsage } from '../stats/turn-usage.ts';
import { countChatStarted } from '../stats/usage-stats.ts';
import { prependPath } from '../env-path.ts';

export type { InterruptedRun } from '@adecore/agents/chat';

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
    // Whether agents may reach the machine's other open projects, read when a chat's CLI starts.
    reachOpenProjects?: () => boolean;
    // Whether an agent may show a page above its reply, read when a chat's CLI starts.
    visualReplies?: () => boolean;
    // Whether the chat's project has database connections, read when a chat's CLI starts.
    databases?: (chatId: string) => boolean;
    // A client may open an agent before its outbox start; the planned configuration wins over client defaults.
    openingAgent?: (chatId: string) => ChatCreatePayload | undefined;
    // The sources themselves, so a chat can name them to its agent and tell it what came and went between turns.
    contextSources?: (chatId: string) => ContextSource[];
    // A view, node or text of the chat's own project, for a message a person attached it to; null for any other id.
    reference?: (chatId: string, id: string) => Reference | null;
    // What another node left for this chat, taken once and put in front of the next prompt (`NoticeNotes`).
    messageNotes?: (chatId: string) => PromptNotes;
    // The same messages, as the lines a person reads in the thread; asked once, when the chat is loaded.
    unshownMessages?: (chatId: string) => Promise<{ text: string; message: ChatNoteMessage }[]>;
    // The prompt an agent node was made with, taken once; it becomes the thread's first message, and its brief is heard beside it.
    firstPrompt?: (chatId: string) => Promise<FirstPrompt | null>;
    // When stopping the agent that opened a chat ended it too; a turn from before that is never resumed.
    endedAt?: (chatId: string) => number | null;
    // Whether the chat is the hidden one an inline edit runs in, which hears how to answer and is no list's business.
    inlineChat?: (chatId: string) => boolean;
    // The folder a chat works on as a design and whether that design stands on a canvas, which it hears about when its CLI starts; null for any other chat.
    design?: (chatId: string) => { folder: string; onCanvas: boolean } | null;
    // Told each time a turn of a chat ends, so a design folder that moved during it takes in what the turn still wrote to the old one.
    turnEnded?: (chatId: string) => void;
    // The tasks a chat gave, so a chat loaded from disk shows a row for each even when a crash lost the write of one.
    taskRows?: (chatId: string) => Task[];
    // A cleared chat is a conversation that gave no task, so what it gave before wakes it no more; the rows stay for a person.
    dropWakes?: (chatId: string) => Promise<void>;
    endChildren?: (chatId: string) => Promise<unknown>;
    plans?: ChatPlans;
    // The widest mode this chat may run in, whatever its record or its node says; null for no limit.
    modeCeiling?: (chatId: string) => RuntimeMode | null;
    // Whether another machine gave this chat its task, which then never runs on the configuration the files it sent carry.
    peerChat?: (chatId: string) => boolean;
    // Refuses a directory this chat may not start in, asked every time a chat is loaded.
    checkCwd?: (chatId: string, cwd: string) => Promise<void>;
    // Whether the client holds the project the chat is in; a UI block reads and links only for one that does.
    holdsProject?: (chatId: string, clientId: string) => Promise<boolean>;
    // The account a new chat in a project takes, or null where its project says nothing about the CLI.
    projectAccount?: ProjectAccountChooser;
}

/* The environment every CLI of a chat starts in: the daemon's own, without a terminal's hook variables, with `ruimte-context` on the PATH. */
function chatEnvOf(env: Record<string, string | undefined>, binDir: string | undefined): Record<string, string> {
    const chat: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        // The hook variables belong to terminal sessions; a chat reports through its own stream.
        if (value !== undefined && !key.startsWith('RUIMTE_HOOK_')) {
            chat[key] = value;
        }
    }
    if (binDir) {
        prependPath(chat, binDir);
    }
    return chat;
}

export const BRIEF_TITLE = 'Instructions from Ruimte';

/*
 * What a chat hears in front of a prompt: Ruimte's brief for that prompt, a link made or removed since
 * the last one, and what another node left for it. The brief goes first, so its title is the line the
 * thread's note shows folded.
 */
class ContextNotes implements PromptNotes {
    private readonly sources: () => ContextSource[];
    private readonly messages: PromptNotes | null;
    private readonly takeBrief: () => string | null;
    private readonly designFolder: () => string | null;
    // The links at the previous prompt; null before the first, whose CLI hears about them at launch.
    private last: ContextSource[] | null = null;
    // The design folder at the previous prompt, the same way: a design that moved in between is told where it went.
    private lastFolder: string | null = null;

    constructor(sources: () => ContextSource[], messages: PromptNotes | null, takeBrief: () => string | null, designFolder: () => string | null) {
        this.sources = sources;
        this.messages = messages;
        this.takeBrief = takeBrief;
        this.designFolder = designFolder;
    }

    next(): { shown: string[]; heard: string[] } {
        const current = this.sources();
        const previous = this.last;
        this.last = current;
        const folder = this.designFolder();
        const moved = previous === null ? null : designMovedNote(this.lastFolder, folder);
        this.lastFolder = folder;
        const brief = this.takeBrief();
        const change = previous === null ? null : contextChangeNote(previous, current);
        const messages = this.messages?.next() ?? { shown: [], heard: [] };
        return {
            shown: [
                ...(brief === null ? [] : [`${BRIEF_TITLE}\n${brief}`]),
                ...(moved === null ? [] : [moved]),
                ...(change === null ? [] : [change]),
                ...messages.shown
            ],
            heard: messages.heard
        };
    }

    reset(): void {
        this.last = null;
        this.lastFolder = null;
        this.messages?.reset();
    }
}

/* The rows of tasks a clear hid, as the record keeps them beside the thread. */
function clearedExtras(ids: ReadonlySet<string> | undefined): ChatRecordExtras {
    return ids === undefined || ids.size === 0 ? {} : { clearedTaskIds: [...ids] };
}

function clearedTaskIdsOf(extras: ChatRecordExtras): string[] {
    return Array.isArray(extras.clearedTaskIds) ? extras.clearedTaskIds.filter((id): id is string => typeof id === 'string') : [];
}

function noteDigest(note: string): string {
    return createHash('sha256').update(note).digest('hex').slice(0, 16);
}

/*
 * The chat row of a task in the thread of the chat that gave it, written from the task alone so writing
 * it twice changes nothing. A new row joins the turn that is running, which is the turn that ran the
 * verb; a cancelled task gets a note saying why its row failed.
 */
function taskRowItems(session: ChatSession, task: Task): ChatItem[] {
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
        origin: HOST_TASK_ORIGIN,
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
}

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
    private readonly reachOpenProjects: () => boolean;
    private readonly visualReplies: () => boolean;
    private readonly databases: (chatId: string) => boolean;
    private readonly opening: NonNullable<ChatManagerOptions['openingAgent']>;
    private readonly contextSources: (chatId: string) => ContextSource[];
    private readonly reference: (chatId: string, id: string) => Reference | null;
    private readonly messageNotes: ((chatId: string) => PromptNotes) | null;
    private readonly unshownMessages: (chatId: string) => Promise<{ text: string; message: ChatNoteMessage }[]>;
    private readonly firstPrompt: (chatId: string) => Promise<FirstPrompt | null>;
    // Ruimte's instructions for a chat's next prompt, handed out once (`ContextNotes`).
    private readonly briefs = new Map<string, string>();
    private readonly inlineChat: (chatId: string) => boolean;
    private readonly design: (chatId: string) => { folder: string; onCanvas: boolean } | null;
    private readonly turnEnded: (chatId: string) => void;
    private readonly modeCeiling: (chatId: string) => RuntimeMode | null;
    private readonly peerChat: (chatId: string) => boolean;
    private readonly checkCwd: (chatId: string, cwd: string) => Promise<void>;
    private readonly holdsProject: (chatId: string, clientId: string) => Promise<boolean>;
    private readonly ended: (chatId: string) => number | null;
    private readonly taskRows: (chatId: string) => Task[];
    private readonly dropWakes: (chatId: string) => Promise<void>;
    private readonly endChildren: (chatId: string) => Promise<unknown>;
    private readonly plans: ChatPlans | null;
    private readonly appleHome: string;
    private readonly agentImages: AgentImages;
    private readonly tokens = new Map<string, string>();
    // The tasks whose rows a clear hid, per chat.
    private readonly clearedTasks = new Map<string, Set<string>>();
    /* The digest of the note each chat's thread last took in, kept in its record as `instructions`. */
    private readonly instructed = new Map<string, string>();
    /* The project default a new chat passed over and why, from its start until it opens. */
    private readonly passedOver = new Map<string, { account: string; reason: AccountUnusable }>();
    private readonly projectAccount: ProjectAccountChooser;
    private readonly turnUsage = new TurnUsage();
    // Clients following the conversation of a node a task opened, per row of the chat that gave it.
    private readonly childHolds = new Map<string, { parentId: string; toolUseId: string; childId: string; clients: Set<string> }>();

    constructor(options: ChatManagerOptions) {
        super({
            codexClient: RUIMTE_CODEX_CLIENT,
            uiFenceLanguage: RUIMTE_UI_FENCE,
            ...options,
            env: chatEnvOf(options.env ?? process.env, options.binDir),
            hooks: {
                instructionsFor: (chatId) => this.instructionsFor(chatId),
                resumeNoteFor: (chatId) => this.resumeNoteFor(chatId),
                resumeInstructionsFor: (chatId) => this.resumeInstructionsFor(chatId),
                foldersFor: (chatId) => this.foldersFor(chatId),
                projectConfigFor: (chatId) => !this.peerChat(chatId),
                promptNotesFor: (chatId) => this.promptNotesFor(chatId),
                hiddenFor: (chatId) => this.inlineChat(chatId),
                referencesFor: (chatId) => this.referencesFor(chatId),
                envFor: (chatId, base) => this.envFor(chatId, base),
                admit: (chatId, cwd) => this.checkCwd(chatId, cwd),
                runtimeModeFor: (chatId, mode) => this.runtimeModeFor(chatId, mode),
                openingAccount: (chatId, kind, named) => this.openingAccountOf(chatId, kind, named),
                opened: (session, stored) => this.opened(session, stored),
                recordExtras: (chatId) => {
                    const digest = this.instructed.get(chatId);
                    return { ...clearedExtras(this.clearedTasks.get(chatId)), ...(digest === undefined ? {} : { instructions: digest }) };
                },
                clearing: async (chatId) => {
                    await this.endChildren(chatId);
                },
                cleared: (chatId) => this.cleared(chatId),
                forgotten: (chatId) => this.forgotten(chatId),
                removed: (chatId, chat) => this.removed(chatId, chat),
                broadcasted: (chatId, event) => this.broadcasted(chatId, event),
                endedAt: (chatId) => this.ended(chatId),
                unownedReason: () => 'no project holds this chat any more',
                resumeWords: (chatId) => this.resumeWords(chatId)
            }
        });
        this.contextUrl = options.contextUrl ?? null;
        this.depthOf = options.depthOf ?? (() => 0);
        this.standalone = options.standalone ?? (() => false);
        this.computer = options.computer ?? (() => false);
        this.reachOpenProjects = options.reachOpenProjects ?? (() => false);
        this.visualReplies = options.visualReplies ?? (() => false);
        this.databases = options.databases ?? (() => false);
        this.opening = options.openingAgent ?? (() => undefined);
        this.contextSources = options.contextSources ?? (() => []);
        this.reference = options.reference ?? (() => null);
        this.messageNotes = options.messageNotes ?? null;
        this.unshownMessages = options.unshownMessages ?? (() => Promise.resolve([]));
        this.firstPrompt = options.firstPrompt ?? (() => Promise.resolve(null));
        this.inlineChat = options.inlineChat ?? (() => false);
        this.design = options.design ?? (() => null);
        this.turnEnded = options.turnEnded ?? (() => undefined);
        this.modeCeiling = options.modeCeiling ?? (() => null);
        this.peerChat = options.peerChat ?? (() => false);
        this.checkCwd = options.checkCwd ?? (() => Promise.resolve());
        this.holdsProject = options.holdsProject ?? (() => Promise.resolve(true));
        this.projectAccount = options.projectAccount ?? (() => null);
        this.ended = options.endedAt ?? (() => null);
        this.taskRows = options.taskRows ?? (() => []);
        this.dropWakes = options.dropWakes ?? (() => Promise.resolve());
        this.endChildren = options.endChildren ?? (() => Promise.resolve());
        this.plans = options.plans ?? null;
        this.appleHome = appleHomeOf(options.env ?? process.env);
        this.agentImages = new AgentImages(options.attachments);
    }

    chatIdForToken(token: string): string | null {
        return this.tokens.get(token) ?? null;
    }

    override create(payload: ChatCreatePayload): Promise<ChatInfo> {
        return super.create({ ...payload, ...this.opening(payload.chatId) });
    }

    forkSource(chatId: string): Promise<{ info: ChatInfo; items: ChatItem[] } | null> {
        return this.readChat(chatId);
    }

    /* Also takes back the plans the fork was given and the helper's own conversation, beside what the core removes. */
    override async deleteRecord(chatId: string): Promise<boolean> {
        // Read before the record goes, since only the record names the helper's session; a loaded chat is `kill`'s.
        const stored = this.get(chatId) ? null : await this.readChat(chatId).catch(() => null);
        const deleted = await super.deleteRecord(chatId);
        if (deleted) {
            await Promise.all([this.plans?.removeChat(chatId), stored === null ? undefined : removeAppleSession(this.appleHome, stored.info)]);
        }
        return deleted;
    }

    /* Gives a fork the plans of the chat it was forked from. */
    async copyPlans(fromChatId: string, toChatId: string): Promise<void> {
        await this.plans?.copyChat(fromChatId, toChatId);
    }

    /* Gives a fork the bookmarks on the messages it copied. */
    async copyBookmarks(fromChatId: string, toChatId: string, itemIds: ReadonlySet<string>): Promise<void> {
        await this.bookmarks?.copyChat(fromChatId, toChatId, (itemId) => itemIds.has(itemId));
    }

    /* Gives a fork the visuals `keep` picks, each with a page of its own. */
    async copyVisuals(fromChatId: string, toChatId: string, keep: (visual: ChatVisual) => boolean): Promise<void> {
        await this.visuals?.copyChat(fromChatId, toChatId, keep);
    }

    /*
     * The file behind an attachment id, also of a chat nobody loaded since the daemon started: a
     * visual's page is known to the store only once it read that chat's list, and an image an agent
     * attached is found by its id in the chat's folder.
     */
    async findAttachment(chatId: string, id: string): Promise<ChatAttachment | null> {
        const found = this.attachment(chatId, id);
        if (found !== null) {
            return found;
        }
        if (this.visuals) {
            // Reading the list is what lets the store answer for the pages of that chat.
            await this.visuals.list(chatId).catch(() => []);
            const page = this.visuals.attachment(chatId, id);
            if (page !== null) {
                return page;
            }
        }
        return this.agentImages.find(chatId, id);
    }

    /* Makes an image an agent has of its own an attachment of its chat; the bytes are checked by the caller. */
    attachAgentImage(chatId: string, upload: { name: string; mime: string; bytes: Uint8Array }): Promise<ChatAttachment> {
        return this.agentImages.save(chatId, upload);
    }

    /* Gives a fork the images the original's agent attached. */
    copyAgentImages(fromChatId: string, toChatId: string): Promise<void> {
        return this.agentImages.copy(fromChatId, toChatId);
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
        if (row?.origin === HOST_TASK_ORIGIN && row.status === 'running') {
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
        const session = this.get(task.parentId);
        if (session) {
            this.upsertTaskRow(session, task);
        }
    }

    /* Opens the turn a fork writes its summary in, loading the fork when nobody has; null while a turn is in the way. */
    async openSummaryTurn(chatId: string, wake: { text: string; label: string; note: string; summaryFor: string }): Promise<string | null> {
        if (!(await this.loadStored(chatId))) {
            throw new ChatError('chat-not-found', `No chat ${chatId}`);
        }
        return this.require(chatId).wake({ ...wake, taskIds: [] });
    }

    /* Loads a chat nobody holds from its record; false when it has none. */
    private async loadStored(chatId: string): Promise<boolean> {
        await this.loaded(chatId);
        if (this.get(chatId)) {
            return true;
        }
        if (!(await this.hasStored(chatId))) {
            return false;
        }
        await this.create({ chatId });
        return true;
    }

    /*
     * Removes what a fork nobody ever wrote in leaves behind once its node is gone: the record and the
     * transcript copy made for it. A loaded chat goes through `kill`; a fork that has turns of its
     * own is a conversation, and a worktree is never removed on its own.
     */
    async dropUnspokenFork(chatId: string): Promise<void> {
        await this.loaded(chatId);
        if (this.get(chatId)) {
            return;
        }
        const stored = await this.readChat(chatId);
        if (stored === null || !unspokenFork(stored.items, stored.info)) {
            return;
        }
        await Promise.all([this.deleteRecord(chatId), this.dropForkCopy(stored)]);
    }

    /*
     * Removes a chat nobody loaded and what is kept for it, the way a deleted node takes an unspoken
     * fork along: false, with nothing removed, for a loaded chat. A worktree is never removed.
     */
    async dropStored(chatId: string): Promise<boolean> {
        await this.loaded(chatId);
        if (this.get(chatId)) {
            return false;
        }
        const stored = await this.readChat(chatId);
        const [deleted] = await Promise.all([this.deleteRecord(chatId), stored === null ? undefined : this.dropForkCopy(stored)]);
        return deleted;
    }

    /*
     * The turn to go on after under another account: the chat's last one, which stopped on a limit.
     * `inPlace` says whether that account reads the chat's conversation, which is when the chat itself
     * can go on under it. Refuses an account it cannot start, and a chat with nothing to go on after.
     */
    async limitedTurnFor(chatId: string, account: string): Promise<{ turnId: string; limit: ChatTurnLimit['kind']; inPlace: boolean }> {
        await this.loadStored(chatId);
        const session = this.require(chatId);
        const { provider: kind, account: from } = session.info;
        const to = storedAccount(kind, account);
        if (to === from) {
            throw new ChatError('same-account', `The chat already runs under the account '${this.accountLabel(kind, to)}'`);
        }
        // As named and not as stored, which reads the default account as none: a turned-off default account is refused, and one the chat's project turned off.
        this.projectAccount(chatId, kind, account);
        this.requireAccount(kind, account);
        if (session.info.activeTurnId !== null) {
            throw new ChatError('chat-busy', 'The chat is working on a turn; go on under another account once it ends');
        }
        const turn = limitedTurn(session.thread.list());
        if (turn === null) {
            throw new ChatError('not-limited', 'The last turn of this chat did not stop on a limit');
        }
        return { turnId: turn.id, limit: turn.limit.kind, inPlace: this.canContinue(kind, from, to) };
    }

    // Attached to a chat is not enough: a UI block reads the project's git, launches and databases.
    override async linkUi(payload: ChatUiLinkPayload, clientId: string): Promise<ChatUiLinkReading> {
        await this.requireHeldProject(payload.chatId, clientId);
        return super.linkUi(payload, clientId);
    }

    override async queryUi(payload: ChatUiQueryPayload, clientId: string): Promise<ChatUiQueryReading> {
        await this.requireHeldProject(payload.chatId, clientId);
        return super.queryUi(payload, clientId);
    }

    private async requireHeldProject(chatId: string, clientId: string): Promise<void> {
        if (!(await this.holdsProject(chatId, clientId))) {
            throw new ChatError('refused-query', "Open this chat's project before reading its UI.");
        }
    }

    /*
     * Runs a synchronous wake of the chat with Ruimte's brief beside its text: heard on that turn, and folded
     * in its thread as a note. A wake hears its notes before it returns, so a brief still here was refused.
     */
    withBrief<T>(chatId: string, brief: string | undefined, wake: () => T): T {
        if (brief === undefined) {
            return wake();
        }
        this.briefs.set(chatId, brief);
        try {
            return wake();
        } finally {
            this.briefs.delete(chatId);
        }
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
        // Another account needs another CLI, and the one there is still runs work or waits on a request.
        if (session.replacementWouldWait) {
            throw new ChatError('chat-busy', 'This chat still runs work in the background or waits on a request; go on under another account once that ends');
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
        const session = this.get(chatId);
        session?.continuedElsewhere(continuedInForkNote(this.accountLabel(session.info.provider, account)));
    }

    private promptOptions(chatId: string): ChatPromptOptions {
        return {
            sources: this.contextSources(chatId),
            depth: this.depthOf(chatId),
            standalone: this.standalone(chatId),
            computer: this.computer(),
            // An inline edit answers with one replacement block, which a page above it would only contradict.
            visuals: this.visualReplies() && !this.inlineChat(chatId),
            databases: !this.inlineChat(chatId) && this.databases(chatId),
            reach: !this.inlineChat(chatId) && this.reachOpenProjects(),
            design: this.design(chatId)
        };
    }

    private instructionsFor(chatId: string): string {
        return chatPrompt(this.promptOptions(chatId));
    }

    /*
     * Codex keeps the developer instructions its thread started with, so a thread that took in another note
     * hears this one again, once. A thread without a digest began before Ruimte kept one, and hears it too.
     */
    private resumeInstructionsFor(chatId: string): string | null {
        const note = chatNote(this.promptOptions(chatId));
        const digest = noteDigest(note);
        const known = this.instructed.get(chatId);
        this.instructed.set(chatId, digest);
        const resumes = (this.get(chatId)?.info.agentSessionId ?? null) !== null;
        return resumes && known !== digest ? note : null;
    }

    private resumeNoteFor(chatId: string): string | null {
        const context = contextPrompt(this.contextSources(chatId));
        const visuals = this.visualReplies() && !this.inlineChat(chatId) ? VISUAL_RESUME_NOTE : null;
        return [context, visuals].filter((part) => part !== null).join(' ') || null;
    }

    private foldersFor(chatId: string): readonly string[] {
        if (!this.visuals || !this.visualReplies() || this.inlineChat(chatId)) {
            return [];
        }
        const path = this.visuals.workspacePath(chatId);
        // Claude validates --add-dir at startup, including the first turn after a chat was cleared.
        mkdirSync(path, { recursive: true, mode: 0o700 });
        return [path];
    }

    private promptNotesFor(chatId: string): PromptNotes {
        const takeBrief = (): string | null => {
            const brief = this.briefs.get(chatId) ?? null;
            this.briefs.delete(chatId);
            return brief;
        };
        const notes = new ContextNotes(
            () => this.contextSources(chatId),
            this.messageNotes?.(chatId) ?? null,
            takeBrief,
            () => this.design(chatId)?.folder ?? null
        );
        return this.inlineChat(chatId) ? new InlineEditNotes(notes) : notes;
    }

    private referencesFor(chatId: string): ChatReferences {
        return (attached) => attachedReferences(attached, (id: string): Reference | null => this.reference(chatId, id));
    }

    /* A token per load of the chat, which the CLI's `ruimte-context` presents to the daemon. */
    private envFor(chatId: string, base: Record<string, string>): Record<string, string> {
        if (this.contextUrl === null) {
            return base;
        }
        const token = randomBytes(24).toString('base64url');
        this.tokens.set(token, chatId);
        return { ...base, RUIMTE_CONTEXT_URL: this.contextUrl, RUIMTE_CONTEXT_TOKEN: token };
    }

    private runtimeModeFor(chatId: string, mode: RuntimeMode): RuntimeMode {
        const ceiling = this.modeCeiling(chatId);
        return ceiling === null ? mode : narrowerMode(mode, ceiling);
    }

    /* The project's account for a new chat, remembering a default it passed over so the chat can say so once it opens. */
    private openingAccountOf(chatId: string, kind: AgentKind, named: string | undefined): string | undefined {
        const chosen = this.projectAccount(chatId, kind, named);
        if (chosen === null) {
            return undefined;
        }
        // A chat that is already open asks for another start of its own, such as a fork, which gets no note.
        if (chosen.passedOver && !this.get(chatId)) {
            this.passedOver.set(chatId, chosen.passedOver);
        }
        return chosen.account;
    }

    private async opened(session: ChatSession, stored: ChatRecord | null): Promise<void> {
        const chatId = session.id;
        const passed = this.passedOver.get(chatId);
        this.passedOver.delete(chatId);
        if (stored === null) {
            countChatStarted(session.info.provider);
            if (passed) {
                const { provider, account } = session.info;
                session.addNote('info', passedOverNote(this.accountLabel(provider, account), this.accountLabel(provider, passed.account), passed.reason));
            }
        }
        this.clearedTasks.set(chatId, new Set(clearedTaskIdsOf(stored?.extras ?? {})));
        const digest = stored?.extras.instructions;
        if (typeof digest === 'string') {
            this.instructed.set(chatId, digest);
        }
        for (const task of this.taskRows(chatId)) {
            this.upsertTaskRow(session, task);
        }
        // A message that landed while nobody held this chat shows here; the model hears it from the queue.
        try {
            for (const { text, message } of await this.unshownMessages(chatId)) {
                session.addNote('info', text, message);
            }
        } catch (e) {
            // The messages wait in the queue either way, and a chat must open regardless.
            console.error(`Showing the messages left for chat ${chatId} failed:`, errorText(e));
        }
        // Send before returning info so attach includes the initial prompt as the thread's first message.
        const first = await this.firstPrompt(chatId);
        if (first !== null) {
            // Left in place after the send: a send that queues hears its notes only when the queue lets it go.
            if (first.brief !== undefined) {
                this.briefs.set(chatId, first.brief);
            }
            try {
                session.send(first.prompt, first.picked ?? {});
            } catch (e) {
                this.briefs.delete(chatId);
                // A CLI that will not start must not take chat.create down with it: the node is there either way.
                console.error(`The first prompt of chat ${chatId} failed:`, errorText(e));
            }
        }
    }

    /* A cleared chat hides the rows of the tasks it gave, and loses its plans and what those tasks still owed it. */
    private async cleared(chatId: string): Promise<void> {
        const cleared = this.clearedTasks.get(chatId) ?? new Set<string>();
        for (const task of this.taskRows(chatId)) {
            cleared.add(task.id);
        }
        this.clearedTasks.set(chatId, cleared);
        await Promise.all([this.plans?.removeChat(chatId), this.dropWakes(chatId)]);
    }

    private forgotten(chatId: string): void {
        this.briefs.delete(chatId);
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
        this.instructed.delete(chatId);
        this.turnUsage.forget(chatId);
    }

    private async removed(chatId: string, chat: { info: ChatInfo; items: ChatItem[] }): Promise<void> {
        await Promise.all([this.plans?.removeChat(chatId), this.dropForkCopy(chat), removeAppleSession(this.appleHome, chat.info)]);
    }

    /* A client following a task's node hears whenever an item of that node's thread lands; a delta alone does not. */
    private broadcasted(chatId: string, event: ChatEvent): void {
        const info = this.get(chatId)?.info;
        if (event.type === 'delta') {
            if (info !== undefined) {
                this.turnUsage.words(chatId, info.provider);
            }
            return;
        }
        if (event.type === 'item' && event.item.kind === 'turn' && info !== undefined) {
            this.turnUsage.turn(chatId, event.item, info);
        }
        if (event.type === 'item' && event.item.kind === 'turn' && event.item.state !== 'running') {
            this.turnEnded(chatId);
        }
        for (const hold of this.childHolds.values()) {
            if (hold.childId === chatId) {
                for (const clientId of hold.clients) {
                    this.sendTo(clientId, { event: 'chat.subagentChanged', payload: { chatId: hold.parentId, toolUseId: hold.toolUseId } });
                }
            }
        }
    }

    /* A resumed agent that keeps a plan hears where to find it, since the restart may have cut it off in the middle of one. */
    private async resumeWords(chatId: string): Promise<ResumeWords> {
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
        const row = this.get(chatId)?.thread.find('subagent', (item) => item.toolUseId === toolUseId);
        return row?.origin === HOST_TASK_ORIGIN && row.childId !== undefined ? row.childId : null;
    }

    private async childChat(childId: string): Promise<ChatSession> {
        if (!(await this.loadStored(childId))) {
            throw new ChatError('chat-unsupported', 'This task runs in a terminal or has not started; its node shows what it does');
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
        const page = this.history(childId, payload.cursor, payload.limit ?? 60);
        if (payload.watch === true) {
            const hold = this.childHolds.get(key) ?? { parentId: payload.chatId, toolUseId: payload.toolUseId, childId, clients: new Set<string>() };
            hold.clients.add(clientId);
            this.childHolds.set(key, hold);
        }
        return {
            items: page.items,
            history: page.history,
            pending: child.thread.pending(),
            // The closed set a result carries; the child's thread is that CLI's conversation.
            source: child.info.provider === 'codex' ? 'codex-thread' : 'claude-transcript',
            context: { provider: child.info.provider, cwd: child.info.cwd, chatId: childId },
            live: child.info.activeTurnId !== null
        };
    }
}

/* A fork with no turn after the one it was cut at: nobody wrote in it, so its CLI never touched the copy. */
function unspokenFork(items: readonly ChatItem[], info: ChatInfo): boolean {
    return info.forkOf !== undefined && items.findLast((item) => item.kind === 'turn')?.id === info.forkOf.turnId;
}

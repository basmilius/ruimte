import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatCore, type ChatCoreOptions, type ChatSidecar, claudeProjectSlug, limitedTurn, type VisualStore } from '@adecore/agents/chat';
import type { ChatReferences, ChatSession, LostWork, PromptNotes, ResumeWords, ChatRecord } from '@adecore/agents/chat';
import { storedAccount, narrowerMode, type AccountUnusable } from '@adecore/agents/providers';
import type {
    AgentKind,
    ChatAttachment,
    ChatCreatePayload,
    ChatEvent,
    ChatInfo,
    ChatItem,
    ChatNoteMessage,
    ChatTurnLimit,
    ContextSource,
    RuntimeMode,
    Task
} from '@ruimte/contracts';
import type { FirstPrompt } from '../canvas/pending-prompts.ts';
import {
    chatNote,
    chatPrompt,
    contextChangeNote,
    contextPrompt,
    designMovedNote,
    type ChatPromptOptions,
    VISUAL_RESUME_NOTE
} from '../context/context-note.ts';
import { RUIMTE_UI_FENCE } from '../context/ui-fence.ts';
import { errorText } from '../error-text.ts';
import { passedOverNote, type ProjectAccountChooser } from '../projects/project-accounts.ts';
import { attachedReferences, type Reference } from '../projects/references.ts';
import { CHAT_TOKEN_VARIABLE, MCP_URL_VARIABLE, mcpUrlOf } from '../ruimte-mcp.ts';
import { TurnUsage } from '../stats/turn-usage.ts';
import { countChatStarted } from '../stats/usage-stats.ts';
import { AgentImages } from './agent-images.ts';
import { continueOnWake, continuedInForkNote } from './continue-on.ts';
import { ChatError } from './errors.ts';
import { InlineEditNotes } from './inline-edit.ts';

export type { InterruptedRun } from '@adecore/agents/chat';

// What a resumed CLI is told: its transcript ends where the process did, and a tool call that was out is lost to it.
export const RESUME_PROMPT = 'The machine restarted while you were working on the previous message. Continue where you left off.';

// Said in front of a resume when the chat keeps a plan with steps left.
export const PLAN_RESUME_PREAMBLE = 'You keep a plan in this chat: plan_read shows where you were.';

/* The plans kept beside a chat's record, which live and die with the chat, and whether a resumed agent has steps left in them. */
export interface ChatPlans extends ChatSidecar {
    hasOpenSteps(chatId: string): Promise<boolean>;
}

/* What Ruimte's chats ask of the rest of the daemon. Every member is answered by the wiring; a test names the ones it cares about with `quietFacts`. */
export interface ChatFacts {
    // How deep a chat sits in a chain of agents; an unknown chat is one a person opened.
    depthOf(chatId: string): number;
    standalone(chatId: string): boolean;
    // Whether computer use is on for this machine, read when a chat's CLI starts.
    computer(): boolean;
    // Whether agents may reach the machine's other open projects, read when a chat's CLI starts.
    reachOpenProjects(): boolean;
    // Whether an agent may show a page above its reply, read when a chat's CLI starts.
    visualReplies(): boolean;
    // Whether the chat's project has database connections, read when a chat's CLI starts.
    databases(chatId: string): boolean;
    // A client may open an agent before its outbox start; the planned configuration wins over client defaults.
    openingAgent(chatId: string): ChatCreatePayload | undefined;
    // The sources themselves, so a chat can name them to its agent and tell it what came and went between turns.
    contextSources(chatId: string): ContextSource[];
    // A view, node or text of the chat's own project, for a message a person attached it to; null for any other id.
    reference(chatId: string, id: string): Reference | null;
    // What another node left for this chat, taken once and put in front of the next prompt (`NoticeNotes`).
    messageNotes(chatId: string): PromptNotes | null;
    // The same messages, as the lines a person reads in the thread; asked once, when the chat is loaded.
    unshownMessages(chatId: string): Promise<{ text: string; message: ChatNoteMessage }[]>;
    // The prompt an agent node was made with, taken once; it becomes the thread's first message, and its brief is heard beside it.
    firstPrompt(chatId: string): Promise<FirstPrompt | null>;
    // When stopping the agent that opened a chat ended it too; a turn from before that is never resumed.
    endedAt(chatId: string): number | null;
    // Whether the chat is the hidden one an inline edit runs in, which hears how to answer and is no list's business.
    inlineChat(chatId: string): boolean;
    // The folder a chat works on as a design and whether that design stands on a canvas, which it hears about when its CLI starts; null for any other chat.
    design(chatId: string): { folder: string; onCanvas: boolean } | null;
    // Told each time a turn of a chat ends, so a design folder that moved during it takes in what the turn still wrote to the old one.
    turnEnded(chatId: string, state: 'done' | 'aborted' | 'error'): void;
    // The tasks a chat gave, so a chat loaded from disk shows a row for each even when a crash lost the write of one.
    taskRows(chatId: string): Task[];
    // A cleared chat is a conversation that gave no task, so what it gave before wakes it no more; the rows stay for a person.
    dropWakes(chatId: string): Promise<void>;
    endChildren(chatId: string): Promise<unknown>;
    // The widest mode this chat may run in, whatever its record or its node says; null for no limit.
    modeCeiling(chatId: string): RuntimeMode | null;
    // Whether another machine gave this chat its task, which then never runs on the configuration the files it sent carry.
    peerChat(chatId: string): boolean;
    // Refuses a directory this chat may not start in, asked every time a chat is loaded.
    checkCwd(chatId: string, cwd: string): Promise<void>;
    // Whether the client holds the project the chat is in; a UI block reads and links only for one that does.
    holdsProject(chatId: string, clientId: string): Promise<boolean>;
    // The account a new chat in a project takes, or null where its project says nothing about the CLI.
    projectAccount: ProjectAccountChooser;
}

interface ChatManagerOptions extends Omit<ChatCoreOptions, 'hooks' | 'uiFenceLanguage' | 'taskRemovedReason'> {
    // Background work a restart took from a chat that no resumed turn tells; the outbox owes it a wake.
    lostWork?: (chatId: string, lost: LostWork) => Promise<void>;
    // Where an agent reads its linked context, with Ruimte's MCP server beside it.
    contextUrl?: string;
    facts: ChatFacts;
    plans?: ChatPlans;
}

function chatEnvOf(env: Record<string, string | undefined>): Record<string, string> {
    const chat: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        // The hook variables belong to terminal sessions; a chat reports through its own stream.
        if (value !== undefined && !key.startsWith('RUIMTE_HOOK_')) {
            chat[key] = value;
        }
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
    private readonly designFolder: () => string | null;
    // The links at the previous prompt; null before the first, whose CLI hears about them at launch.
    private last: ContextSource[] | null = null;
    // The design folder at the previous prompt, the same way: a design that moved in between is told where it went.
    private lastFolder: string | null = null;

    constructor(sources: () => ContextSource[], messages: PromptNotes | null, designFolder: () => string | null) {
        this.sources = sources;
        this.messages = messages;
        this.designFolder = designFolder;
    }

    next(brief?: string): { shown: string[]; heard: string[] } {
        const current = this.sources();
        const previous = this.last;
        this.last = current;
        const folder = this.designFolder();
        const moved = previous === null ? null : designMovedNote(this.lastFolder, folder);
        this.lastFolder = folder;
        const change = previous === null ? null : contextChangeNote(previous, current);
        const messages = this.messages?.next() ?? { shown: [], heard: [] };
        return {
            shown: [
                ...(brief === undefined ? [] : [`${BRIEF_TITLE}\n${brief}`]),
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

function noteDigest(note: string): string {
    return createHash('sha256').update(note).digest('hex').slice(0, 16);
}

/*
 * Ruimte's chats: the generic core with what the daemon adds to it. A chat runs in a project, hears
 * about the tools and its links, keeps its plans beside its record and forks into the canvas, and a
 * turn cut off by a restart or a limit is taken up through the outbox. The generic part is `core`,
 * which this holds and gives its hooks.
 */
export class ChatManager {
    readonly core: ChatCore;
    private readonly facts: ChatFacts;
    private readonly contextUrl: string | null;
    private readonly plans: ChatPlans | null;
    private readonly agentImages: AgentImages;
    private readonly visuals: VisualStore | null;
    private readonly tokens = new Map<string, string>();
    /* The digest of the note each chat's thread last took in, kept in its record as `instructions`. */
    private readonly instructed = new Map<string, string>();
    /* The project default a new chat passed over and why, from its start until it opens. */
    private readonly passedOver = new Map<string, { account: string; reason: AccountUnusable }>();
    private readonly turnUsage = new TurnUsage();

    constructor(options: ChatManagerOptions) {
        const { contextUrl, facts, plans, ...coreOptions } = options;
        this.facts = facts;
        this.contextUrl = contextUrl ?? null;
        this.plans = plans ?? null;
        this.agentImages = new AgentImages(options.attachments);
        this.visuals = options.visuals ?? null;
        this.core = new ChatCore({
            ...coreOptions,
            uiFenceLanguage: RUIMTE_UI_FENCE,
            taskRemovedReason: 'its node was removed',
            sidecars: [...(plans ? [plans] : []), this.agentImages, ...(coreOptions.sidecars ?? [])],
            env: chatEnvOf(options.env ?? process.env),
            hooks: {
                instructionsFor: (chatId) => this.instructionsFor(chatId),
                resumeNoteFor: (chatId) => this.resumeNoteFor(chatId),
                resumeInstructionsFor: (chatId) => this.resumeInstructionsFor(chatId),
                foldersFor: (chatId) => this.foldersFor(chatId),
                projectConfigFor: (chatId) => !facts.peerChat(chatId),
                promptNotesFor: (chatId) => this.promptNotesFor(chatId),
                hiddenFor: (chatId) => facts.inlineChat(chatId),
                referencesFor: (chatId) => this.referencesFor(chatId),
                envFor: (chatId, base) => this.envFor(chatId, base),
                admit: (chatId, cwd) => facts.checkCwd(chatId, cwd),
                admitUi: (chatId, clientId) => this.requireHeldProject(chatId, clientId),
                opening: (payload) => ({ ...payload, ...facts.openingAgent(payload.chatId) }),
                runtimeModeFor: (chatId, mode) => this.runtimeModeFor(chatId, mode),
                openingAccount: (chatId, kind, named) => this.openingAccountOf(chatId, kind, named),
                openingNotes: (session, stored) => this.openingNotes(session, stored),
                opened: (session, stored) => this.opened(session, stored),
                recordExtras: (chatId) => {
                    const digest = this.instructed.get(chatId);
                    return digest === undefined ? {} : { instructions: digest };
                },
                taskRows: (chatId) => facts.taskRows(chatId),
                clearing: async (chatId) => {
                    await facts.endChildren(chatId);
                },
                cleared: (chatId) => facts.dropWakes(chatId),
                forgotten: (chatId) => this.forgotten(chatId),
                removed: (_chatId, chat) => this.dropForkCopy(chat),
                broadcasted: (chatId, event) => this.broadcasted(chatId, event),
                endedAt: (chatId) => facts.endedAt(chatId),
                unownedReason: () => 'no project holds this chat any more',
                resumeWords: (chatId) => this.resumeWords(chatId),
                lostWork: (chatId, lost) => options.lostWork?.(chatId, lost) ?? Promise.resolve()
            }
        });
    }

    chatIdForToken(token: string): string | null {
        return this.tokens.get(token) ?? null;
    }

    /* The file behind an attachment id, also of a chat nobody loaded since the daemon started, and of an image an agent attached. */
    async findAttachment(chatId: string, id: string): Promise<ChatAttachment | null> {
        return (await this.core.findAttachment(chatId, id)) ?? this.agentImages.find(chatId, id);
    }

    attachAgentImage(chatId: string, upload: { name: string; mime: string; bytes: Uint8Array }): Promise<ChatAttachment> {
        return this.agentImages.save(chatId, upload);
    }

    /* Opens the turn a fork writes its summary in, loading the fork when nobody has; null while a turn is in the way. */
    async openSummaryTurn(chatId: string, wake: { text: string; label: string; note: string; summaryFor: string }): Promise<string | null> {
        if (!(await this.loadStored(chatId))) {
            throw new ChatError('chat-not-found', `No chat ${chatId}`);
        }
        return this.core.require(chatId).wake({ ...wake, taskIds: [] });
    }

    private async loadStored(chatId: string): Promise<boolean> {
        await this.core.loaded(chatId);
        if (this.core.get(chatId)) {
            return true;
        }
        if (!(await this.core.hasStored(chatId))) {
            return false;
        }
        await this.core.create({ chatId });
        return true;
    }

    /*
     * Removes what a fork nobody ever wrote in leaves behind once its node is gone: the record and the
     * transcript copy made for it. A loaded chat goes through `kill`; a fork that has turns of its
     * own is a conversation, and a worktree is never removed on its own.
     */
    async dropUnspokenFork(chatId: string): Promise<void> {
        await this.core.loaded(chatId);
        if (this.core.get(chatId)) {
            return;
        }
        const stored = await this.core.readChat(chatId);
        if (stored === null || !unspokenFork(stored.items, stored.info)) {
            return;
        }
        await Promise.all([this.core.deleteRecord(chatId), this.dropForkCopy(stored)]);
    }

    /*
     * Removes a chat nobody loaded and what is kept for it, the way a deleted node takes an unspoken
     * fork along: false, with nothing removed, for a loaded chat. A worktree is never removed.
     */
    async dropStored(chatId: string): Promise<boolean> {
        await this.core.loaded(chatId);
        if (this.core.get(chatId)) {
            return false;
        }
        const stored = await this.core.readChat(chatId);
        const [deleted] = await Promise.all([this.core.deleteRecord(chatId), stored === null ? undefined : this.dropForkCopy(stored)]);
        return deleted;
    }

    /*
     * The turn to go on after under another account: the chat's last one, which stopped on a limit.
     * `inPlace` says whether that account reads the chat's conversation, which is when the chat itself
     * can go on under it. Refuses an account it cannot start, and a chat with nothing to go on after.
     */
    async limitedTurnFor(chatId: string, account: string): Promise<{ turnId: string; limit: ChatTurnLimit['kind']; inPlace: boolean }> {
        await this.loadStored(chatId);
        const session = this.core.require(chatId);
        const { provider: kind, account: from } = session.info;
        const to = storedAccount(kind, account);
        if (to === from) {
            throw new ChatError('same-account', `The chat already runs under the account '${this.core.accountLabel(kind, to)}'`);
        }
        // As named and not as stored, which reads the default account as none: a turned-off default account is refused, and one the chat's project turned off.
        this.facts.projectAccount(chatId, kind, account);
        this.core.requireAccount(kind, account);
        if (session.info.activeTurnId !== null) {
            throw new ChatError('chat-busy', 'The chat is working on a turn; go on under another account once it ends');
        }
        const turn = limitedTurn(session.thread.list());
        if (turn === null) {
            throw new ChatError('not-limited', 'The last turn of this chat did not stop on a limit');
        }
        return { turnId: turn.id, limit: turn.limit.kind, inPlace: this.core.canContinue(kind, from, to) };
    }

    // Attached to a chat is not enough: a UI block reads the project's git, launches and databases.
    private async requireHeldProject(chatId: string, clientId: string): Promise<void> {
        if (!(await this.facts.holdsProject(chatId, clientId))) {
            throw new ChatError('refused-query', "Open this chat's project before reading its UI.");
        }
    }

    /*
     * Moves the chat to an account that reads its conversation and takes its limited turn up there at
     * once, carrying the tasks and messages that turn answered, the way a resume at the reset does.
     */
    continueInPlace(chatId: string, account: string): void {
        const session = this.core.require(chatId);
        const turn = limitedTurn(session.thread.list());
        if (turn === null) {
            throw new ChatError('not-limited', 'The last turn of this chat did not stop on a limit');
        }
        // Another account needs another CLI, and the one there is still runs work or waits on a request.
        if (session.replacementWouldWait) {
            throw new ChatError('chat-busy', 'This chat still runs work in the background or waits on a request; go on under another account once that ends');
        }
        this.core.switchAccount(session, account);
        const { provider: kind, account: to } = session.info;
        session.wake({
            ...continueOnWake(turn.limit.kind, this.core.accountLabel(kind, to), false),
            taskIds: turn.taskIds ?? [],
            ...(turn.messageFrom === undefined ? {} : { messageFrom: turn.messageFrom })
        });
    }

    /* Opens the fork's first turn, which answers the tasks the original handed over to it. */
    async continueInFork(forkId: string, limit: ChatTurnLimit['kind'], taskIds: readonly string[]): Promise<void> {
        const info = await this.core.create({ chatId: forkId });
        this.core.require(forkId).wake({ ...continueOnWake(limit, this.core.accountLabel(info.provider, info.account), true), taskIds: [...taskIds] });
    }

    /* The limited turn of the chat went on in a fork under `account`, so the chat itself never takes it up. */
    continuedInFork(chatId: string, account: string | undefined): void {
        const session = this.core.get(chatId);
        session?.continuedElsewhere(continuedInForkNote(this.core.accountLabel(session.info.provider, account)));
    }

    private promptOptions(chatId: string): ChatPromptOptions {
        return {
            sources: this.facts.contextSources(chatId),
            depth: this.facts.depthOf(chatId),
            standalone: this.facts.standalone(chatId),
            computer: this.facts.computer(),
            // An inline edit answers with one replacement block, which a page above it would only contradict.
            visuals: this.facts.visualReplies() && !this.facts.inlineChat(chatId),
            databases: !this.facts.inlineChat(chatId) && this.facts.databases(chatId),
            reach: !this.facts.inlineChat(chatId) && this.facts.reachOpenProjects(),
            uiFence: this.core.uiFence,
            design: this.facts.design(chatId)
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
        const resumes = (this.core.get(chatId)?.info.agentSessionId ?? null) !== null;
        return resumes && known !== digest ? note : null;
    }

    private resumeNoteFor(chatId: string): string | null {
        const context = contextPrompt(this.facts.contextSources(chatId));
        const visuals = this.facts.visualReplies() && !this.facts.inlineChat(chatId) ? VISUAL_RESUME_NOTE : null;
        return [context, visuals].filter((part) => part !== null).join(' ') || null;
    }

    private foldersFor(chatId: string): readonly string[] {
        if (!this.visuals || !this.facts.visualReplies() || this.facts.inlineChat(chatId)) {
            return [];
        }
        const path = this.visuals.workspacePath(chatId);
        // Claude validates --add-dir at startup, including the first turn after a chat was cleared.
        mkdirSync(path, { recursive: true, mode: 0o700 });
        return [path];
    }

    private promptNotesFor(chatId: string): PromptNotes {
        const notes = new ContextNotes(
            () => this.facts.contextSources(chatId),
            this.facts.messageNotes(chatId),
            () => this.facts.design(chatId)?.folder ?? null
        );
        return this.facts.inlineChat(chatId) ? new InlineEditNotes(notes) : notes;
    }

    private referencesFor(chatId: string): ChatReferences {
        return (attached) => attachedReferences(attached, (id: string): Reference | null => this.facts.reference(chatId, id));
    }

    /* A token per load of the chat, which the CLI presents to the daemon's MCP server as its bearer. */
    private envFor(chatId: string, base: Record<string, string>): Record<string, string> {
        if (this.contextUrl === null) {
            return base;
        }
        const token = randomBytes(24).toString('base64url');
        this.tokens.set(token, chatId);
        return { ...base, RUIMTE_CONTEXT_URL: this.contextUrl, [MCP_URL_VARIABLE]: mcpUrlOf(this.contextUrl), [CHAT_TOKEN_VARIABLE]: token };
    }

    private runtimeModeFor(chatId: string, mode: RuntimeMode): RuntimeMode {
        const ceiling = this.facts.modeCeiling(chatId);
        return ceiling === null ? mode : narrowerMode(mode, ceiling);
    }

    /* The project's account for a new chat, remembering a default it passed over so the chat can say so once it opens. */
    private openingAccountOf(chatId: string, kind: AgentKind, named: string | undefined): string | undefined {
        const chosen = this.facts.projectAccount(chatId, kind, named);
        if (chosen === null) {
            return undefined;
        }
        // A chat that is already open asks for another start of its own, such as a fork, which gets no note.
        if (chosen.passedOver && !this.core.get(chatId)) {
            this.passedOver.set(chatId, chosen.passedOver);
        }
        return chosen.account;
    }

    private openingNotes(session: ChatSession, stored: ChatRecord | null): void {
        const passed = this.passedOver.get(session.id);
        this.passedOver.delete(session.id);
        if (stored !== null || passed === undefined) {
            return;
        }
        const { provider, account } = session.info;
        session.addNote('info', passedOverNote(this.core.accountLabel(provider, account), this.core.accountLabel(provider, passed.account), passed.reason));
    }

    private async opened(session: ChatSession, stored: ChatRecord | null): Promise<void> {
        const chatId = session.id;
        if (stored === null) {
            countChatStarted(session.info.provider);
        }
        const digest = stored?.extras.instructions;
        if (typeof digest === 'string') {
            this.instructed.set(chatId, digest);
        }
        // A message that landed while nobody held this chat shows here; the model hears it from the queue.
        try {
            for (const { text, message } of await this.facts.unshownMessages(chatId)) {
                session.addNote('info', text, message);
            }
        } catch (e) {
            // The messages wait in the queue either way, and a chat must open regardless.
            console.error(`Showing the messages left for chat ${chatId} failed:`, errorText(e));
        }
        // Send before returning info so attach includes the initial prompt as the thread's first message.
        const first = await this.facts.firstPrompt(chatId);
        if (first !== null) {
            try {
                session.send(first.prompt, { ...first.picked, ...(first.brief === undefined ? {} : { brief: first.brief }) });
            } catch (e) {
                // A CLI that will not start must not take chat.create down with it: the node is there either way.
                console.error(`The first prompt of chat ${chatId} failed:`, errorText(e));
            }
        }
    }

    private forgotten(chatId: string): void {
        for (const [token, id] of this.tokens) {
            if (id === chatId) {
                this.tokens.delete(token);
            }
        }
        this.instructed.delete(chatId);
        this.turnUsage.forget(chatId);
    }

    /* A client following a task's node hears whenever an item of that node's thread lands; a delta alone does not. */
    private broadcasted(chatId: string, event: ChatEvent): void {
        const info = this.core.get(chatId)?.info;
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
            this.facts.turnEnded(chatId, event.item.state);
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

    /* The transcript copy of a Claude fork nobody resumed; Codex keeps its forked thread where Ruimte cannot remove it. */
    private async dropForkCopy(chat: { info: ChatInfo; items: readonly ChatItem[] }): Promise<void> {
        const { info } = chat;
        // Empty for a provider that does not run Claude Code.
        const projectsDir = this.core.claudeProjectsDirOf(info);
        if (info.agentSessionId === null || projectsDir === '' || !unspokenFork(chat.items, info)) {
            return;
        }
        if (/[/\\]|\.\./.test(info.agentSessionId)) {
            return;
        }
        await rm(join(projectsDir, claudeProjectSlug(info.cwd), `${info.agentSessionId}.jsonl`), { force: true });
    }
}

/* A fork with no turn after the one it was cut at: nobody wrote in it, so its CLI never touched the copy. */
function unspokenFork(items: readonly ChatItem[], info: ChatInfo): boolean {
    return info.forkOf !== undefined && items.findLast((item) => item.kind === 'turn')?.id === info.forkOf.turnId;
}

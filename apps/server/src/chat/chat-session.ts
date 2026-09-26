import type {
    ChatAttachment,
    ChatCheckpointDiff,
    ChatEvent,
    ChatInfo,
    ChatItem,
    ChatQueuedMessage,
    ChatSkill,
    ChatSubagentItem,
    ChatTurnItem,
    ContextSource,
    ModelSelection,
    RuntimeMode,
    Task
} from '@ruimte/contracts';
import { notResumedNote } from '@ruimte/contracts';
import { chatReferenceNote, resolveChatReferences } from '../context/chat-references.ts';
import { contextChangeNote } from '../context/context-note.ts';
import type { CheckpointService } from '../git/checkpoints.ts';
import type { ChatProvider } from '@ruimte/agents/providers/provider';
import type { LimitsUpdate } from '@ruimte/agents/usage/limits/normalize';
import type { BackendEvent, BackendLaunch, ChatBackend } from '@ruimte/agents/chat/backend';
import { runningInBackground } from '@ruimte/agents/chat/background-work';
import type { SpawnChatProcess } from '@ruimte/agents/chat/chat-process';
import type { ChatTitleInput } from './chat-title.ts';
import { ChatError } from './errors.ts';
import { limitedTurn, limitResumeAt, limitResumeWake } from '@ruimte/agents/chat/limit-resume';
import { ThreadProjector } from '@ruimte/agents/chat/projector';
import type { SubagentSettlement } from '@ruimte/agents/chat/subagent-settlement';
import { ChatThread } from '@ruimte/agents/chat/thread';
import { errorText } from '../error-text.ts';

interface ChatSessionOptions {
    info: ChatInfo;
    items?: ChatItem[];
    // Said once, in front of the next real prompt, and kept in the record until then (a fork's note for its agent).
    preambles?: string[];
    clearedTaskIds?: string[];
    provider: ChatProvider;
    // The executable and leading arguments; a test points this at a fake CLI.
    command: string[];
    /* The environment of the CLI under the chat's account, asked at every start; throws for an account that cannot start. */
    env(account: string | undefined): Record<string, string>;
    spawn?: SpawnChatProcess;
    // What the agent is told at the start of every process, and what of it a resumed thread hears again; see `BackendLaunch`.
    instructions?(): string | null;
    resumeNote?(): string | null;
    // The links as they are now: named in the CLI's first prompt, and a change between two turns put in front of the next one.
    contextSources?(): ContextSource[];
    // The name of a chat of the same project a person attached to a message; null for any other id.
    chatTitle?(id: string): string | null;
    // What another node left for this chat, taken as it is handed over: delivered once, in front of the next prompt.
    messages?(): string[];
    // Git trees per turn, so a settled turn can show what the working tree holds against its start.
    checkpoints?: CheckpointService;
    emit(event: ChatEvent): void;
    /* What a turn said about the plan it runs on. It belongs to the machine, so it leaves the chat. */
    onLimits?(update: LimitsUpdate): void;
    persist(): void;
    // A write that may wait a moment, for a small change the log already holds.
    persistSoon(): void;
    // The name the CLI gave its session, where it writes one down; absent for a CLI that does not.
    readTitle?(agentSessionId: string): Promise<string | null>;
    // A name asked of a one-shot CLI, for a CLI that names nothing itself; null when none came.
    nameThread?(input: ChatTitleInput): Promise<string | null>;
    // How a subagent's own transcript says it ended, for a row whose CLI is gone; absent for a CLI that keeps none.
    subagentSettlement?(toolUseId: string): Promise<SubagentSettlement | null>;
    // What the daemon owes a turn that stopped on a limit; absent, nothing takes one up on its own.
    limitResume?: LimitResumeHooks;
}

export interface LimitResumeHooks {
    // The machine's switch; the chat's own `resumeAtReset` can still say no.
    allowed(): boolean;
    now(): number;
    // Owes the outbox entry that takes the turn up at `at`, in place of any this chat owed before.
    owe(turnId: string, at: number): Promise<void>;
    lapse(): Promise<void>;
    owed(): boolean;
}

// Claude Code names a session about six seconds after its first prompt, and a first turn can run for minutes.
const TITLE_RECHECK_MS = 10_000;

export interface ChatSendExtras {
    mentions?: string[];
    skills?: string[];
    chats?: string[];
    attachments?: ChatAttachment[];
}

// What a resumed CLI is told: its transcript ends where the process did, and a tool call that was out is lost to it.
export const RESUME_PROMPT = 'The machine restarted while you were working on the previous message. Continue where you left off.';

// Said in front of a resume when the chat keeps a plan with steps left.
export const PLAN_RESUME_PREAMBLE = 'You keep a plan in this chat: ruimte-context plan read shows where you were.';

/* One per limited turn, so a second fork of the same turn writes no second note. */
const continuedNoteId = (turnId: string): string => `continued-${turnId}`;

const newId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/*
 * Provider-neutral chat state. Backends live between turns and resume by CLI session id after a
 * crash, daemon restart, or model and mode change.
 */
export class ChatSession {
    readonly thread: ChatThread;
    private readonly options: ChatSessionOptions;
    private readonly projector: ThreadProjector;
    private backend: ChatBackend | null = null;
    private starting: Promise<ChatBackend> | null = null;
    // Bumped per backend, so thread items of a resumed CLI never overwrite older ones.
    private generation = 0;
    // Set by configure: the running process has the old settings, the next send starts a new one.
    private restartPending = false;
    // The selection the running CLI was started on; a window it reports is that one's, not a newer pick's.
    private launchedSelection: ModelSelection | null = null;
    // The account the running CLI was started under, which what it reports about a plan belongs to.
    private launchedAccount: string | undefined = undefined;
    // The links at the previous turn; null until the first turn, whose backend hears about them at launch.
    private lastSources: ContextSource[] | null = null;
    // The checkpoint of the turn in flight; everything queued for that turn waits for it.
    private turnReady: Promise<void> = Promise.resolve();
    // Turns we settled ourselves whose `result` is still on its way; it may not close the turn after them.
    private staleResults = 0;
    private titleTimer: ReturnType<typeof setTimeout> | null = null;
    // A name is asked for once per chat this daemon holds; the turn count keeps it once across restarts.
    private naming = false;
    // Set while the daemon goes down: a CLI dying with it must not end the turn a restart takes up again.
    private frozen = false;
    // Background subagents a load found running whose transcript did not show an end yet; no CLI here will report them.
    private readonly orphans = new Set<string>();
    private readonly clearedTasks: Set<string>;
    private pendingPreambles: readonly string[];

    constructor(options: ChatSessionOptions) {
        this.options = options;
        this.clearedTasks = new Set(options.clearedTaskIds);
        this.pendingPreambles = options.preambles ?? [];
        this.thread = new ChatThread(options.info, options.items);
        this.projector = new ThreadProjector(this.thread, { providerName: options.provider.name });
    }

    get id(): string {
        return this.thread.info.chatId;
    }

    get info(): ChatInfo {
        return this.thread.info;
    }

    get running(): boolean {
        return this.backend?.running === true;
    }

    /* What still waits for the next real prompt, for the record. */
    get preambles(): readonly string[] {
        return this.pendingPreambles;
    }

    get clearedTaskIds(): string[] {
        return [...this.clearedTasks];
    }

    get pid(): number | null {
        return this.backend?.pid ?? null;
    }

    /* Whether the person has to wait. A turn the CLI opened itself is stepped on by the next message. */
    get busy(): boolean {
        const turnId = this.thread.info.activeTurnId;
        const turn = turnId ? this.thread.get(turnId) : undefined;
        return turnId !== null && (turn?.kind !== 'turn' || turn.origin !== 'agent');
    }

    /* Model and permission changes; a turn in flight keeps its process until it ends. */
    configure(patch: { selection?: ModelSelection; runtimeMode?: RuntimeMode; resumeAtReset?: boolean }): ChatInfo {
        if (patch.resumeAtReset !== undefined && patch.resumeAtReset !== this.thread.info.resumeAtReset) {
            this.emit([this.thread.patchInfo({ resumeAtReset: patch.resumeAtReset })]);
            this.options.persist();
            this.resumeSettingChanged();
        }
        const catalog = this.options.provider.catalog;
        const selection = patch.selection ? catalog.normalize(patch.selection) : this.thread.info.selection;
        const next: Partial<ChatInfo> = {
            selection,
            runtimeMode: patch.runtimeMode ?? this.thread.info.runtimeMode
        };
        const changed = JSON.stringify(next.selection) !== JSON.stringify(this.thread.info.selection) || next.runtimeMode !== this.thread.info.runtimeMode;
        if (!changed) {
            return this.thread.info;
        }
        if (patch.selection) {
            next.usage = { ...this.thread.info.usage, contextWindow: catalog.contextWindowFor(selection) };
        }
        this.restartPending = this.backend !== null;
        this.emit([this.thread.patchInfo(next)]);
        this.options.persist();
        return this.thread.info;
    }

    /* The account the next CLI of this chat starts under; a turn in flight keeps its process until it ends. */
    setAccount(account: string | undefined): ChatInfo {
        if (account === this.thread.info.account) {
            return this.thread.info;
        }
        this.restartPending = this.backend !== null;
        this.emit([this.thread.patchInfo({ account })]);
        this.options.persist();
        return this.thread.info;
    }

    /*
     * A message while a turn runs joins the queue instead of being refused; the daemon sends it when
     * that turn settles. One queue for both providers: Claude's steer and Codex's own queue have
     * different semantics, and one rule is easier to reason about than a rule per CLI.
     */
    send(text: string, extras: ChatSendExtras = {}): { queued: boolean; turnId: string } {
        const turnId = newId('turn');
        // Behind whatever still waits (a CLI that crashed leaves its queue), so everything goes out in the order it was sent.
        if (this.busy || this.queue.length > 0) {
            const message: ChatQueuedMessage = {
                id: newId('queued'),
                turnId,
                text,
                createdAt: Date.now(),
                ...(extras.mentions?.length ? { mentions: extras.mentions } : {}),
                ...(extras.skills?.length ? { skills: extras.skills } : {}),
                ...(extras.chats?.length ? { chats: extras.chats } : {}),
                ...(extras.attachments?.length ? { attachments: extras.attachments } : {})
            };
            this.setQueue([...this.queue, message]);
            this.drainQueue();
            return { queued: true, turnId };
        }
        this.dispatch(text, extras, turnId);
        return { queued: false, turnId };
    }

    /* Drops a queued message and hands it back; null when nothing waits under that id, as once it went out. */
    unqueue(messageId: string): ChatQueuedMessage | null {
        const queue = this.queue;
        const message = queue.find((entry) => entry.id === messageId);
        if (!message) {
            return null;
        }
        this.setQueue(queue.filter((entry) => entry.id !== messageId));
        return message;
    }

    /* Puts a queued message first and stops the turn in its way; the settle sends it. */
    sendNow(messageId: string): boolean {
        const queue = this.queue;
        const message = queue.find((entry) => entry.id === messageId);
        if (!message) {
            return false;
        }
        this.setQueue([message, ...queue.filter((entry) => entry.id !== messageId)]);
        if (this.busy) {
            this.cancel();
            return true;
        }
        this.drainQueue();
        return true;
    }

    private get queue(): ChatQueuedMessage[] {
        return this.thread.info.queue ?? [];
    }

    private setQueue(queue: ChatQueuedMessage[]): void {
        this.emit([this.thread.patchInfo({ queue })]);
        this.options.persist();
    }

    /* The next queued message, once nothing is in its way. */
    private drainQueue(): void {
        const [next, ...rest] = this.queue;
        if (!next || this.busy) {
            return;
        }
        this.setQueue(rest);
        this.dispatch(next.text, { mentions: next.mentions, skills: next.skills, chats: next.chats, attachments: next.attachments }, next.turnId);
    }

    private dispatch(text: string, extras: ChatSendExtras, requestedTurnId?: string): void {
        this.settleAgentTurn();
        const { preamble, note } = this.contextNote(text);
        // A slash command must stay the first thing the CLI reads, as `contextNote` keeps it.
        const references = text.startsWith('/') ? [] : resolveChatReferences(extras.chats, (id) => this.options.chatTitle?.(id) ?? null);
        const turnId = this.openTurn(text, note, { ...extras, chats: references.map((reference) => reference.id) }, requestedTurnId);
        const said = [preamble, chatReferenceNote(references)].filter((part): part is string => part !== null);
        const input = {
            text,
            preamble: said.length === 0 ? null : said.join('\n\n'),
            attachments: extras.attachments ?? [],
            mentions: extras.mentions ?? [],
            skills: extras.skills ?? []
        };
        // The prompt waits for the checkpoint, so the tree is the folder as it was before the agent edited it.
        this.turnReady = this.checkpoint(turnId);
        this.run((backend) => backend.sendTurn(input));
    }

    /* Asks the CLI to fold its context: a call of its own, or the slash command as a turn. */
    compact(): void {
        const compaction = this.options.provider.capabilities.compaction;
        if (compaction === 'none') {
            throw new ChatError('chat-unsupported', `${this.options.provider.name} cannot fold its context`);
        }
        if (compaction === 'prompt') {
            this.send('/compact');
            return;
        }
        // A native compaction has no message of the person in front of it, only a turn to fold behind.
        this.openTurn(null, null, {});
        // Folding the context changes no file, so this turn needs no checkpoint.
        this.turnReady = Promise.resolve();
        this.run((backend) => backend.compact());
    }

    cancel(): void {
        this.lapseResume();
        const turnId = this.thread.info.activeTurnId;
        // A turn still waiting to be resumed has no process to interrupt; stopping it is ending it here.
        if (!this.backend && turnId !== null) {
            this.abandon(turnId, null);
            return;
        }
        if (!this.backend || turnId === null) {
            return;
        }
        // Through the same queue as the turn, so a stop can never overtake the message it stops.
        this.run((backend) => backend.interrupt());
    }

    /* Ends a command or a monitor the CLI runs in the background; the CLI's own report takes it off the list. */
    stopTask(taskId: string): void {
        if (!this.thread.info.background?.some((task) => task.id === taskId)) {
            throw new ChatError('task-not-found', 'This chat runs no such task');
        }
        if (!this.backend?.stopTask) {
            throw new ChatError('chat-unsupported', 'This CLI cannot stop a task on its own');
        }
        this.backend.stopTask(taskId);
    }

    /* Answers a pending approval; false when nothing waits under that id. */
    approve(requestId: string, decision: 'allow' | 'allow-always' | 'deny', message?: string): boolean {
        const item = this.thread.get(`approval-${requestId}`);
        if (item?.kind !== 'approval' || item.decision !== 'pending' || this.backend?.respondApproval(requestId, decision, message) !== true) {
            return false;
        }
        this.emit([this.thread.upsert({ ...item, decision }), this.thread.setStatus(this.thread.statusFor(this.thread.info.activeTurnId))]);
        return true;
    }

    /* Answers a pending question; false when nothing waits under that id. */
    answer(requestId: string, answers: Record<string, string>): boolean {
        const item = this.thread.get(`question-${requestId}`);
        if (item?.kind !== 'question' || item.state !== 'pending' || this.backend?.respondQuestion(requestId, answers) !== true) {
            return false;
        }
        this.emit([this.thread.upsert({ ...item, answers, state: 'answered' }), this.thread.setStatus(this.thread.statusFor(this.thread.info.activeTurnId))]);
        return true;
    }

    /*
     * Leaves an asynchronous question alone. The CLI is not told: it asked beside its turn and
     * carries on either way, so the item only has to stop waiting for the person.
     */
    dismiss(itemId: string): boolean {
        const item = this.thread.get(itemId);
        if (item?.kind !== 'question' || item.state !== 'pending' || item.async !== true) {
            return false;
        }
        this.backend?.dismissRequest?.(item.requestId);
        this.emit([this.thread.upsert({ ...item, state: 'dismissed' }), this.thread.setStatus(this.thread.statusFor(this.thread.info.activeTurnId))]);
        return true;
    }

    /*
     * Starts the chat over: the CLI goes, and the next send starts one without a session to resume.
     * A turn in the way is refused unless forced, and a forced clear does not wait for it to end,
     * since the turn disappears with the thread anyway. Writing the empty thread is the caller's.
     */
    clear(force: boolean, tasks: readonly Task[] = []): void {
        if (this.busy && !force) {
            throw new ChatError('chat-busy', `Chat ${this.id} is still working on the previous message`);
        }
        for (const task of tasks) {
            this.clearedTasks.add(task.id);
        }
        void this.dispose();
        this.generation += 1;
        this.projector.reset();
        // Null again, so the fresh CLI hears about its links at launch as it would on a first turn.
        this.lastSources = null;
        // A cleared chat starts a new conversation, which what was waiting to be said no longer describes.
        this.pendingPreambles = [];
        this.staleResults = 0;
        this.restartPending = false;
        this.launchedSelection = null;
        this.turnReady = Promise.resolve();
        const usage = this.thread.info.usage;
        this.emit([
            this.thread.reset({
                agentSessionId: null,
                running: false,
                status: 'idle',
                activeTurnId: null,
                queue: [],
                background: [],
                slashCommands: [],
                // The next CLI starts on the current pick, so the window the one that just went reported is not its.
                usage: {
                    ...usage,
                    contextTokens: 0,
                    contextWindow: this.options.provider.catalog.contextWindowFor(this.thread.info.selection),
                    breakdown: undefined
                }
            })
        ]);
    }

    /*
     * A thread read from disk cannot still be streaming or waiting, so whatever was open is closed,
     * except the turn a restart takes up again. Said as events, so a client that comes back with a
     * seq from before the restart hears it as well.
     */
    settleStored(selection: ModelSelection, resume: ResumeDecision): void {
        const events: ChatEvent[] = [];
        const resumeTurnId = resume.resumeTurnId;
        const now = Date.now();
        for (const item of this.thread.list()) {
            const settled = settleStoredItem(item, resumeTurnId);
            if (settled === item) {
                continue;
            }
            events.push(this.thread.upsert(settled));
            if (item.kind === 'turn' && settled.kind === 'turn' && settled.state === 'aborted') {
                const reason = item.id === this.thread.info.activeTurnId && resume.reason !== null ? resume.reason : 'it was not the turn the chat was running';
                events.push(
                    this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId: item.id, level: 'warning', text: notResumedNote(reason) })
                );
            }
        }
        const info = this.thread.info;
        const patch: Partial<ChatInfo> = { selection, running: false, status: resumeTurnId === null ? 'idle' : 'running', activeTurnId: resumeTurnId };
        // No process of the daemon that went down is left to run what it kept in the background.
        if (info.background?.length) {
            patch.background = [];
        }
        // The window stored is whatever the session that went left behind; the next CLI starts on the pick.
        const contextWindow = this.options.provider.catalog.contextWindowFor(selection);
        if (contextWindow !== info.usage.contextWindow) {
            patch.usage = { ...info.usage, contextWindow };
        }
        if (
            JSON.stringify(selection) !== JSON.stringify(info.selection) ||
            patch.usage !== undefined ||
            info.running ||
            patch.background !== undefined ||
            info.status !== patch.status ||
            info.activeTurnId !== resumeTurnId
        ) {
            events.push(this.thread.patchInfo(patch));
        }
        this.emit(events);
    }

    /*
     * Takes up a turn the daemon went down in: a new process on the CLI's own session, the same turn
     * with the next attempt, and a prompt that says what happened. Nothing happens when the turn has
     * ended or already has that attempt, so the outbox may run it twice. A CLI that will not start
     * throws and leaves the turn waiting for the next try.
     */
    async resume(turnId: string, attempt: number, preamble: string | null = null): Promise<void> {
        if (!this.awaitsResume(turnId, attempt)) {
            return;
        }
        let backend: ChatBackend;
        try {
            backend = await this.ensureBackend();
        } catch (e) {
            if (this.backend === null) {
                this.emit([this.thread.patchInfo({ running: false })]);
            }
            throw e;
        }
        const turn = this.thread.get(turnId);
        if (!this.awaitsResume(turnId, attempt) || this.backend !== backend || turn?.kind !== 'turn') {
            return;
        }
        const now = Date.now();
        this.emit([
            this.thread.upsert({ ...turn, attempt }),
            this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'info', text: 'Resumed after the machine restarted' })
        ]);
        this.options.persist();
        // The turn keeps the checkpoint it started with, so its card still shows everything it changed.
        this.turnReady = Promise.resolve();
        backend.sendTurn({ text: RESUME_PROMPT, preamble, attachments: [], mentions: [], skills: [] });
    }

    /* Ends a running turn nobody is working on, with the reason in the thread when there is one; the queue goes out after it. */
    abandon(turnId: string, reason: string | null): void {
        const turn = this.thread.get(turnId);
        if (turn?.kind !== 'turn' || turn.state !== 'running' || this.thread.info.activeTurnId !== turnId || this.running) {
            return;
        }
        const now = Date.now();
        this.emit([
            this.thread.upsert({ ...turn, state: 'aborted', endedAt: now }),
            ...(reason === null ? [] : [this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'warning', text: reason })]),
            this.thread.patchInfo({ status: 'idle', activeTurnId: null })
        ]);
        this.options.persist();
        this.drainQueue();
    }

    /*
     * Opens a turn nobody typed a prompt for (a settled task, a message left by another node), with the
     * turn carrying what woke it, so a turn it opens cannot itself wake anyone. A caller passes `note`
     * only when its news is not already written in the thread. Checked and opened in one step, so null
     * means a turn (or a shutdown) was in the way. Never through `send`, which would step on a turn
     * with `origin: 'agent'` and close the wake it just made.
     */
    wake(wake: { text: string; label: string; note?: string; taskIds: string[]; summaryFor?: string; messageFrom?: string[] }): string | null {
        if (this.frozen || this.thread.info.activeTurnId !== null) {
            return null;
        }
        this.turnOpened();
        const { preamble, note } = this.contextNote(wake.text);
        const turnId = newId('turn');
        const now = Date.now();
        this.emit([
            this.thread.upsert({
                id: turnId,
                kind: 'turn',
                createdAt: now,
                turnId,
                state: 'running',
                origin: 'agent',
                label: wake.label,
                ...(wake.taskIds.length === 0 ? {} : { taskIds: wake.taskIds }),
                ...(wake.messageFrom === undefined || wake.messageFrom.length === 0 ? {} : { messageFrom: wake.messageFrom }),
                ...(wake.summaryFor === undefined ? {} : { summaryFor: wake.summaryFor }),
                endedAt: null,
                costUsd: 0
            }),
            ...(wake.note === undefined
                ? []
                : [this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'info', text: wake.note })]),
            ...(note === null ? [] : [this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'info', text: note })]),
            this.thread.patchInfo({ status: this.thread.statusFor(turnId), activeTurnId: turnId })
        ]);
        this.options.persist();
        this.turnReady = this.checkpoint(turnId);
        this.run((backend) => backend.sendTurn({ text: wake.text, preamble, attachments: [], mentions: [], skills: [] }));
        return turnId;
    }

    /* The machine's switch or this chat's own changed: a limit still ahead is owed a resume now, or what was owed lapses. */
    resumeSettingChanged(): void {
        if (this.resumeAllowed()) {
            this.oweResume(false);
        } else {
            this.lapseResume();
        }
    }

    /*
     * Opens the turn that takes up the limited turn `turnId` again, carrying the tasks and messages that
     * one answered; false when anything stepped in since (a person wrote, the switch went off, the chat
     * stopped), which is how the owed entry lapses.
     */
    takeUpAfterLimit(turnId: string): boolean {
        const turn = limitedTurn(this.thread.list());
        if (turn === null || turn.id !== turnId || !this.resumeAllowed()) {
            return false;
        }
        const wake = limitResumeWake(turn.limit.kind);
        return (
            this.wake({
                ...wake,
                taskIds: turn.taskIds ?? [],
                ...(turn.messageFrom === undefined ? {} : { messageFrom: turn.messageFrom })
            }) !== null
        );
    }

    /* A limited turn a fork went on with is that fork's to take up, never this chat's. */
    private wentOn(turn: ChatTurnItem): boolean {
        return this.thread.get(continuedNoteId(turn.id)) !== undefined;
    }

    private resumeAllowed(): boolean {
        return this.options.limitResume?.allowed() === true && this.thread.info.resumeAtReset !== false;
    }

    /*
     * Owes a resume of the last turn when it stopped on a limit. Right after that turn every limit is
     * owed; a switch turned on later only owes a usage limit whose reset is still ahead, so an old
     * error is never taken up out of the blue.
     */
    private oweResume(fresh: boolean): void {
        const hooks = this.options.limitResume;
        const turn = limitedTurn(this.thread.list());
        if (!hooks || turn === null || this.thread.info.activeTurnId !== null || this.frozen || !this.resumeAllowed() || this.wentOn(turn)) {
            return;
        }
        const now = hooks.now();
        if (!fresh && (turn.limit.kind !== 'usage' || (turn.limit.resetsAt ?? 0) <= now)) {
            return;
        }
        const at = limitResumeAt(this.thread.list(), turn, now);
        if (at === null || at === this.thread.info.resumeAt) {
            return;
        }
        this.emit([this.thread.patchInfo({ resumeAt: at })]);
        this.options.persist();
        void hooks.owe(turn.id, at).catch((e: unknown) => console.error(`Owing a resume of chat ${this.id} failed:`, errorText(e)));
    }

    /*
     * A resume time the record shows while the outbox holds no entry for it, which a daemon that went
     * down between the two leaves: owed again at that time, or taken off when nothing may owe it now.
     */
    settleOwedResume(): void {
        const hooks = this.options.limitResume;
        const at = this.thread.info.resumeAt;
        if (at === undefined || hooks?.owed() === true) {
            return;
        }
        const turn = limitedTurn(this.thread.list());
        if (!hooks || turn === null || this.thread.info.activeTurnId !== null || !this.resumeAllowed()) {
            this.emit([this.thread.patchInfo({ resumeAt: undefined })]);
            this.options.persist();
            return;
        }
        void hooks.owe(turn.id, at).catch((e: unknown) => console.error(`Owing a resume of chat ${this.id} failed:`, errorText(e)));
    }

    /* Whatever the last turn stopped on is behind the chat once another turn opens. */
    private turnOpened(): void {
        if (this.thread.info.limit !== undefined) {
            this.emit([this.thread.patchInfo({ limit: undefined })]);
        }
        this.lapseResume();
    }

    /*
     * The limited turn went on in a fork, so what the outbox owes for it lapses, and the note says where
     * it went. The note is also the mark that keeps a switch turned on later from owing that turn again.
     */
    continuedInFork(note: string): void {
        this.lapseResume();
        const turn = limitedTurn(this.thread.list());
        if (turn === null || this.wentOn(turn)) {
            return;
        }
        this.emit([this.thread.upsert({ id: continuedNoteId(turn.id), kind: 'note', createdAt: Date.now(), turnId: turn.id, level: 'info', text: note })]);
        this.options.persist();
    }

    private lapseResume(): void {
        const hooks = this.options.limitResume;
        if (this.thread.info.resumeAt === undefined || !hooks) {
            return;
        }
        this.emit([this.thread.patchInfo({ resumeAt: undefined })]);
        this.options.persist();
        void hooks.lapse().catch((e: unknown) => console.error(`Dropping the resume of chat ${this.id} failed:`, errorText(e)));
    }

    /*
     * A note a person reads and a preamble the CLI hears in front of the next real prompt, whether or
     * not a turn runs now: a fork's summary, a child that waits. Written under the id the delivery
     * names, so a delivery that runs twice leaves one of each; false when it was here already.
     */
    deliverNote(delivery: { noteId: string; note: string; from?: string; preamble: string }): boolean {
        if (this.thread.get(delivery.noteId) !== undefined) {
            return false;
        }
        this.pendingPreambles = [...this.pendingPreambles, delivery.preamble];
        this.emit([
            this.thread.upsert({
                id: delivery.noteId,
                kind: 'note',
                createdAt: Date.now(),
                turnId: null,
                level: 'info',
                text: delivery.note,
                ...(delivery.from === undefined ? {} : { from: delivery.from })
            })
        ]);
        this.options.persist();
        return true;
    }

    /*
     * The task row in the thread of the chat that gave it, written from the task alone so
     * writing it twice changes nothing. A new row joins the turn that is running, which is the turn
     * that ran the verb; a cancelled task gets a note saying why its row failed.
     */
    upsertTaskRow(task: Task): void {
        if (this.clearedTasks.has(task.id)) {
            return;
        }
        const id = `task-${task.id}`;
        const existing = this.thread.get(id);
        const row: ChatSubagentItem = {
            id,
            kind: 'subagent',
            createdAt: task.createdAt,
            turnId: existing?.turnId ?? this.thread.info.activeTurnId,
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
        const events: ChatEvent[] = [];
        if (JSON.stringify(existing) !== JSON.stringify(row)) {
            events.push(this.thread.upsert(row));
        }
        const noteId = `${id}-cancelled`;
        if (task.status === 'cancelled' && this.thread.get(noteId) === undefined) {
            events.push(
                this.thread.upsert({
                    id: noteId,
                    kind: 'note',
                    createdAt: task.settledAt ?? task.createdAt,
                    turnId: null,
                    level: 'warning',
                    text: `The task "${task.title}" was cancelled: ${task.result?.text ?? 'its node was removed'}`
                })
            );
        }
        if (events.length > 0) {
            this.emit(events);
            this.options.persistSoon();
        }
    }

    /* A line in the thread outside any turn, for something the daemon has to say about work it gave up on. */
    addNote(level: 'info' | 'warning' | 'error', text: string): void {
        this.emit([this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: Date.now(), turnId: null, level, text })]);
        this.options.persist();
    }

    /*
     * Ends the CLI because the agent that opened this chat was stopped: whatever ran or waited is
     * closed with the reason in the thread, the queue goes, and the thread stays for a person to read
     * or to carry on in, which starts the CLI again like any send.
     */
    end(reason: string): void {
        this.lapseResume();
        const backend = this.backend;
        this.backend = null;
        this.starting = null;
        this.restartPending = false;
        void backend?.dispose();
        const now = Date.now();
        const turnId = this.thread.info.activeTurnId;
        const events: ChatEvent[] = [];
        for (const item of this.thread.list()) {
            const settled =
                item.kind === 'turn' && item.state === 'running' ? { ...item, state: 'aborted' as const, endedAt: now } : settleStoredItem(item, null);
            if (settled !== item) {
                events.push(this.thread.upsert(settled));
            }
        }
        if (turnId !== null) {
            events.push(this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'warning', text: reason }));
        }
        events.push(
            this.thread.patchInfo({
                running: false,
                status: 'idle',
                activeTurnId: null,
                ...(this.queue.length > 0 ? { queue: [] } : {}),
                ...(this.thread.info.background?.length ? { background: [] } : {})
            })
        );
        this.emit(events);
        this.options.persist();
    }

    /* Ends the process and stops listening to it, as the daemon goes down; the thread stays as it is. */
    freeze(): void {
        this.frozen = true;
        this.backend?.stop();
    }

    /* Ends the CLI and everything it started; settles once it exited or was sent the SIGKILL. */
    dispose(): Promise<void> {
        if (this.titleTimer !== null) {
            clearTimeout(this.titleTimer);
            this.titleTimer = null;
        }
        const ended = this.backend?.dispose() ?? Promise.resolve();
        this.backend = null;
        this.starting = null;
        return ended;
    }

    /* What a turn changed against its checkpoint: the stored answer, or one taken now while it runs. */
    async turnDiff(turnId: string): Promise<ChatCheckpointDiff | null> {
        const turn = this.thread.get(turnId);
        if (turn?.kind !== 'turn') {
            throw new ChatError('request-not-found', `No turn ${turnId} in chat ${this.id}`);
        }
        if (turn.checkpointDiff) {
            return turn.checkpointDiff;
        }
        if (turn.checkpoint === undefined || !this.options.checkpoints) {
            return null;
        }
        return await this.options.checkpoints.diff(this.thread.info.cwd, turn.checkpoint);
    }

    /* A page of a thread the CLI keeps, through the process that runs now; null when none runs that can answer. */
    listThreadItems(params: { threadId: string; cursor?: string; limit: number; sortDirection: 'asc' | 'desc' }): Promise<unknown> | null {
        const backend = this.backend;
        return backend?.running === true && backend.listThreadItems ? backend.listThreadItems(params) : null;
    }

    /*
     * The background subagents of the CLI's own that were running when the chat was stored. Whatever
     * ran them went with the daemon, so no notification will come: a Claude row settles as done when
     * its transcript shows the end, and stays running otherwise (a CLI can outlive the daemon for a
     * moment and still finish); a Codex agent works inside its parent's app-server, so it is gone too.
     */
    async settleOrphanedSubagents(): Promise<void> {
        const rows = this.runningBackgroundRows();
        if (this.info.provider === 'codex') {
            const now = Date.now();
            this.settleRows(rows.map((row) => ({ ...row, status: 'failed', finishedAt: now })));
            return;
        }
        for (const row of rows) {
            this.orphans.add(row.toolUseId);
        }
        await this.settleFromTranscripts(rows);
    }

    /*
     * Marks a subagent of the CLI's own as stopped: `failed` with a note that says what it means, since
     * no CLI stops one subagent on its own. Refused while a turn runs, which may still be waiting on it.
     */
    markSubagentStopped(toolUseId: string): void {
        if (this.thread.info.activeTurnId !== null) {
            throw new ChatError('chat-busy', 'A turn is running; stop the turn instead');
        }
        const row = this.thread.find('subagent', (item) => item.toolUseId === toolUseId);
        if (row?.status !== 'running') {
            return;
        }
        this.markStopped([row]);
    }

    /* Marks every running subagent of the CLI's own as stopped, for a person stopping the turn together with them. */
    markSubagentsStopped(): void {
        this.markStopped(
            this.thread.list().filter((item): item is ChatSubagentItem => item.kind === 'subagent' && item.status === 'running' && item.origin !== 'ruimte')
        );
    }

    private markStopped(rows: readonly ChatSubagentItem[]): void {
        if (rows.length === 0) {
            return;
        }
        const now = Date.now();
        for (const row of rows) {
            this.orphans.delete(row.toolUseId);
        }
        const names = rows.map((row) => `"${row.description || row.subagentType || 'Sub-agent'}"`).join(', ');
        this.emit([
            ...rows.map((row) => this.thread.upsert({ ...row, status: 'failed', finishedAt: now })),
            this.thread.upsert({
                id: newId('note'),
                kind: 'note',
                createdAt: now,
                turnId: null,
                level: 'info',
                text: `${names} ${rows.length === 1 ? 'was' : 'were'} marked as stopped. ${this.options.provider.name} cannot stop one sub-agent on its own, so ${rows.length === 1 ? 'it' : 'they'} may keep working until the chat's process ends.`
            })
        ]);
        this.options.persist();
    }

    /* Asks the transcript again for a row a load left running, when somebody looks at it. */
    async recheckOrphan(toolUseId: string): Promise<void> {
        const row = this.thread.find('subagent', (item) => item.toolUseId === toolUseId);
        if (this.orphans.has(toolUseId) && row?.status === 'running') {
            await this.settleFromTranscripts([row]);
        }
    }

    /* Writes down where a subagent's conversation was found, so the next question about it reads no folder. */
    noteSubagentNative(toolUseId: string, native: { agentId?: string; threadId?: string }): void {
        const item = this.thread.find('subagent', (candidate) => candidate.toolUseId === toolUseId);
        if (!item || (item.native?.agentId === native.agentId && item.native?.threadId === native.threadId)) {
            return;
        }
        this.emit([this.thread.upsert({ ...item, native: { ...item.native, ...native } })]);
        this.options.persistSoon();
    }

    /*
     * What this chat's CLI would run as a skill. A running backend that answers the question itself
     * (Codex) is the authority; otherwise the daemon's own scan is, narrowed to what the CLI's init
     * frame said it has, so a skill turned off in its settings drops out after the first message.
     */
    async skills(scan: () => Promise<ChatSkill[]>): Promise<ChatSkill[]> {
        const backend = this.backend;
        if (backend?.running === true && backend.listSkills) {
            try {
                const own = await backend.listSkills();
                if (own.length > 0) {
                    return own;
                }
            } catch {
                // The CLI could not answer; the scan below is what is left.
            }
        }
        const scanned = await scan();
        const announced = this.thread.info.skills;
        if (!announced?.length) {
            return scanned;
        }
        const known = new Set(announced);
        return scanned.filter((skill) => known.has(skill.name));
    }

    private openTurn(text: string | null, note: string | null, extras: ChatSendExtras, requestedTurnId?: string): string {
        this.turnOpened();
        const turnId = requestedTurnId ?? newId('turn');
        const now = Date.now();
        const events = [this.thread.upsert({ id: turnId, kind: 'turn', createdAt: now, turnId, state: 'running', origin: 'user', endedAt: null, costUsd: 0 })];
        if (note !== null) {
            events.push(this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'info', text: note }));
        }
        if (text !== null) {
            const mentions = extras.mentions?.length ? extras.mentions : undefined;
            const skills = extras.skills?.length ? extras.skills : undefined;
            const chats = extras.chats?.length ? extras.chats : undefined;
            const attachments = extras.attachments?.length ? extras.attachments : undefined;
            events.push(this.thread.upsert({ id: newId('user'), kind: 'user', createdAt: now, turnId, text, mentions, skills, chats, attachments }));
        }
        events.push(this.thread.patchInfo({ status: this.thread.statusFor(turnId), activeTurnId: turnId }));
        this.emit(events);
        // On disk before the CLI answers, so a daemon that goes down mid-turn still shows the question.
        this.options.persist();
        return turnId;
    }

    /*
     * A turn the CLI opened itself is closed the moment the person types: they are steering now, and
     * the `result` still coming for that turn must not settle the one they just started.
     */
    private settleAgentTurn(): void {
        const turnId = this.thread.info.activeTurnId;
        const turn = turnId ? this.thread.get(turnId) : undefined;
        if (turn?.kind !== 'turn' || turn.origin !== 'agent') {
            return;
        }
        this.staleResults += 1;
        this.emit([this.thread.upsert({ ...turn, state: 'done', endedAt: Date.now() }), this.thread.patchInfo({ status: 'idle', activeTurnId: null })]);
        this.settleCheckpoint(turn.id);
    }

    /* Records the folder's tree on the turn; a folder without git leaves the turn as it is. */
    private checkpoint(turnId: string): Promise<void> {
        const checkpoints = this.options.checkpoints;
        if (!checkpoints) {
            return Promise.resolve();
        }
        return checkpoints
            .take(this.thread.info.cwd)
            .then((tree) => {
                const turn = this.thread.get(turnId);
                if (tree === null || turn?.kind !== 'turn') {
                    return;
                }
                this.emit([this.thread.upsert({ ...turn, checkpoint: tree })]);
            })
            .catch(() => undefined);
    }

    /* The diff of a turn that just ended, so a reload shows it without asking git again, and the tree a fork after it starts from. */
    private settleCheckpoint(turnId: string): void {
        const turn = this.thread.get(turnId);
        if (turn?.kind !== 'turn' || turn.checkpoint === undefined || turn.checkpointDiff || !this.options.checkpoints) {
            return;
        }
        void this.options.checkpoints
            .settle(this.thread.info.cwd, turn.checkpoint)
            .then((answer) => {
                const settled = this.thread.get(turnId);
                if (answer === null || settled?.kind !== 'turn') {
                    return;
                }
                this.emit([this.thread.upsert({ ...settled, checkpointDiff: answer.diff, checkpointAfter: answer.after })]);
                this.options.persist();
            })
            .catch(() => undefined);
    }

    /*
     * What the agent has to hear before this prompt: a link made or removed between turns, and any
     * message another node left for it. Each is said once, and only in front of a real prompt.
     *
     * The thread gets less of it than the CLI. A message is written there as it lands, by whichever
     * channel got it first, so repeating it above the turn it opened tells a person the same thing
     * twice; the rest nobody has read yet.
     */
    private contextNote(text: string): { preamble: string | null; note: string | null } {
        // A slash command must stay the first thing the CLI reads; the rest waits for a real prompt.
        if (text.startsWith('/')) {
            return { preamble: null, note: null };
        }
        const current = this.options.contextSources?.() ?? [];
        const previous = this.lastSources;
        this.lastSources = current;
        // Every caller persists right after opening its turn, so the record forgets them along with the turn it writes.
        const preambles = this.pendingPreambles;
        this.pendingPreambles = [];
        const read = [...preambles, ...(previous === null ? [] : [contextChangeNote(previous, current)])].filter((part): part is string => part !== null);
        const messages = this.options.messages?.() ?? [];
        const joined = (parts: string[]): string | null => (parts.length === 0 ? null : parts.join('\n\n'));
        return { preamble: joined([...read, ...messages]), note: joined(read) };
    }

    /* Runs one turn against the backend; a backend that will not start ends the turn with the reason. */
    private run(work: (backend: ChatBackend) => void): void {
        // The process starts while the checkpoint runs; the work itself waits for both, and a stop
        // waits for the same promise, so it can never overtake the message it stops.
        const backend = this.ensureBackend();
        void Promise.all([backend, this.turnReady])
            .then(([started]) => {
                if (this.backend === started) {
                    work(started);
                }
            })
            .catch((error: unknown) => this.receive(this.generation, { type: 'failed', message: errorText(error) }));
    }

    private ensureBackend(): Promise<ChatBackend> {
        if (this.backend && this.restartPending) {
            // Let the old one go quietly; its events are dropped and its exit must not end the chat.
            this.backend.stop();
            this.backend = null;
            this.starting = null;
        }
        this.restartPending = false;
        if (this.backend && this.starting) {
            return this.starting;
        }
        let env: Record<string, string>;
        try {
            env = this.options.env(this.thread.info.account);
            this.launchedAccount = this.thread.info.account;
        } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        this.generation += 1;
        const generation = this.generation;
        const info = this.thread.info;
        this.launchedSelection = info.selection;
        const launch: BackendLaunch = {
            command: this.options.command,
            cwd: info.cwd,
            env,
            selection: info.selection,
            modelName: this.options.provider.catalog.nameOf(info.selection.model),
            runtimeMode: info.runtimeMode,
            resume: info.agentSessionId,
            generation,
            instructions: this.options.instructions?.() ?? null,
            resumeNote: this.options.resumeNote?.() ?? null,
            ...(this.options.spawn ? { spawn: this.options.spawn } : {})
        };
        const made: { backend: ChatBackend | null } = { backend: null };
        try {
            made.backend = this.options.provider.createBackend(launch, {
                onEvent: (event) => {
                    if (made.backend === this.backend) {
                        this.receive(generation, event);
                    }
                }
            });
        } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        const backend = made.backend;
        this.backend = backend;
        this.emit([this.thread.patchInfo({ running: true })]);
        let started: Promise<void>;
        try {
            started = backend.start();
        } catch (error) {
            // A spawn that throws on the spot (no such executable) is a start that failed like any other.
            started = Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        this.starting = started
            .then(() => backend)
            .catch((error: unknown) => {
                // A CLI that will not start leaves nothing to talk to; the next send tries again.
                if (this.backend === backend) {
                    this.backend = null;
                    this.starting = null;
                }
                throw error;
            });
        return this.starting;
    }

    private awaitsResume(turnId: string, attempt: number): boolean {
        const turn = this.thread.get(turnId);
        return !this.frozen && turn?.kind === 'turn' && turn.state === 'running' && this.thread.info.activeTurnId === turnId && (turn.attempt ?? 1) < attempt;
    }

    private receive(generation: number, event: BackendEvent): void {
        if (this.frozen) {
            return;
        }
        if (event.type === 'limits') {
            this.options.onLimits?.(this.launchedAccount === undefined ? event.update : { ...event.update, account: this.launchedAccount });
            return;
        }
        if (event.type === 'title') {
            this.applyTitle(event.title);
            return;
        }
        /*
         * A CLI reports the window it was started on. A pick made since waits for the restart the next
         * send does, so its report may not put the old size back under a meter that already reads the new one.
         */
        if (event.type === 'usage' && event.contextWindow !== undefined && !this.reportsCurrentWindow()) {
            if (event.contextTokens === undefined) {
                return;
            }
            this.emit(this.projector.project(generation, { type: 'usage', contextTokens: event.contextTokens }));
            return;
        }
        // A request that failed after the turn already ended has nothing left to report.
        if (event.type === 'failed' && this.thread.info.activeTurnId === null) {
            return;
        }
        if (event.type === 'exit') {
            this.backend = null;
            this.starting = null;
        }
        // A turn we settled ourselves still has its own `result` coming; it may not close the turn after it.
        if (event.type === 'turn.done' && this.staleResults > 0) {
            this.staleResults -= 1;
            return;
        }
        if (event.type === 'exit' || event.type === 'failed') {
            this.staleResults = 0;
        }
        const openTurnId = this.thread.info.activeTurnId;
        // Settled as failed by the exit below; the transcript may still show that they finished first.
        const orphaned = event.type === 'exit' && this.info.provider === 'claude' ? this.runningBackgroundRows() : [];
        if (event.type === 'turn.done' && event.state === 'aborted') {
            // A request of work beside the turn outlives the interrupt; turned down, that work goes on instead of waiting forever.
            for (const item of this.thread.pending()) {
                this.backend?.declineRequest?.(item.requestId, 'The user stopped the turn');
            }
        }
        this.emit(this.projector.project(generation, event));
        if (orphaned.length > 0) {
            void this.settleFromTranscripts(orphaned.flatMap((row) => this.thread.get(row.id) ?? []).filter((item) => item.kind === 'subagent'));
        }
        const activeTurnId = this.thread.info.activeTurnId;
        if (openTurnId === null && activeTurnId !== null) {
            // The CLI opened this turn itself; it takes a checkpoint like any other, so the card can
            // show what the agent changed while nobody was watching.
            this.turnOpened();
            void this.checkpoint(activeTurnId);
            this.options.persist();
        }
        if (event.type === 'turn.done' || event.type === 'exit' || event.type === 'failed') {
            this.options.persist();
        }
        if (openTurnId !== null && activeTurnId === null) {
            this.settleCheckpoint(openTurnId);
        }
        if (event.type === 'session' && typeof event.title === 'string') {
            this.applyTitle(event.title);
        }
        if (event.type === 'session' && this.thread.info.agentSessionId !== null) {
            this.refreshTitle();
            if (this.titleTimer === null && this.thread.info.suggestedTitle === undefined) {
                this.titleTimer = setTimeout(() => {
                    this.titleTimer = null;
                    this.refreshTitle();
                }, TITLE_RECHECK_MS);
            }
        }
        // The turn is over and the CLI is still there, so whatever waited behind it can go out now.
        if (event.type === 'turn.done') {
            this.refreshTitle();
            if (event.state === 'done') {
                this.nameThread();
            }
            this.drainQueue();
            if (event.limit !== undefined) {
                this.oweResume(true);
            }
        }
    }

    /* Whether the CLI that reports was started on a pick standing for the same window as the chat's own. */
    private reportsCurrentWindow(): boolean {
        const catalog = this.options.provider.catalog;
        return this.launchedSelection === null || catalog.contextWindowFor(this.launchedSelection) === catalog.contextWindowFor(this.thread.info.selection);
    }

    /* Rides on the info patch: a client that has the chat open hears it, and a reload finds it stored. */
    private refreshTitle(): void {
        const agentSessionId = this.thread.info.agentSessionId;
        if (!this.options.readTitle || agentSessionId === null) {
            return;
        }
        void this.options
            .readTitle(agentSessionId)
            .then((title) => {
                // A clear in between started another session, whose name this is not.
                if (title === null || title === this.thread.info.suggestedTitle || this.thread.info.agentSessionId !== agentSessionId) {
                    return;
                }
                this.emit([this.thread.patchInfo({ suggestedTitle: title })]);
                this.options.persistSoon();
            })
            .catch(() => undefined);
    }

    private applyTitle(title: string): void {
        if (title === this.thread.info.suggestedTitle) {
            return;
        }
        this.emit([this.thread.patchInfo({ suggestedTitle: title })]);
        this.options.persistSoon();
    }

    /*
     * Names a chat whose CLI names nothing, after its first turn that went well: the prompt alone is
     * often too little to name, and the start of the answer says what the conversation became. Once,
     * and not for a thread that already has a name, as a resumed one may.
     */
    private nameThread(): void {
        const name = this.options.nameThread;
        if (!name || this.naming || this.thread.info.suggestedTitle !== undefined) {
            return;
        }
        const items = this.thread.list();
        const done = items.filter((item) => item.kind === 'turn' && item.state === 'done');
        const prompt = items.find((item) => item.kind === 'user');
        if (done.length !== 1 || prompt?.kind !== 'user' || prompt.text.trim() === '') {
            return;
        }
        this.naming = true;
        const turnId = done[0]!.id;
        const answer = items
            .map((item) => (item.kind === 'assistant' && item.turnId === turnId ? item.text : ''))
            .filter((text) => text !== '')
            .join('\n\n');
        const agentSessionId = this.thread.info.agentSessionId;
        void name({ cwd: this.thread.info.cwd, prompt: prompt.text, answer })
            .then((title) => {
                // A clear in between started another conversation, and a name that came meanwhile is the CLI's own.
                if (title === null || this.thread.info.agentSessionId !== agentSessionId || this.thread.info.suggestedTitle !== undefined) {
                    return;
                }
                this.applyTitle(title);
                this.backend?.setTitle?.(title);
            })
            .catch(() => undefined);
    }

    private runningBackgroundRows(): ChatSubagentItem[] {
        return runningInBackground(this.thread.list()).filter((item) => item.kind === 'subagent');
    }

    /* Done for every row whose transcript shows the end, unless something else settled the row while it was read. */
    private async settleFromTranscripts(rows: ChatSubagentItem[]): Promise<void> {
        const lookup = this.options.subagentSettlement;
        if (!lookup || rows.length === 0) {
            return;
        }
        const settled: ChatSubagentItem[] = [];
        for (const row of rows) {
            const settlement = await lookup(row.toolUseId);
            const current = this.thread.get(row.id);
            if (settlement === null || current?.kind !== 'subagent' || current.status !== row.status || current.finishedAt !== row.finishedAt) {
                continue;
            }
            this.orphans.delete(row.toolUseId);
            settled.push({
                ...current,
                status: 'done',
                finishedAt: settlement.finishedAt ?? current.finishedAt ?? Date.now(),
                result: settlement.report ?? current.result
            });
        }
        this.settleRows(settled);
    }

    private settleRows(rows: ChatSubagentItem[]): void {
        if (this.frozen || rows.length === 0) {
            return;
        }
        this.emit(rows.map((row) => this.thread.upsert(row)));
        this.options.persist();
    }

    private emit(events: ChatEvent[]): void {
        for (const event of events) {
            this.options.emit(event);
        }
    }
}

/* The turn a restart takes up again, or else why the turn the daemon went down in ends (null when none was running). */
export interface ResumeDecision {
    resumeTurnId: string | null;
    reason: string | null;
}

/* The one sentence a turn that a restart did not take up again ends with, whatever the reason; the client reads it too. */
export { notResumedNote };

// Whatever was open when the daemon went down: nobody is going to answer it now.
const settleStoredItem = (item: ChatItem, resumeTurnId: string | null): ChatItem => {
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
    // Aborted rather than error: the turn did not fail, the machine went down under it.
    if (item.kind === 'turn' && item.state === 'running' && item.id !== resumeTurnId) {
        return { ...item, state: 'aborted', endedAt: item.endedAt ?? item.createdAt };
    }
    return item;
};

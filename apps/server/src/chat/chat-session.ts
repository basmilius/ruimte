import type {
    ChatAttachment,
    ChatCheckpointDiff,
    ChatEvent,
    ChatInfo,
    ChatItem,
    ChatQueuedMessage,
    ChatSkill,
    ContextSource,
    ModelSelection,
    RuntimeMode
} from '@ruimte/contracts';
import { contextChangeNote } from '../context/context-note.ts';
import type { CheckpointService } from '../git/checkpoints.ts';
import type { ChatProvider } from '../providers/provider.ts';
import type { BackendEvent, BackendLaunch, ChatBackend } from './backend.ts';
import { ChatError } from './errors.ts';
import { ThreadProjector } from './projector.ts';
import { ChatThread } from './thread.ts';

interface ChatSessionOptions {
    info: ChatInfo;
    items?: ChatItem[];
    provider: ChatProvider;
    // The executable and leading arguments; a test points this at a fake CLI.
    command: string[];
    env: Record<string, string>;
    // Whether the person linked something to this chat; the CLI is told where to look when so.
    hasContext(): boolean;
    // The links as they are now; a change between two turns is put in front of the next prompt.
    contextSources?(): ContextSource[];
    // Git trees per turn, so a settled turn can show what the working tree holds against its start.
    checkpoints?: CheckpointService;
    emit(event: ChatEvent): void;
    persist(): void;
    // A write that may wait a moment: the work of a turn in flight, so a restart loses less than a whole turn.
    persistSoon(): void;
}

export interface ChatSendExtras {
    mentions?: string[];
    skills?: string[];
    attachments?: ChatAttachment[];
}

const newId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/*
 * One chat, whichever CLI is behind it: the thread, the turns, the process generation and when a
 * new backend is needed. The backend speaks the CLI's protocol and the projector writes the items,
 * so everything here is the same for every provider. A backend is made on the first message and
 * kept between turns; a dead one is made again with the CLI's own session id on the next send,
 * which is also how a chat survives a daemon restart and how a changed model or mode takes effect.
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
    // The links at the previous turn; null until the first turn, whose backend hears about them at launch.
    private lastSources: ContextSource[] | null = null;
    // The checkpoint of the turn in flight; everything queued for that turn waits for it.
    private turnReady: Promise<void> = Promise.resolve();
    // Turns we settled ourselves whose `result` is still on its way; it may not close the turn after them.
    private staleResults = 0;

    constructor(options: ChatSessionOptions) {
        this.options = options;
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

    /* Whether the person has to wait. A turn the CLI opened itself is stepped on by the next message. */
    get busy(): boolean {
        const turnId = this.thread.info.activeTurnId;
        const turn = turnId ? this.thread.get(turnId) : undefined;
        return turnId !== null && (turn?.kind !== 'turn' || turn.origin !== 'agent');
    }

    /* Model and permission changes; a turn in flight keeps its process until it ends. */
    configure(patch: { selection?: ModelSelection; runtimeMode?: RuntimeMode }): ChatInfo {
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

    /*
     * A message while a turn runs joins the queue instead of being refused; the daemon sends it when
     * that turn settles. One queue for both providers: Claude's steer and Codex's own queue have
     * different semantics, and one rule is easier to reason about than a rule per CLI.
     */
    send(text: string, extras: ChatSendExtras = {}): { queued: boolean } {
        if (this.busy) {
            const message: ChatQueuedMessage = {
                id: newId('queued'),
                text,
                createdAt: Date.now(),
                ...(extras.mentions?.length ? { mentions: extras.mentions } : {}),
                ...(extras.skills?.length ? { skills: extras.skills } : {}),
                ...(extras.attachments?.length ? { attachments: extras.attachments } : {})
            };
            this.setQueue([...this.queue, message]);
            return { queued: true };
        }
        this.dispatch(text, extras);
        return { queued: false };
    }

    /* Drops a queued message; false when nothing waits under that id. */
    unqueue(messageId: string): boolean {
        const queue = this.queue;
        if (!queue.some((message) => message.id === messageId)) {
            return false;
        }
        this.setQueue(queue.filter((message) => message.id !== messageId));
        return true;
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
        this.dispatch(next.text, { mentions: next.mentions, skills: next.skills, attachments: next.attachments });
    }

    private dispatch(text: string, extras: ChatSendExtras): void {
        this.settleAgentTurn();
        const note = this.contextNote(text);
        const turnId = this.openTurn(text, note, extras);
        const input = {
            text,
            preamble: note,
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
        if (!this.backend || this.thread.info.activeTurnId === null) {
            return;
        }
        // Through the same queue as the turn, so a stop can never overtake the message it stops.
        this.run((backend) => backend.interrupt());
    }

    /* Answers a pending approval; false when nothing waits under that id. */
    approve(requestId: string, decision: 'allow' | 'allow-always' | 'deny', message?: string): boolean {
        const item = this.thread.get(`approval-${requestId}`);
        if (item?.kind !== 'approval' || item.decision !== 'pending' || this.backend?.respondApproval(requestId, decision, message) !== true) {
            return false;
        }
        this.emit([this.thread.upsert({ ...item, decision }), this.thread.setStatus('running')]);
        return true;
    }

    /* Answers a pending question; false when nothing waits under that id. */
    answer(requestId: string, answers: Record<string, string>): boolean {
        const item = this.thread.get(`question-${requestId}`);
        if (item?.kind !== 'question' || item.state !== 'pending' || this.backend?.respondQuestion(requestId, answers) !== true) {
            return false;
        }
        this.emit([this.thread.upsert({ ...item, answers, state: 'answered' }), this.thread.setStatus('running')]);
        return true;
    }

    /* Ends the process; the thread stays as it is. */
    stop(): void {
        this.backend?.stop();
    }

    dispose(): void {
        this.backend?.dispose();
        this.backend = null;
        this.starting = null;
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

    private openTurn(text: string | null, note: string | null, extras: ChatSendExtras): string {
        const turnId = newId('turn');
        const now = Date.now();
        const events = [this.thread.upsert({ id: turnId, kind: 'turn', createdAt: now, turnId, state: 'running', origin: 'user', endedAt: null, costUsd: 0 })];
        if (note !== null) {
            events.push(this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'info', text: note }));
        }
        if (text !== null) {
            const mentions = extras.mentions?.length ? extras.mentions : undefined;
            const skills = extras.skills?.length ? extras.skills : undefined;
            const attachments = extras.attachments?.length ? extras.attachments : undefined;
            events.push(this.thread.upsert({ id: newId('user'), kind: 'user', createdAt: now, turnId, text, mentions, skills, attachments }));
        }
        events.push(this.thread.patchInfo({ status: 'running', activeTurnId: turnId }));
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

    /* The diff of a turn that just ended, so a reload shows it without asking git again. */
    private settleCheckpoint(turnId: string): void {
        const turn = this.thread.get(turnId);
        if (turn?.kind !== 'turn' || turn.checkpoint === undefined || turn.checkpointDiff || !this.options.checkpoints) {
            return;
        }
        void this.options.checkpoints
            .diff(this.thread.info.cwd, turn.checkpoint)
            .then((diff) => {
                const settled = this.thread.get(turnId);
                if (diff === null || settled?.kind !== 'turn') {
                    return;
                }
                this.emit([this.thread.upsert({ ...settled, checkpointDiff: diff })]);
                this.options.persist();
            })
            .catch(() => undefined);
    }

    /* A link made or removed between turns; the agent hears about it once, in front of the next prompt. */
    private contextNote(text: string): string | null {
        // A slash command must stay the first thing the CLI reads; the change waits for a real prompt.
        if (text.startsWith('/')) {
            return null;
        }
        const current = this.options.contextSources?.() ?? [];
        const previous = this.lastSources;
        this.lastSources = current;
        return previous === null ? null : contextChangeNote(previous, current);
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
            .catch((error: unknown) => this.receive(this.generation, { type: 'failed', message: reason(error) }));
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
        this.generation += 1;
        const generation = this.generation;
        const info = this.thread.info;
        const launch: BackendLaunch = {
            command: this.options.command,
            cwd: info.cwd,
            env: this.options.env,
            selection: info.selection,
            runtimeMode: info.runtimeMode,
            resume: info.agentSessionId,
            generation,
            hasContext: this.options.hasContext()
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
        this.starting = backend
            .start()
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

    private receive(generation: number, event: BackendEvent): void {
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
        this.emit(this.projector.project(generation, event));
        const activeTurnId = this.thread.info.activeTurnId;
        if (openTurnId === null && activeTurnId !== null) {
            // The CLI opened this turn itself; it takes a checkpoint like any other, so the card can
            // show what the agent changed while nobody was watching.
            void this.checkpoint(activeTurnId);
            this.options.persist();
        }
        if (event.type === 'turn.done' || event.type === 'exit' || event.type === 'failed') {
            this.options.persist();
        } else if (event.type === 'tool.done') {
            this.options.persistSoon();
        }
        if (openTurnId !== null && activeTurnId === null) {
            this.settleCheckpoint(openTurnId);
        }
        // The turn is over and the CLI is still there, so whatever waited behind it can go out now.
        if (event.type === 'turn.done') {
            this.drainQueue();
        }
    }

    private emit(events: ChatEvent[]): void {
        for (const event of events) {
            this.options.emit(event);
        }
    }
}

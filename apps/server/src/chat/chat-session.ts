import type { ChatAttachment, ChatEvent, ChatInfo, ChatItem, ContextSource, InteractionMode, ModelSelection, RuntimeMode } from '@ruimte/contracts';
import { contextChangeNote } from '../context/context-note.ts';
import type { ChatProvider } from '../providers/provider.ts';
import type { BackendEvent, BackendLaunch, ChatBackend } from './backend.ts';
import { ChatError } from './errors.ts';
import { ThreadProjector } from './projector.ts';
import { ChatThread } from './thread.ts';

export interface ChatSessionOptions {
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
    emit(event: ChatEvent): void;
    persist(): void;
}

export interface ChatSendExtras {
    mentions?: string[];
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

    /* Model, permission or interaction changes; a turn in flight keeps its process until it ends. */
    configure(patch: { selection?: ModelSelection; runtimeMode?: RuntimeMode; interactionMode?: InteractionMode }): ChatInfo {
        const catalog = this.options.provider.catalog;
        const selection = patch.selection ? catalog.normalize(patch.selection) : this.thread.info.selection;
        const next: Partial<ChatInfo> = {
            selection,
            runtimeMode: patch.runtimeMode ?? this.thread.info.runtimeMode,
            interactionMode: patch.interactionMode ?? this.thread.info.interactionMode
        };
        const changed =
            JSON.stringify(next.selection) !== JSON.stringify(this.thread.info.selection) ||
            next.runtimeMode !== this.thread.info.runtimeMode ||
            next.interactionMode !== this.thread.info.interactionMode;
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

    send(text: string, extras: ChatSendExtras = {}): void {
        const note = this.contextNote(text);
        this.openTurn(text, note, extras);
        const input = {
            text,
            preamble: note,
            attachments: extras.attachments ?? [],
            mentions: extras.mentions ?? []
        };
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

    private openTurn(text: string | null, note: string | null, extras: ChatSendExtras): void {
        const turnId = newId('turn');
        const now = Date.now();
        const events = [this.thread.upsert({ id: turnId, kind: 'turn', createdAt: now, turnId, state: 'running', endedAt: null, costUsd: 0 })];
        if (note !== null) {
            events.push(this.thread.upsert({ id: newId('note'), kind: 'note', createdAt: now, turnId, level: 'info', text: note }));
        }
        if (text !== null) {
            const mentions = extras.mentions?.length ? extras.mentions : undefined;
            const attachments = extras.attachments?.length ? extras.attachments : undefined;
            events.push(this.thread.upsert({ id: newId('user'), kind: 'user', createdAt: now, turnId, text, mentions, attachments }));
        }
        events.push(this.thread.patchInfo({ status: 'running', activeTurnId: turnId }));
        this.emit(events);
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
        void this.ensureBackend()
            .then((backend) => {
                if (this.backend === backend) {
                    work(backend);
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
            interactionMode: info.interactionMode,
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
        this.emit(this.projector.project(generation, event));
        if (event.type === 'turn.done' || event.type === 'exit' || event.type === 'failed') {
            this.options.persist();
        }
    }

    private emit(events: ChatEvent[]): void {
        for (const event of events) {
            this.options.emit(event);
        }
    }
}

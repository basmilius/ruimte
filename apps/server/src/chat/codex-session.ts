import type { ChatInfo, InteractionMode, ModelSelection, RuntimeMode } from '@ruimte/contracts';
import { codexPromptPrefix, codexThreadOptions } from '../providers/codex.ts';
import type { ChatSessionOptions } from './chat-session.ts';
import { CodexStreamReducer, type CodexAction, type CodexReducerOutput } from './codex-stream.ts';
import { CodexTransport, type CodexFrame } from './codex-transport.ts';
import { ChatThread } from './thread.ts';

// After stdin closed, an app-server that is still around is not going to say more.
const EXIT_GRACE_MS = 3000;

const CLIENT_INFO = { name: 'ruimte', title: 'Ruimte', version: '0.1.0' };

const newId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const textInput = (text: string) => [{ type: 'text', text, text_elements: [] }];

/*
 * One Codex chat: the same shape as `ChatSession`, on `codex app-server` instead of a stream of
 * frames. The process is started on the first message and handshakes (initialize, then
 * thread/start or thread/resume) before the first turn goes out; every later request waits for
 * that handshake. A dead process is started again with thread/resume on the next send, which is
 * also how a changed model or mode takes effect.
 */
export class CodexChatSession {
    readonly thread: ChatThread;
    private readonly reducer: CodexStreamReducer;
    private readonly options: ChatSessionOptions;
    private readonly pending = new Map<string, CodexAction>();
    private transport: CodexTransport | null = null;
    private ready: Promise<CodexTransport> | null = null;
    private exitTimer: ReturnType<typeof setTimeout> | null = null;
    // Set by configure: the running process has the old settings, the next send starts a new one.
    private restartPending = false;

    constructor(options: ChatSessionOptions) {
        this.options = options;
        this.thread = new ChatThread(options.info, options.items);
        this.reducer = new CodexStreamReducer(this.thread);
    }

    get id(): string {
        return this.thread.info.chatId;
    }

    get info(): ChatInfo {
        return this.thread.info;
    }

    get running(): boolean {
        return this.transport !== null;
    }

    /* Model, permission or interaction changes; a turn in flight keeps its process until it ends. */
    configure(patch: { selection?: ModelSelection; runtimeMode?: RuntimeMode; interactionMode?: InteractionMode }): ChatInfo {
        const selection = patch.selection ? this.options.catalog.normalize(patch.selection) : this.thread.info.selection;
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
            next.usage = { ...this.thread.info.usage, contextWindow: this.options.catalog.contextWindowFor(selection) };
        }
        this.restartPending = this.transport !== null;
        this.apply({ events: [this.thread.patchInfo(next)], actions: [] });
        this.options.persist();
        return this.thread.info;
    }

    send(text: string): void {
        this.openTurn(text);
        const prompt = `${codexPromptPrefix(this.thread.info.interactionMode)}${text}`;
        this.run((transport) => transport.request('turn/start', { threadId: this.threadId(), input: textInput(prompt), ...this.turnOverrides() }));
    }

    /* Asks Codex to fold its context; it runs as a turn of its own with a compaction item. */
    compact(): void {
        this.openTurn(null);
        this.run((transport) => transport.request('thread/compact/start', { threadId: this.threadId() }));
    }

    cancel(): void {
        const turnId = this.reducer.turnId;
        if (!this.transport || !this.thread.info.activeTurnId || !turnId) {
            return;
        }
        void this.transport.request('turn/interrupt', { threadId: this.threadId(), turnId }).catch(() => {
            // A turn that already ended has nothing to interrupt.
        });
    }

    /* Answers a pending approval; false when nothing waits under that id. Codex takes no reason with a decline, so the message stays here. */
    approve(requestId: string, decision: 'allow' | 'allow-always' | 'deny', _message?: string): boolean {
        const item = this.thread.get(`approval-${requestId}`);
        const pending = this.pending.get(requestId);
        if (!pending || pending.type !== 'approval' || !item || item.kind !== 'approval' || item.decision !== 'pending' || !this.transport) {
            return false;
        }
        this.pending.delete(requestId);
        this.transport.respond(pending.rpcId, { decision: codexDecision(decision, pending) });
        this.apply({ events: [this.thread.upsert({ ...item, decision }), this.thread.setStatus('running')], actions: [] });
        return true;
    }

    /* Answers a pending question; false when nothing waits under that id. */
    answer(requestId: string, answers: Record<string, string>): boolean {
        const item = this.thread.get(`question-${requestId}`);
        const pending = this.pending.get(requestId);
        if (!pending || pending.type !== 'question' || !item || item.kind !== 'question' || item.state !== 'pending' || !this.transport) {
            return false;
        }
        this.pending.delete(requestId);
        if (pending.rpcId !== null) {
            const byId: Record<string, { answers: string[] }> = {};
            for (const question of item.questions) {
                const given = answers[question.id];
                if (given !== undefined) {
                    byId[question.id] = { answers: [given] };
                }
            }
            this.transport.respond(pending.rpcId, { answers: byId });
        } else {
            // An async question is answered like a message from the person, into the running turn.
            const lines = item.questions.map((question) => answers[question.id]).filter((given): given is string => given !== undefined);
            this.run((transport) => transport.request('turn/steer', { threadId: this.threadId(), input: textInput(lines.join('\n')) }));
        }
        this.apply({ events: [this.thread.upsert({ ...item, answers, state: 'answered' }), this.thread.setStatus('running')], actions: [] });
        return true;
    }

    /* Ends the process; the thread stays as it is. */
    stop(): void {
        const transport = this.transport;
        if (!transport) {
            return;
        }
        transport.end();
        this.exitTimer = setTimeout(() => {
            this.exitTimer = null;
            transport.kill('SIGTERM');
        }, EXIT_GRACE_MS);
    }

    dispose(): void {
        if (this.exitTimer !== null) {
            clearTimeout(this.exitTimer);
            this.exitTimer = null;
        }
        this.transport?.kill('SIGKILL');
        this.transport = null;
        this.ready = null;
    }

    private openTurn(text: string | null): void {
        const turnId = newId('turn');
        const now = Date.now();
        const events = [
            this.thread.upsert({ id: turnId, kind: 'turn', createdAt: now, turnId, state: 'running', endedAt: null, costUsd: 0 }),
            this.thread.patchInfo({ status: 'running', activeTurnId: turnId })
        ];
        if (text !== null) {
            events.splice(1, 0, this.thread.upsert({ id: newId('user'), kind: 'user', createdAt: now, turnId, text }));
        }
        this.apply({ events, actions: [] });
    }

    /* Runs one request after the handshake; a failure while the turn is still open ends the turn. */
    private run(work: (transport: CodexTransport) => Promise<unknown>): void {
        const ready = this.ensureProcess();
        void ready.then(work).catch((e: unknown) => {
            if (this.thread.info.activeTurnId === null) {
                return;
            }
            this.apply(this.reducer.fail(e instanceof Error ? e.message : String(e)));
            this.options.persist();
        });
    }

    private threadId(): string {
        return this.thread.info.agentSessionId ?? '';
    }

    private turnOverrides(): { model: string; effort?: string } {
        const effort = this.thread.info.selection.options.effort;
        return { model: this.thread.info.selection.model, ...(typeof effort === 'string' ? { effort } : {}) };
    }

    private ensureProcess(): Promise<CodexTransport> {
        if (this.transport && this.restartPending) {
            // Let the old one go quietly; its exit must not be read as the chat ending.
            const old = this.transport;
            this.transport = null;
            this.ready = null;
            old.end();
            setTimeout(() => old.kill('SIGTERM'), EXIT_GRACE_MS);
        }
        this.restartPending = false;
        if (this.transport && this.ready) {
            return this.ready;
        }
        const info = this.thread.info;
        this.reducer.nextProcess();
        let transport: CodexTransport;
        try {
            transport = new CodexTransport({
                command: this.options.command,
                cwd: info.cwd,
                env: this.options.env,
                onFrame: (frame) => this.handleFrame(transport, frame),
                onExit: (exitCode) => this.handleExit(transport, exitCode)
            });
        } catch (e) {
            return Promise.reject(e instanceof Error ? e : new Error(String(e)));
        }
        this.transport = transport;
        this.apply({ events: [this.thread.patchInfo({ running: true })], actions: [] });
        this.ready = this.handshake(transport);
        return this.ready;
    }

    private async handshake(transport: CodexTransport): Promise<CodexTransport> {
        const info = this.thread.info;
        await transport.request('initialize', { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true, requestAttestation: false } });
        transport.notify('initialized', {});
        const params = { cwd: info.cwd, model: info.selection.model, ...codexThreadOptions(info.runtimeMode, info.interactionMode) };
        let result: unknown;
        if (info.agentSessionId) {
            try {
                result = await transport.request('thread/resume', { threadId: info.agentSessionId, excludeTurns: true, ...params });
            } catch (e) {
                // The thread is gone from Codex's store; a fresh one keeps the chat usable.
                this.apply({
                    events: [
                        this.reducer.note('warning', `Codex could not resume its thread (${e instanceof Error ? e.message : String(e)}); starting a new one`)
                    ],
                    actions: []
                });
                result = await transport.request('thread/start', params);
            }
        } else {
            result = await transport.request('thread/start', params);
        }
        if (this.transport === transport) {
            this.apply(this.reducer.threadReady(result));
        }
        return transport;
    }

    private handleFrame(transport: CodexTransport, frame: CodexFrame): void {
        if (this.transport !== transport) {
            return;
        }
        const out = this.reducer.handle(frame);
        // A server request the reducer did not turn into an item still needs an answer, or Codex waits forever.
        if (frame.id !== undefined && out.actions.length === 0 && (typeof frame.id === 'number' || typeof frame.id === 'string')) {
            transport.respondError(frame.id, -32601, `Ruimte does not handle ${String(frame.method)}`);
        }
        this.apply(out);
        if (frame.method === 'turn/completed') {
            this.options.persist();
        }
    }

    private apply(out: CodexReducerOutput): void {
        for (const action of out.actions) {
            this.pending.set(action.requestId, action);
        }
        for (const event of out.events) {
            this.options.emit(event);
        }
        if (this.thread.info.activeTurnId === null && this.pending.size > 0) {
            this.pending.clear();
        }
    }

    private handleExit(transport: CodexTransport, exitCode: number | null): void {
        if (this.transport !== transport) {
            return;
        }
        if (this.exitTimer !== null) {
            clearTimeout(this.exitTimer);
            this.exitTimer = null;
        }
        this.transport = null;
        this.ready = null;
        this.pending.clear();
        this.apply(this.reducer.finish(exitCode));
        this.options.persist();
    }
}

/* The decision the app-server takes for one of ours; "always" becomes its own policy amendment when it offered one. */
const codexDecision = (decision: 'allow' | 'allow-always' | 'deny', pending: Extract<CodexAction, { type: 'approval' }>): unknown => {
    if (decision === 'deny') {
        return 'decline';
    }
    if (decision === 'allow') {
        return 'accept';
    }
    if (pending.amendment) {
        return { acceptWithExecpolicyAmendment: { execpolicy_amendment: pending.amendment } };
    }
    return pending.kind === 'fileChange' || pending.decisions.includes('acceptForSession') ? 'acceptForSession' : 'accept';
};

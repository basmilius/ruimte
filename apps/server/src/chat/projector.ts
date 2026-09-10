import type { ChatEvent, ChatItem, ChatToolItem, ChatToolProgress } from '@ruimte/contracts';
import type { BackendEvent } from './backend.ts';
import type { ChatThread } from './thread.ts';

/*
 * What a turn of the agent's own begins with: content that belongs to the main conversation. A frame
 * that carries a parent tool call is a subagent talking inside its own row and never opens a turn,
 * and a note or a usage line is not the agent starting to work.
 */
const startsAgentTurn = (event: BackendEvent): boolean => {
    switch (event.type) {
        case 'text.delta':
        case 'text.done':
        case 'approval.requested':
        case 'question.requested':
            return true;
        case 'tool.started':
            return event.parentRef === null;
        default:
            return false;
    }
};

interface ProjectorOptions {
    // How the CLI is named in the notes a stopped process leaves behind.
    providerName: string;
    now?(): number;
}

/*
 * The only place that turns what a CLI said into thread items. It reads and writes one `ChatThread`
 * and answers the events to broadcast; it never talks to a process, so a test can feed it by hand.
 * Item ids carry the process generation: a resumed CLI numbers its messages from the start again,
 * and an old item must not be overwritten by a new one that happens to share a key.
 */
export class ThreadProjector {
    private readonly thread: ChatThread;
    private readonly providerName: string;
    private readonly now: () => number;
    // What the last background task said it did; the label of the turn the CLI opens about it.
    private taskSummary: string | null = null;

    constructor(thread: ChatThread, options: ProjectorOptions) {
        this.thread = thread;
        this.providerName = options.providerName;
        this.now = options.now ?? Date.now;
    }

    project(generation: number, event: BackendEvent): ChatEvent[] {
        const events: ChatEvent[] = [];
        // The CLI talks outside a turn when it wakes the agent itself: a background task it launched
        // earlier settled. The work needs a turn of its own, or it lands in the thread unattached.
        if (this.thread.info.activeTurnId === null && startsAgentTurn(event)) {
            this.openAgentTurn(events);
        }
        const info = this.thread.info;
        switch (event.type) {
            case 'session':
                events.push(
                    this.thread.patchInfo({
                        agentSessionId: event.agentSessionId ?? info.agentSessionId,
                        model: event.model ?? info.model,
                        slashCommands: event.slashCommands?.length ? event.slashCommands : info.slashCommands,
                        skills: event.skills?.length ? event.skills : info.skills,
                        running: true
                    })
                );
                break;
            case 'text.delta':
                this.appendText(this.itemId(generation, event.ref), event.text, events);
                break;
            case 'text.done': {
                const id = this.itemId(generation, event.ref);
                const existing = this.thread.get(id);
                events.push(
                    this.thread.upsert({
                        id,
                        kind: 'assistant',
                        createdAt: existing?.createdAt ?? this.now(),
                        turnId: existing?.turnId ?? info.activeTurnId,
                        text: event.text,
                        streaming: false
                    })
                );
                break;
            }
            case 'tool.started':
                this.startTool(generation, event, events);
                break;
            case 'tool.progress':
                this.patchProgress(generation, event, events);
                break;
            case 'tool.output': {
                const delta = this.thread.appendText(this.itemId(generation, event.ref), event.text);
                if (delta) {
                    events.push(delta);
                }
                break;
            }
            case 'tool.done':
                this.settleTool(generation, event, events);
                break;
            case 'approval.requested':
                events.push(
                    this.thread.upsert({
                        id: `approval-${event.requestId}`,
                        kind: 'approval',
                        createdAt: this.now(),
                        turnId: info.activeTurnId,
                        requestId: event.requestId,
                        toolUseId: event.ref,
                        toolName: event.toolName,
                        input: event.input ?? {},
                        description: event.description,
                        canAllowAlways: event.canAllowAlways,
                        decision: 'pending'
                    })
                );
                events.push(this.thread.setStatus('needs-you'));
                break;
            case 'question.requested':
                events.push(
                    this.thread.upsert({
                        id: `question-${event.requestId}`,
                        kind: 'question',
                        createdAt: this.now(),
                        turnId: info.activeTurnId,
                        requestId: event.requestId,
                        questions: event.questions,
                        answers: null,
                        state: 'pending'
                    })
                );
                events.push(this.thread.setStatus('needs-you'));
                break;
            case 'request.withdrawn':
                this.withdraw(event.requestId, events);
                break;
            case 'task.done':
                // The tool row already settled from its own result; what is left is the summary,
                // which says what the turn the CLI opens next is about.
                this.taskSummary = event.summary ?? this.taskSummary;
                break;
            case 'usage':
                events.push(
                    this.thread.patchInfo({
                        usage: {
                            ...info.usage,
                            contextTokens: event.contextTokens ?? info.usage.contextTokens,
                            contextWindow: event.contextWindow ?? info.usage.contextWindow
                        }
                    })
                );
                break;
            case 'compaction':
                events.push(
                    this.thread.upsert({
                        id: `compaction-${this.now()}`,
                        kind: 'compaction',
                        createdAt: this.now(),
                        turnId: info.activeTurnId,
                        // A CLI that reports no size before the fold still has the tokens the last request carried.
                        preTokens: event.preTokens ?? (info.usage.contextTokens > 0 ? info.usage.contextTokens : null)
                    })
                );
                break;
            case 'model':
                events.push(this.thread.patchInfo({ model: event.model }));
                break;
            case 'note':
                events.push(this.note(event.level, event.text));
                break;
            case 'turn.done':
                this.finishTurn(event.state, event.costUsd, event.error, events);
                break;
            case 'failed':
                events.push(this.note('error', event.message));
                this.settleOpenItems(events);
                this.closeTurn('error', 0, events);
                events.push(this.thread.patchInfo({ status: 'error', activeTurnId: null }));
                break;
            case 'exit':
                this.finishProcess(event.exitCode, events);
                break;
        }
        return events;
    }

    /* A turn nobody asked for: no message of the person in front of it, the task's summary as its label. */
    private openAgentTurn(events: ChatEvent[]): void {
        const now = this.now();
        const turnId = `turn-${now}-${Math.random().toString(36).slice(2, 8)}`;
        const label = this.taskSummary;
        this.taskSummary = null;
        events.push(
            this.thread.upsert({
                id: turnId,
                kind: 'turn',
                createdAt: now,
                turnId,
                state: 'running',
                origin: 'agent',
                ...(label ? { label } : {}),
                endedAt: null,
                costUsd: 0
            })
        );
        events.push(this.thread.patchInfo({ status: 'running', activeTurnId: turnId }));
    }

    /* Whatever was open when the turn or the process ended: nobody is going to answer it now. */
    private settleOpenItems(events: ChatEvent[]): void {
        for (const item of this.thread.list()) {
            if (item.kind === 'assistant' && item.streaming) {
                events.push(this.thread.upsert({ ...item, streaming: false }));
            } else if (item.kind === 'approval' && item.decision === 'pending') {
                events.push(this.thread.upsert({ ...item, decision: 'cancelled' }));
            } else if (item.kind === 'question' && item.state === 'pending') {
                events.push(this.thread.upsert({ ...item, state: 'cancelled' }));
            } else if (item.kind === 'tool' && item.state === 'running') {
                events.push(this.thread.upsert({ ...item, state: 'error' }));
            }
        }
    }

    private itemId(generation: number, ref: string): string {
        return `${generation}:${ref}`;
    }

    private appendText(id: string, text: string, events: ChatEvent[]): void {
        const existing = this.thread.get(id);
        if (!existing) {
            events.push(
                this.thread.upsert({
                    id,
                    kind: 'assistant',
                    createdAt: this.now(),
                    turnId: this.thread.info.activeTurnId,
                    text,
                    streaming: true
                })
            );
            return;
        }
        const delta = text === '' ? null : this.thread.appendText(id, text);
        if (delta) {
            events.push(delta);
        }
    }

    private startTool(generation: number, event: Extract<BackendEvent, { type: 'tool.started' }>, events: ChatEvent[]): void {
        const id = this.itemId(generation, event.ref);
        const existing = this.thread.get(id);
        const previous = existing?.kind === 'tool' ? existing : undefined;
        const item: ChatToolItem = {
            id,
            kind: 'tool',
            createdAt: existing?.createdAt ?? this.now(),
            turnId: existing?.turnId ?? this.thread.info.activeTurnId,
            toolUseId: event.ref,
            name: event.name,
            input: event.input ?? {},
            output: previous?.output ?? null,
            state: previous?.state ?? 'running',
            parentToolUseId: event.parentRef
        };
        if (previous?.progress) {
            item.progress = previous.progress;
        }
        const changes = event.changes ?? previous?.changes;
        if (changes) {
            item.changes = changes;
        }
        events.push(this.thread.upsert(item));
    }

    private settleTool(generation: number, event: Extract<BackendEvent, { type: 'tool.done' }>, events: ChatEvent[]): void {
        const tool = this.thread.get(this.itemId(generation, event.ref));
        if (tool?.kind !== 'tool') {
            return;
        }
        // The result supersedes whatever progress said; a settled call carries none.
        const settled: ChatToolItem = { ...tool, output: event.output ?? tool.output, state: event.state };
        delete settled.progress;
        if (event.changes) {
            settled.changes = event.changes;
        }
        events.push(this.thread.upsert(settled));
    }

    private patchProgress(generation: number, event: Extract<BackendEvent, { type: 'tool.progress' }>, events: ChatEvent[]): void {
        const tool = this.thread.get(this.itemId(generation, event.ref));
        if (tool?.kind !== 'tool' || tool.state !== 'running') {
            return;
        }
        // A null field means the CLI said nothing about it this time, so what it said before stands.
        const progress: ChatToolProgress = {
            startedAt: event.startedAt ?? tool.progress?.startedAt ?? null,
            description: event.description ?? tool.progress?.description ?? null,
            output: tool.progress?.output ?? null
        };
        events.push(this.thread.upsert({ ...tool, progress }));
    }

    private withdraw(requestId: string, events: ChatEvent[]): void {
        const approval = this.thread.get(`approval-${requestId}`);
        if (approval?.kind === 'approval' && approval.decision === 'pending') {
            events.push(this.thread.upsert({ ...approval, decision: 'cancelled' }));
            events.push(this.thread.setStatus('running'));
        }
        const question = this.thread.get(`question-${requestId}`);
        if (question?.kind === 'question' && question.state === 'pending') {
            events.push(this.thread.upsert({ ...question, state: 'cancelled' }));
            events.push(this.thread.setStatus('running'));
        }
    }

    private finishTurn(state: 'done' | 'aborted' | 'error', costUsd: number, error: string | undefined, events: ChatEvent[]): void {
        if (error) {
            events.push(this.note('error', error));
        }
        this.settleOpenItems(events);
        this.closeTurn(state, costUsd, events);
        const usage = this.thread.info.usage;
        events.push(
            this.thread.patchInfo({
                status: 'idle',
                activeTurnId: null,
                usage: { ...usage, costUsd: costUsd || usage.costUsd, turns: usage.turns + 1 }
            })
        );
    }

    private finishProcess(exitCode: number | null, events: ChatEvent[]): void {
        this.settleOpenItems(events);
        const busy = this.thread.info.status === 'running' || this.thread.info.status === 'needs-you';
        if (busy || (exitCode !== null && exitCode !== 0)) {
            events.push(this.note('error', exitCode === null ? `${this.providerName} stopped` : `${this.providerName} exited with code ${exitCode}`));
        }
        this.closeTurn(busy ? 'error' : 'done', 0, events);
        events.push(this.thread.patchInfo({ running: false, status: busy ? 'error' : 'idle', activeTurnId: null }));
    }

    private closeTurn(state: 'done' | 'aborted' | 'error', costUsd: number, events: ChatEvent[]): void {
        const turnId = this.thread.info.activeTurnId;
        const turn = turnId ? this.thread.get(turnId) : undefined;
        if (turn?.kind !== 'turn') {
            return;
        }
        // The CLI reports what the whole chat cost so far; the turn keeps what it added.
        events.push(this.thread.upsert({ ...turn, state, endedAt: this.now(), costUsd: Math.max(0, costUsd - this.thread.info.usage.costUsd) }));
    }

    private note(level: 'info' | 'warning' | 'error', text: string): ChatEvent {
        const item: ChatItem = {
            id: `note-${this.now()}-${Math.random().toString(36).slice(2, 8)}`,
            kind: 'note',
            createdAt: this.now(),
            turnId: this.thread.info.activeTurnId,
            level,
            text
        };
        return this.thread.upsert(item);
    }
}

import type {
    ChatBackgroundTask,
    ChatEvent,
    ChatItem,
    ChatSubagentItem,
    ChatSubagentUsage,
    ChatToolItem,
    ChatToolProgress,
    ChatTurnLimit
} from '@ruimte/contracts';
import type { BackendEvent } from './backend.ts';
import { estimateContextBreakdown } from './context-breakdown.ts';
import type { ChatThread } from './thread.ts';

/*
 * What a turn of the agent's own begins with: content that belongs to the main conversation. A frame
 * that carries a parent tool call is a subagent talking inside its own row and never opens a turn,
 * and a note or a usage line is not the agent starting to work.
 */
const startsAgentTurn = (event: BackendEvent): boolean => {
    switch (event.type) {
        case 'text.done':
            return !event.parentRef;
        case 'text.delta':
        case 'thinking.delta':
        case 'thinking.done':
        case 'approval.requested':
        case 'question.requested':
            return true;
        case 'tool.started':
            return event.parentRef === null;
        default:
            return false;
    }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/* A markdown code block around text that may hold backticks of its own. */
const fenced = (text: string): string => {
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}\n${text}\n${fence}`;
};

// The Agent tool is what Claude Code calls a delegation; older builds and other CLIs say Task.
const isAgentTool = (name: string): boolean => name === 'Agent' || name === 'Task';

// What the CLI answers a background launch with; the agent itself only settles much later.
const LAUNCH_PLACEHOLDER = 'Async agent launched successfully';
const WORKFLOW_LAUNCHED = 'Workflow launched in background';

// A subagent that works longer than the row can hold: what is kept is the beginning of its work.
const MAX_SUBAGENT_ITEMS = 200;
const MAX_SUBAGENT_TEXT = 64 * 1024;

// What the CLI appends to a foreground report, in its own prose. It ends the text, so a tolerant
// match is enough: when the CLI rewords it, the row shows a stray line and nothing breaks.
const AGENT_FOOTER = /\n*agentId:[^\n]*(?:\n+<usage>([\s\S]*?)<\/usage>)?\s*$/;
const NO_OUTPUT = '(Subagent completed but returned no output.)';

// How much of a notification's summary a turn header can carry before it stops being a header.
const MAX_SUMMARY_CHARS = 80;

/*
 * One line for the header of the turn a background subagent wakes. The CLI may hand its whole
 * report as the summary, so this takes the first line that says something, cut to a length a
 * header can show; the full report itself stays on the subagent's own row.
 */
export const summaryLine = (summary: string): string => {
    const first = summary.split('\n').find((line) => line.trim() !== '') ?? '';
    const text = first.replace(/\s+/g, ' ').trim();
    if (text.length <= MAX_SUMMARY_CHARS) {
        return text;
    }
    const cut = text.slice(0, MAX_SUMMARY_CHARS);
    const space = cut.lastIndexOf(' ');
    return `${(space > MAX_SUMMARY_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
};

const usageField = (text: string, name: string): number => {
    const match = new RegExp(`${name}:\\s*(\\d+)`).exec(text);
    return match ? Number(match[1]) : 0;
};

/* The report a foreground subagent ended with, without the footer the CLI adds, plus what it spent. */
export const stripAgentFooter = (output: string): { text: string | null; usage: ChatSubagentUsage | null } => {
    const match = AGENT_FOOTER.exec(output);
    const text = (match ? output.slice(0, match.index) : output).trim();
    const block = match?.[1];
    const usage = block
        ? { totalTokens: usageField(block, 'subagent_tokens'), toolUses: usageField(block, 'tool_uses'), durationMs: usageField(block, 'duration_ms') }
        : null;
    return { text: text === '' || text === NO_OUTPUT ? null : text, usage };
};

interface ProjectorOptions {
    // How the CLI is named in the notes a stopped process leaves behind.
    providerName: string;
    now?(): number;
}

/*
 * The only place that turns what a CLI said into thread items. It reads and writes one `ChatThread`
 * and never talks to a process, so a test can feed it by hand. Item ids carry the process generation,
 * since a resumed CLI numbers its messages from the start again and must not overwrite an old item.
 */
export class ThreadProjector {
    private readonly thread: ChatThread;
    private readonly providerName: string;
    private readonly now: () => number;
    // What the last background task said it did; the label of the turn the CLI opens about it.
    private taskSummary: string | null = null;
    // The subagent that turn is about, so its header can point at the row.
    private taskToolUseId: string | null = null;
    // Per subagent item: how much of its own work the thread already keeps.
    private readonly budgets = new Map<string, { items: number; textBytes: number }>();
    // Calls whose command runs on past the turn that made them, so settling that turn leaves their rows running.
    private readonly backgroundCalls = new Set<string>();
    // Agents a subagent opened whose call never reached the stream (a grandchild's own); only drill-in shows them.
    private readonly unplacedCalls = new Set<string>();
    // The stretch of thinking still open: its item, and which refs already streamed into it.
    private thinking: { id: string; refs: Set<string>; last: string | null } | null = null;

    constructor(thread: ChatThread, options: ProjectorOptions) {
        this.thread = thread;
        this.providerName = options.providerName;
        this.now = options.now ?? Date.now;
    }

    /* Forgets what it kept about items of a thread that was just emptied. */
    reset(): void {
        this.taskSummary = null;
        this.taskToolUseId = null;
        this.budgets.clear();
        this.backgroundCalls.clear();
        this.unplacedCalls.clear();
        this.thinking = null;
    }

    project(generation: number, event: BackendEvent): ChatEvent[] {
        const events: ChatEvent[] = [];
        // The CLI talks outside a turn when it wakes the agent itself: a background task it launched
        // earlier settled. The work needs a turn of its own, or it lands in the thread unattached.
        if (this.thread.info.activeTurnId === null && startsAgentTurn(event) && !this.restatesCall(generation, event)) {
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
            case 'thinking.delta':
                this.appendThinking(generation, event.ref, event.text, false, events);
                break;
            case 'thinking.done':
                this.appendThinking(generation, event.ref, event.text, true, events);
                break;
            case 'text.delta':
                this.closeThinking(events);
                this.appendText(this.itemId(generation, event.ref), event.text, events);
                break;
            case 'text.done': {
                if (event.parentRef) {
                    if (!this.insideNested(generation, event.parentRef)) {
                        this.appendSubagentText(generation, event.parentRef, event.ref, event.text, events);
                    }
                    break;
                }
                this.closeThinking(events);
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
                if (isAgentTool(event.name) && (event.parentRef === null || this.subagent(generation, event.parentRef) !== null)) {
                    if (event.parentRef === null) {
                        this.closeThinking(events);
                    }
                    this.startSubagent(generation, event, events);
                    break;
                }
                if (event.parentRef === null) {
                    this.closeThinking(events);
                } else if (this.insideNested(generation, event.parentRef)) {
                    break;
                }
                this.startTool(generation, event, events);
                break;
            case 'tool.progress':
                this.patchProgress(generation, event, events);
                break;
            case 'workflow.progress': {
                const tool = this.thread.get(this.itemId(generation, event.ref));
                if (tool?.kind === 'tool') {
                    const name = event.workflow.name ?? tool.workflow?.name ?? null;
                    events.push(this.thread.upsert({ ...tool, workflow: { ...event.workflow, name } }));
                }
                break;
            }
            case 'tool.output': {
                const delta = this.thread.appendText(this.itemId(generation, event.ref), event.text);
                if (delta) {
                    events.push(delta);
                }
                break;
            }
            case 'tool.done': {
                const target = this.thread.get(this.itemId(generation, event.ref));
                if (target?.kind === 'subagent') {
                    this.settleSubagent(target, event, events);
                    break;
                }
                if (target?.kind === 'tool' && target.name === 'Workflow' && event.state === 'done' && event.output?.startsWith(WORKFLOW_LAUNCHED)) {
                    // The call only launched the workflow; the row runs on past the turn until the workflow's task ends.
                    this.backgroundCalls.add(target.id);
                    events.push(this.thread.upsert({ ...target, output: event.output }));
                    break;
                }
                this.settleTool(generation, event, events);
                break;
            }
            case 'approval.requested':
                this.closeThinking(events);
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
                        ...(event.allowAlways ? { allowAlways: event.allowAlways } : {}),
                        decision: 'pending'
                    })
                );
                events.push(this.thread.setStatus('needs-you'));
                break;
            case 'question.requested':
                this.closeThinking(events);
                events.push(
                    this.thread.upsert({
                        id: `question-${event.requestId}`,
                        kind: 'question',
                        createdAt: this.now(),
                        turnId: info.activeTurnId,
                        requestId: event.requestId,
                        questions: event.questions,
                        async: event.async,
                        answers: null,
                        state: 'pending'
                    })
                );
                events.push(this.thread.setStatus('needs-you'));
                break;
            case 'request.withdrawn':
                this.withdraw(event.requestId, events);
                break;
            case 'task.started':
                this.patchSubagentStart(generation, event, events);
                break;
            case 'task.progress':
                this.patchSubagentProgress(generation, event, events);
                break;
            case 'task.done': {
                // Keep one summary line for the next turn's header; the tool row already has the result. A nested
                // agent reports to the agent that opened it, so it only names that turn when no row of the thread's own does.
                const row = this.taskSubagent(generation, event.ref, event.taskId);
                const nested = row?.parentToolUseId !== undefined || (event.ref !== null && this.unplacedCalls.has(event.ref));
                const line = event.summary === null ? '' : summaryLine(event.summary);
                if (line !== '' && (!nested || this.taskSummary === null)) {
                    this.taskSummary = line;
                }
                if (row && (!nested || this.taskToolUseId === null)) {
                    this.taskToolUseId = row.toolUseId;
                }
                this.settleBackgroundSubagent(row, event, events);
                this.settleLaunchedCall(generation, event, events);
                break;
            }
            case 'background.started':
                this.startBackground(generation, event, events);
                break;
            case 'background.ended': {
                const background = info.background ?? [];
                if (background.some((task) => task.id === event.taskId)) {
                    events.push(this.thread.patchInfo({ background: background.filter((task) => task.id !== event.taskId) }));
                }
                break;
            }
            case 'usage': {
                const contextTokens = event.contextTokens ?? info.usage.contextTokens;
                events.push(
                    this.thread.patchInfo({
                        usage: {
                            ...info.usage,
                            contextTokens,
                            contextWindow: event.contextWindow ?? info.usage.contextWindow,
                            breakdown: contextTokens > 0 ? estimateContextBreakdown(this.thread.list(), contextTokens) : undefined
                        }
                    })
                );
                break;
            }
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
                this.finishTurn(event.state, event.costUsd, event.error, events, event.native, event.limit);
                break;
            case 'failed':
                events.push(this.note('error', event.message));
                this.settleOpenItems(events, true);
                this.closeTurn('error', 0, events);
                events.push(this.thread.patchInfo({ status: 'error', activeTurnId: null }));
                break;
            case 'exit':
                this.finishProcess(event.exitCode, event.stderr ?? null, events);
                break;
        }
        return events;
    }

    /* A turn nobody asked for: no message of the person in front of it, the task's summary as its label. */
    private openAgentTurn(events: ChatEvent[]): void {
        const now = this.now();
        const turnId = `turn-${now}-${Math.random().toString(36).slice(2, 8)}`;
        const label = this.taskSummary;
        const taskToolUseId = this.taskToolUseId;
        this.taskSummary = null;
        this.taskToolUseId = null;
        events.push(
            this.thread.upsert({
                id: turnId,
                kind: 'turn',
                createdAt: now,
                turnId,
                state: 'running',
                origin: 'agent',
                ...(label ? { label } : {}),
                ...(taskToolUseId ? { taskToolUseId } : {}),
                endedAt: null,
                costUsd: 0
            })
        );
        events.push(this.thread.patchInfo({ status: this.thread.statusFor(turnId), activeTurnId: turnId }));
    }

    /*
     * Whatever was open when the turn or the process ended: nobody is going to answer it now. A
     * background subagent is the exception, since it outlives the turn that launched it on purpose;
     * only a process that is gone takes it down too. A request is another: the CLI takes one of its own
     * turn back itself, and one of work running beside the turn waits until a person stops the turn.
     */
    private settleOpenItems(events: ChatEvent[], processGone = false, dropRequests = processGone): void {
        this.thinking = null;
        for (const item of this.thread.list()) {
            if (item.kind === 'assistant' && item.streaming) {
                events.push(this.thread.upsert({ ...item, streaming: false }));
            } else if (item.kind === 'thinking' && item.streaming) {
                events.push(this.thread.upsert({ ...item, streaming: false, endedAt: this.now() }));
            } else if (item.kind === 'approval' && item.decision === 'pending' && dropRequests) {
                events.push(this.thread.upsert({ ...item, decision: 'cancelled' }));
            } else if (item.kind === 'question' && item.state === 'pending' && dropRequests) {
                events.push(this.thread.upsert({ ...item, state: 'cancelled' }));
            } else if (item.kind === 'tool' && item.state === 'running' && (processGone || !this.backgroundCalls.has(item.id))) {
                events.push(this.thread.upsert({ ...item, state: 'error' }));
            } else if (item.kind === 'subagent' && item.status === 'running' && (processGone || !this.outlivesTurn(item))) {
                events.push(this.thread.upsert({ ...item, status: 'failed', finishedAt: this.now() }));
            }
        }
    }

    /* A background agent, or one working for an agent that still does, since the turn ending does not end its parent either. */
    private outlivesTurn(item: ChatSubagentItem): boolean {
        if (item.background) {
            return true;
        }
        const parentRef = item.parentToolUseId;
        const parent = parentRef === undefined ? undefined : this.thread.find('subagent', (candidate) => candidate.toolUseId === parentRef);
        return parent?.status === 'running' && this.outlivesTurn(parent);
    }

    /* A call the thread already has a row for, told again after its turn ended (a snapshot Codex sends late), is no new work. */
    private restatesCall(generation: number, event: BackendEvent): boolean {
        return event.type === 'tool.started' && this.thread.get(this.itemId(generation, event.ref)) !== undefined;
    }

    private itemId(generation: number, ref: string): string {
        return `${generation}:${ref}`;
    }

    /*
     * One thinking item per stretch: consecutive blocks (Claude's thinking blocks, Codex's reasoning
     * parts) land in the same item, separated by a blank line, and the first real content of the turn
     * closes it. A `.done` for a ref that already streamed adds nothing; it is what a replayed item
     * carries for a client that missed the deltas.
     */
    private appendThinking(generation: number, ref: string, text: string, done: boolean, events: ChatEvent[]): void {
        const key = this.itemId(generation, ref);
        const open = this.thinking;
        if (open?.refs.has(key) && done) {
            return;
        }
        if (!open && text.trim() === '') {
            return;
        }
        if (!open) {
            const id = `${key}:think`;
            this.thinking = { id, refs: new Set([key]), last: key };
            events.push(
                this.thread.upsert({ id, kind: 'thinking', createdAt: this.now(), turnId: this.thread.info.activeTurnId, text, streaming: true, endedAt: null })
            );
            return;
        }
        const separator = open.last !== null && open.last !== key ? '\n\n' : '';
        open.refs.add(key);
        open.last = key;
        const delta = this.thread.appendText(open.id, `${separator}${text}`);
        if (delta) {
            events.push(delta);
        }
    }

    /* Ends the stretch: the row stops shimmering and starts saying how long it took. */
    private closeThinking(events: ChatEvent[]): void {
        const open = this.thinking;
        this.thinking = null;
        const item = open ? this.thread.get(open.id) : undefined;
        if (item?.kind === 'thinking' && item.streaming) {
            events.push(this.thread.upsert({ ...item, streaming: false, endedAt: this.now() }));
        }
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
        const parent = event.parentRef === null ? null : this.subagent(generation, event.parentRef);
        if (parent && !existing && !this.takeChildSlot(parent, 0, events)) {
            return;
        }
        const item: ChatToolItem = {
            id,
            kind: 'tool',
            createdAt: existing?.createdAt ?? this.now(),
            turnId: existing?.turnId ?? parent?.turnId ?? this.thread.info.activeTurnId,
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
        this.backgroundCalls.delete(tool.id);
        if (tool.parentToolUseId !== null) {
            const parent = this.subagent(generation, tool.parentToolUseId);
            if (parent) {
                this.budgetFor(parent).textBytes += (event.output ?? '').length;
            }
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

    private subagent(generation: number, ref: string): ChatSubagentItem | null {
        const item = this.thread.get(this.itemId(generation, ref));
        return item?.kind === 'subagent' ? item : null;
    }

    /*
     * The row a task frame is about. A message that wakes a settled agent again names the call that
     * sent it (SendMessage), so only the agent's own id still leads to the row it already has.
     */
    private taskSubagent(generation: number, ref: string | null, taskId: string | null | undefined): ChatSubagentItem | null {
        const byRef = ref === null ? null : this.subagent(generation, ref);
        if (byRef || !taskId) {
            return byRef;
        }
        return this.thread.list().findLast((item): item is ChatSubagentItem => item.kind === 'subagent' && item.native?.agentId === taskId) ?? null;
    }

    /*
     * Whether a frame belongs to an agent a subagent opened. Its work stays out of the thread, however
     * much the CLI forwards: the row says it runs and how it ended, its own conversation says the rest.
     */
    private insideNested(generation: number, parentRef: string): boolean {
        return this.subagent(generation, parentRef)?.parentToolUseId !== undefined;
    }

    private budgetFor(parent: ChatSubagentItem): { items: number; textBytes: number } {
        const budget = this.budgets.get(parent.id) ?? { items: 0, textBytes: 0 };
        this.budgets.set(parent.id, budget);
        return budget;
    }

    /*
     * Whether a subagent may keep one more piece of its work in the thread. Past the cap the row says
     * so and stops collecting; a research agent can make hundreds of calls and the thread is a file.
     */
    private takeChildSlot(parent: ChatSubagentItem, textBytes: number, events: ChatEvent[]): boolean {
        const budget = this.budgetFor(parent);
        if (budget.items >= MAX_SUBAGENT_ITEMS || budget.textBytes >= MAX_SUBAGENT_TEXT) {
            if (!parent.itemsTruncated) {
                events.push(this.thread.upsert({ ...parent, itemsTruncated: true }));
            }
            return false;
        }
        budget.items += 1;
        budget.textBytes += textBytes;
        return true;
    }

    /*
     * A delegation: the row that carries the agent's own work and the report it ends with. One a subagent
     * opened hangs under that agent's row, in the turn its parent works in.
     */
    private startSubagent(generation: number, event: Extract<BackendEvent, { type: 'tool.started' }>, events: ChatEvent[]): void {
        const id = this.itemId(generation, event.ref);
        const previous = this.subagent(generation, event.ref);
        const parent = event.parentRef === null ? null : this.subagent(generation, event.parentRef);
        const input = isRecord(event.input) ? event.input : {};
        const now = this.now();
        const parentToolUseId = previous?.parentToolUseId ?? parent?.toolUseId;
        const item: ChatSubagentItem = {
            id,
            kind: 'subagent',
            createdAt: previous?.createdAt ?? now,
            turnId: previous?.turnId ?? parent?.turnId ?? this.thread.info.activeTurnId,
            toolUseId: event.ref,
            description: previous?.description || str(input.description) || '',
            subagentType: previous?.subagentType ?? str(input.subagent_type),
            prompt: previous?.prompt ?? str(input.prompt),
            background: previous?.background ?? input.run_in_background === true,
            status: previous?.status ?? 'running',
            startedAt: previous?.startedAt ?? now,
            finishedAt: previous?.finishedAt ?? null,
            summary: previous?.summary ?? null,
            result: previous?.result ?? null,
            usage: previous?.usage ?? null,
            lastTool: previous?.lastTool ?? null,
            itemsTruncated: previous?.itemsTruncated ?? false,
            ...(previous?.outputFile ? { outputFile: previous.outputFile } : {}),
            ...(previous?.native ? { native: previous.native } : {}),
            ...(parentToolUseId === undefined ? {} : { parentToolUseId })
        };
        events.push(this.thread.upsert(item));
    }

    /* What the CLI itself says about the delegation: which agent it is, and whether it blocks the turn. */
    private patchSubagentStart(generation: number, event: Extract<BackendEvent, { type: 'task.started' }>, events: ChatEvent[]): void {
        const existing = this.thread.get(this.itemId(generation, event.ref));
        // An agent a subagent opened, whose call the stream never showed, has no row to hang under.
        if (!existing && (event.depth ?? 1) > 1) {
            this.unplacedCalls.add(event.ref);
            return;
        }
        if (!existing) {
            this.startSubagent(generation, { type: 'tool.started', ref: event.ref, name: 'Agent', input: {}, parentRef: null }, events);
        }
        const item = this.taskSubagent(generation, event.ref, event.taskId);
        if (!item) {
            return;
        }
        // A settled agent that starts again under another call was woken by a message, and works on in the background.
        const resumed = item.status !== 'running' && item.toolUseId !== event.ref;
        events.push(
            this.thread.upsert({
                ...item,
                description: item.description || event.description || '',
                subagentType: item.subagentType ?? event.subagentType,
                prompt: item.prompt ?? event.prompt,
                background: event.background,
                ...(resumed ? { status: 'running', startedAt: this.now(), finishedAt: null } : {}),
                ...(event.taskId || event.threadId
                    ? {
                          native: {
                              ...item.native,
                              ...(event.taskId ? { agentId: event.taskId } : {}),
                              ...(event.threadId ? { threadId: event.threadId } : {})
                          }
                      }
                    : {})
            })
        );
    }

    private patchSubagentProgress(generation: number, event: Extract<BackendEvent, { type: 'task.progress' }>, events: ChatEvent[]): void {
        const item = this.taskSubagent(generation, event.ref, event.taskId);
        if (!item || item.status !== 'running') {
            return;
        }
        events.push(
            this.thread.upsert({
                ...item,
                summary: event.summary ?? item.summary,
                lastTool: event.lastTool ?? item.lastTool,
                usage: event.usage ?? item.usage
            })
        );
    }

    /* Text a subagent wrote: part of its row, and the candidate for the report it ends with. */
    private appendSubagentText(generation: number, parentRef: string, ref: string, text: string, events: ChatEvent[]): void {
        const parent = this.subagent(generation, parentRef);
        if (!parent) {
            return;
        }
        const id = this.itemId(generation, ref);
        const existing = this.thread.get(id);
        if (!existing && !this.takeChildSlot(parent, text.length, events)) {
            return;
        }
        events.push(
            this.thread.upsert({
                id,
                kind: 'assistant',
                createdAt: existing?.createdAt ?? this.now(),
                turnId: parent.turnId,
                text,
                streaming: false,
                parentToolUseId: parentRef
            })
        );
        const open = this.subagent(generation, parentRef);
        if (open && text.trim() !== '') {
            events.push(this.thread.upsert({ ...open, result: text }));
        }
    }

    /* The Agent call answered: a foreground agent is done, a background one has only been launched. */
    private settleSubagent(item: ChatSubagentItem, event: Extract<BackendEvent, { type: 'tool.done' }>, events: ChatEvent[]): void {
        const output = event.output ?? '';
        if (output.startsWith(LAUNCH_PLACEHOLDER)) {
            const outputFile = /output_file:\s*(\S+)/.exec(output)?.[1];
            events.push(this.thread.upsert({ ...item, background: true, ...(outputFile ? { outputFile } : {}) }));
            return;
        }
        const report = stripAgentFooter(output);
        events.push(
            this.thread.upsert({
                ...item,
                status: event.state === 'error' ? 'failed' : 'done',
                finishedAt: this.now(),
                result: report.text ?? item.result,
                usage: report.usage ?? item.usage
            })
        );
    }

    /* The notification a background agent settles with; its report is the last text it wrote. */
    private settleBackgroundSubagent(item: ChatSubagentItem | null, event: Extract<BackendEvent, { type: 'task.done' }>, events: ChatEvent[]): void {
        if (!item) {
            return;
        }
        const full = event.summary?.trim() ?? '';
        const line = full === '' ? null : summaryLine(full);
        // The row says in one line what the agent did. When the CLI put its whole report in the
        // summary, that report is the best one this row will ever get: it goes behind the fold.
        const result = item.result ?? (line !== null && full !== line ? full : null);
        // A resumed agent notifies more than once; one that already settled only learns what came of it.
        if (item.status !== 'running') {
            events.push(this.thread.upsert({ ...item, summary: line ?? item.summary, result }));
            return;
        }
        events.push(
            this.thread.upsert({
                ...item,
                status: event.ok ? 'done' : 'failed',
                finishedAt: this.now(),
                summary: line ?? item.summary,
                result,
                usage: event.usage ?? item.usage,
                ...(event.outputFile ? { outputFile: event.outputFile } : {})
            })
        );
    }

    /* A call whose work ran on past its own answer, such as a workflow, settled by the task it ran as. */
    private settleLaunchedCall(generation: number, event: Extract<BackendEvent, { type: 'task.done' }>, events: ChatEvent[]): void {
        const call = event.ref === null ? undefined : this.thread.get(this.itemId(generation, event.ref));
        if (call?.kind !== 'tool' || call.state !== 'running' || !this.backgroundCalls.has(call.id)) {
            return;
        }
        this.backgroundCalls.delete(call.id);
        const summary = event.summary?.trim() ?? '';
        const output = summary === '' ? call.output : [call.output, summary].filter((part) => part !== null && part !== '').join('\n\n');
        const settled: ChatToolItem = { ...call, output, state: event.ok ? 'done' : 'error' };
        delete settled.progress;
        events.push(this.thread.upsert(settled));
    }

    /* A shell or a monitor, told apart by the call that started it when the CLI's frame does not say. */
    private startBackground(generation: number, event: Extract<BackendEvent, { type: 'background.started' }>, events: ChatEvent[]): void {
        const background = this.thread.info.background ?? [];
        if (background.some((task) => task.id === event.taskId)) {
            return;
        }
        const call = event.ref === null ? undefined : this.thread.get(this.itemId(generation, event.ref));
        const tool = call?.kind === 'tool' ? call : null;
        if (tool !== null) {
            this.backgroundCalls.add(tool.id);
        }
        const input = tool && isRecord(tool.input) ? tool.input : {};
        const task: ChatBackgroundTask = {
            id: event.taskId,
            kind: event.monitor || event.ref === null || tool?.name === 'Monitor' ? 'monitor' : 'shell',
            description: event.description ?? str(input.description) ?? '',
            command: str(input.command),
            startedAt: this.now()
        };
        events.push(this.thread.patchInfo({ background: [...background, task] }));
    }

    private withdraw(requestId: string, events: ChatEvent[]): void {
        const approval = this.thread.get(`approval-${requestId}`);
        if (approval?.kind === 'approval' && approval.decision === 'pending') {
            events.push(this.thread.upsert({ ...approval, decision: 'cancelled' }));
            events.push(this.thread.setStatus(this.thread.statusFor(this.thread.info.activeTurnId)));
        }
        const question = this.thread.get(`question-${requestId}`);
        if (question?.kind === 'question' && question.state === 'pending') {
            events.push(this.thread.upsert({ ...question, state: 'cancelled' }));
            events.push(this.thread.setStatus(this.thread.statusFor(this.thread.info.activeTurnId)));
        }
    }

    private finishTurn(
        state: 'done' | 'aborted' | 'error',
        costUsd: number,
        error: string | undefined,
        events: ChatEvent[],
        native: { turnId?: string; lastUuid?: string } | undefined,
        limit: ChatTurnLimit | undefined
    ): void {
        if (error) {
            events.push(this.note('error', error));
        }
        this.settleOpenItems(events, false, state === 'aborted');
        this.closeTurn(state, costUsd, events, native, limit);
        const usage = this.thread.info.usage;
        events.push(
            this.thread.patchInfo({
                status: this.thread.statusFor(null),
                activeTurnId: null,
                usage: { ...usage, costUsd: costUsd || usage.costUsd, turns: usage.turns + 1 },
                limit: state === 'error' ? limit : undefined
            })
        );
    }

    private finishProcess(exitCode: number | null, stderr: string | null, events: ChatEvent[]): void {
        this.settleOpenItems(events, true);
        // Waiting on a person between turns is not a turn the process took down with it.
        const { status, activeTurnId } = this.thread.info;
        const busy = status === 'running' || (status === 'needs-you' && activeTurnId !== null);
        if (busy || (exitCode !== null && exitCode !== 0)) {
            const reason = exitCode === null ? `${this.providerName} stopped` : `${this.providerName} exited with code ${exitCode}`;
            // A note shows its first line and folds the rest open as markdown.
            events.push(this.note('error', stderr === null ? reason : `${reason}\n\n${fenced(stderr)}`));
        }
        this.closeTurn(busy ? 'error' : 'done', 0, events);
        // Whatever ran beside the turns went with the process.
        events.push(
            this.thread.patchInfo({
                running: false,
                status: busy ? 'error' : 'idle',
                activeTurnId: null,
                ...(this.thread.info.background?.length ? { background: [] } : {})
            })
        );
    }

    private closeTurn(
        state: 'done' | 'aborted' | 'error',
        costUsd: number,
        events: ChatEvent[],
        native?: { turnId?: string; lastUuid?: string },
        limit?: ChatTurnLimit
    ): void {
        const turnId = this.thread.info.activeTurnId;
        const turn = turnId ? this.thread.get(turnId) : undefined;
        if (turn?.kind !== 'turn') {
            return;
        }
        // The CLI reports what the whole chat cost so far; the turn keeps what it added.
        events.push(
            this.thread.upsert({
                ...turn,
                state,
                endedAt: this.now(),
                costUsd: Math.max(0, costUsd - this.thread.info.usage.costUsd),
                ...(native === undefined ? {} : { native }),
                ...(limit === undefined || state !== 'error' ? {} : { limit })
            })
        );
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

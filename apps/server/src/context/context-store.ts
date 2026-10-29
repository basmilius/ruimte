import type {
    ChatApprovalDecision,
    ChatItem,
    ChatQuestion,
    ChatQuestionItem,
    ChatWorkflow,
    ChatWorkflowAgent,
    ContextSource,
    DeviceInfo,
    DiagramDocument,
    DrawingElement,
    Plan,
    ProjectCanvasView
} from '@ruimte/contracts';
import { workflowAgentRef } from '@ruimte/contracts';
import { renderPlanText } from '@adecore/plan';
import { contextChangeNote } from './context-note.ts';
import { CodedError } from '@adecore/agents';
import { readRefusal } from './read-refusal.ts';
import type { Reference } from './references.ts';
import type { PageReading } from '../browser/drive.ts';
import { renderPage } from './context-browser.ts';
import { renderDevice } from './context-device.ts';
import { renderDiagram } from './context-diagram.ts';
import { renderDrawing } from './context-drawing.ts';
import { readableAssistantText } from '@adecore/agents/chat';
import { chatReadUsage, chatUsageLine, type ChatReadUsage, type ChatUsageInfo } from './chat-usage.ts';

export const CONTEXT_PATH = '/context';

// A screen is read live; this keeps a long scrollback from flooding an agent's context.
export const MAX_SCREEN_LINES = 2000;

function lastLines(text: string, count: number | null): string {
    if (count === null) {
        return text;
    }
    const lines = text.split('\n');
    return lines.slice(Math.max(0, lines.length - count)).join('\n');
}

function asReading(text: string | null): ContextReading | null {
    return text === null ? null : { text };
}

/* A read that found nothing to answer, under the code and the sentence that say why. */
export class ContextRefusal extends CodedError {}

/* A `--subagent` read that cannot be answered, with the sentence that says why. */
export class SubagentUnreadable extends ContextRefusal {
    constructor(message: string) {
        super('unknown-subagent', message);
    }
}

interface ContextReaders {
    /* What the agent under this id may read, derived from the project documents the daemon knows. */
    sources(targetId: string): ContextSource[];
    /* The views, nodes and chats a person pointed at in a message of this chat. Readable like a line, but
       never listed or announced as one: the message that pointed at them already said where they are. */
    referenced?(targetId: string): Reference[];
    /* The agent under `sourceId` when `targetId` opened it itself. Readable like a line and never listed,
       since the verb that opened it already named it. */
    opened?(targetId: string, sourceId: string): ContextSource | null;
    /* The elements of a drawing view, or null when no open project has one under that id. */
    drawingElements(viewId: string): Promise<DrawingElement[] | null>;
    /* The diagram of a view in the project of the agent asking, or in `projectId` when given, whether or not anyone has that project open. */
    diagramDocument(targetId: string, viewId: string, projectId?: string): Promise<DiagramDocument | null>;
    /* The version an artifact node shows, as text when its first file is text, checked against the project of the one reading, or `projectId`; null when it is not there. */
    artifactReport?(targetId: string, artifact: NonNullable<ContextSource['artifact']>, projectId?: string): Promise<string | null>;
    /* A routine node's routine and its newest runs, checked against the project of the one reading, or `projectId`; null when it is not there. */
    routineReport?(targetId: string, routineId: string, projectId?: string): Promise<string | null>;
    /* The plain text of a terminal session's screen and scrollback, or null when there is none. */
    terminalText(sessionId: string): Promise<string | null>;
    /* A chat's thread, or null when there is none. */
    chatItems(chatId: string): ChatItem[] | null | Promise<ChatItem[] | null>;
    /* The page under a browser node wherever it is open, here or in a client holding it; null when nobody has it open. */
    browserPage?(browserId: string): Promise<PageReading | null>;
    /* The devices this machine has right now, for looking up what a device node points at. */
    devices?(): Promise<DeviceInfo[]>;
    /* The plans a chat keeps, oldest first. */
    chatPlans?(chatId: string): Promise<Plan[]>;
    /* The whole conversation of one subagent of a chat; throws when the CLI kept none for it. */
    subagentItems?(chatId: string, toolUseId: string): Promise<ChatItem[]>;
    /* The canvas this agent is a node on, for saying why a read of a neighbor is refused; null when
       it is a view of its own, or when no known project places it. */
    canvasOf?(targetId: string): ProjectCanvasView | null;
    /* The model and usage of a chat, which a read of it starts with; null when there is none. */
    chatInfo?(chatId: string): ChatUsageInfo | null | Promise<ChatUsageInfo | null>;
    now?(): number;
}

/* A source as text, and for a chat the usage its first line says in words. */
export interface ContextReading {
    text: string;
    usage?: ChatReadUsage;
}

/* The first line of a subagent's report that says something, which is all a line about it has room for. */
function firstLine(text: string | null): string {
    return (
        (text ?? '')
            .split('\n')
            .find((line) => line.trim() !== '')
            ?.trim() ?? ''
    );
}

/* The request id stays on a request that no longer waits, so the state beside it is what tells a parent not to answer it. */
const QUESTION_STATES: Record<ChatQuestionItem['state'], string> = {
    pending: 'waits for an answer',
    answered: 'answered',
    cancelled: 'cancelled',
    dismissed: 'dismissed'
};

const APPROVAL_STATES: Record<ChatApprovalDecision, string> = {
    pending: 'waits for a person',
    allow: 'allowed',
    'allow-always': 'allowed always',
    deny: 'denied',
    cancelled: 'cancelled'
};

/* What `ruimte-context answer` needs of one waiting question besides the request: its id and what it may pick. */
function pendingQuestionLine(question: ChatQuestion): string {
    const how =
        question.choices.length === 0
            ? 'answer in your own words'
            : `choices ${question.choices.map((choice) => choice.label).join(' | ')}${question.multiSelect ? ', one or more' : ''}, or your own words`;
    return `- question ${question.id}: ${how}`;
}

/* An agent of a workflow, by the id `--subagent` reads its conversation under. */
function workflowAgentText(agent: ChatWorkflowAgent): string {
    return `${agent.label} (${agent.status}, ${agent.agentId === null ? 'not started yet' : workflowAgentRef(agent.agentId)})`;
}

/* What a Workflow call runs, one line per phase, so a parent can follow a child's workflow without opening it. */
function workflowLines(workflow: ChatWorkflow): string[] {
    const inPhase = (index: number): ChatWorkflowAgent[] => workflow.agents.filter((agent) => agent.phaseIndex === index);
    const phases = workflow.phases.map((phase) => {
        const agents = inPhase(phase.index);
        return `- phase ${phase.index} "${phase.title}": ${agents.length === 0 ? 'not started yet' : agents.map(workflowAgentText).join(', ')}`;
    });
    const loose = workflow.agents.filter((agent) => !workflow.phases.some((phase) => phase.index === agent.phaseIndex));
    return [
        `Workflow${workflow.name === null ? '' : ` "${workflow.name}"`}, each agent readable with --subagent and the id beside it:`,
        ...phases,
        ...(loose.length === 0 ? [] : [`- outside a phase: ${loose.map(workflowAgentText).join(', ')}`])
    ];
}

/*
 * A chat thread as an agent should read it: who said what, and what tools ran. A subagent is one line:
 * the work it did inside its row is its own, and printed between the parent's lines it would read as
 * if the parent had done it. Its whole conversation is `read <id> --subagent <toolUseId>`.
 */
export function renderTranscript(items: ChatItem[]): string {
    const lines: string[] = [];
    for (const item of items) {
        if ((item.kind === 'tool' || item.kind === 'assistant') && item.parentToolUseId) {
            continue;
        }
        switch (item.kind) {
            case 'subagent': {
                const report = firstLine(item.result ?? item.summary);
                lines.push(`> Subagent "${item.description}" (${item.status}, ${item.toolUseId})${report ? `: ${report}` : ''}`, '');
                break;
            }
            case 'user':
                lines.push('## User', '');
                if (item.uiChoice) {
                    lines.push(`Chose ${JSON.stringify(item.uiChoice.label)}`, '');
                }
                lines.push(item.text, '');
                break;
            case 'assistant':
                if (item.text.trim() !== '') {
                    lines.push('## Assistant', '', readableAssistantText(item), '');
                }
                break;
            case 'tool': {
                const input = typeof item.input === 'object' && item.input !== null ? JSON.stringify(item.input) : String(item.input ?? '');
                lines.push(`> Tool ${item.name} (${item.state}): ${input.slice(0, 300)}`);
                if (item.workflow !== undefined) {
                    lines.push(...workflowLines(item.workflow));
                }
                if (item.output) {
                    lines.push('', '```', item.output.slice(0, 2000), '```', '');
                }
                break;
            }
            case 'question': {
                const answers = item.answers ? ` -> ${Object.values(item.answers).join(', ')}` : '';
                lines.push(
                    `> Question (${QUESTION_STATES[item.state]}, request ${item.requestId}): ${item.questions.map((question) => question.question).join(' / ')}${answers}`
                );
                if (item.state === 'pending') {
                    lines.push(...item.questions.map(pendingQuestionLine));
                }
                lines.push('');
                break;
            }
            case 'approval':
                lines.push(
                    `> Approval (${APPROVAL_STATES[item.decision]}, request ${item.requestId}): ${item.toolName}${item.description ? `: ${item.description}` : ''}`,
                    ''
                );
                break;
            case 'note':
                lines.push(`> ${item.text}`, '');
                break;
            default:
                break;
        }
    }
    return lines.join('\n').trim();
}

/*
 * What each agent node may read, as its project's document says. Texts carry their content;
 * terminals and chats are read at request time, so an agent always sees the current state.
 */
export class ContextStore {
    private readonly readers: ContextReaders;
    /* The last set of links each agent was told about, so the next turn can be told what moved. */
    private readonly told = new Map<string, ContextSource[]>();

    constructor(readers: ContextReaders) {
        this.readers = readers;
    }

    has(targetId: string): boolean {
        return this.readers.sources(targetId).length > 0;
    }

    /*
     * What changed since this agent was last told, for a terminal agent's hooks: it has no moment
     * between turns the way a chat has. Null the first time, since the first answer carries the whole list.
     */
    changeSince(targetId: string): string | null {
        const current = this.readers.sources(targetId);
        const previous = this.told.get(targetId) ?? null;
        this.told.set(targetId, current);
        return previous === null ? null : contextChangeNote(previous, current);
    }

    list(targetId: string): ContextSource[] {
        return this.readers.sources(targetId).map(({ text: _text, nodeId: _nodeId, device: _device, ...source }) => source);
    }

    /*
     * One source as text. `tail` is counted here rather than in the CLI, since only this side knows
     * what a line of each kind is, and the wire then carries fifteen lines instead of two thousand.
     */
    async read(targetId: string, sourceId: string, tail: number | null = null, subagent: string | null = null): Promise<string | null> {
        const source = this.sourceFor(targetId, sourceId);
        return source ? ((await this.reading(targetId, source, tail, subagent))?.text ?? null) : null;
    }

    private async reading(
        targetId: string,
        source: ContextSource,
        tail: number | null,
        subagent: string | null,
        projectId?: string
    ): Promise<ContextReading | null> {
        if (subagent !== null) {
            return { text: await this.readSubagent(source, subagent, tail) };
        }
        switch (source.kind) {
            case 'text':
                return asReading(lastLines(source.text ?? '', tail));
            case 'terminal': {
                const text = await this.readers.terminalText(source.id);
                // The screen cap stays the ceiling: a --tail past it cannot reach further back than the daemon keeps.
                return asReading(text === null ? null : lastLines(text, Math.min(tail ?? MAX_SCREEN_LINES, MAX_SCREEN_LINES)));
            }
            case 'chat':
                return this.readChat(source.id, tail);
            // The address the project file knows stands in when nobody has the page open.
            case 'browser': {
                const page = (await this.readers.browserPage?.(source.id).catch(() => null)) ?? null;
                if (page === null) {
                    return asReading(renderPage(source.text ?? '', null, tail));
                }
                return asReading(renderPage(page.url || (source.text ?? ''), page.text, tail, true));
            }
            // Looked up now rather than when the line was drawn: what a machine has changes while nobody touches the canvas.
            case 'device': {
                if (!source.device) {
                    return null;
                }
                return asReading(renderDevice(source.device, (await this.readers.devices?.().catch(() => [])) ?? []));
            }
            case 'drawing': {
                const elements = await this.readers.drawingElements(source.id);
                return asReading(elements ? renderDrawing(elements, tail) : null);
            }
            case 'diagram': {
                const document = await this.readers.diagramDocument(targetId, source.id, projectId);
                return asReading(document ? renderDiagram(document, tail) : null);
            }
            /*
             * The path, never the bytes: an agent's own file tools read a fresher copy, and a large file
             * cannot push the rest of its context out.
             */
            case 'file':
                return asReading(source.text ? `This is a file on disk. Read it with your own tools.\n\n${source.text}` : null);
            case 'artifact': {
                const text = source.artifact ? ((await this.readers.artifactReport?.(targetId, source.artifact, projectId).catch(() => null)) ?? null) : null;
                return asReading(text === null ? null : lastLines(text, tail));
            }
            case 'routine': {
                const text = source.routine ? ((await this.readers.routineReport?.(targetId, source.routine, projectId).catch(() => null)) ?? null) : null;
                return asReading(text === null ? null : lastLines(text, tail));
            }
        }
    }

    /* What a person pointed this agent at in its messages, read again at every call. */
    referenced(targetId: string): Reference[] {
        return this.readers.referenced?.(targetId) ?? [];
    }

    // Only what is linked into the asker matches, so a node id opens nothing an edge, a person's reference or the asker's own lineage did not.
    sourceFor(targetId: string, sourceId: string): ContextSource | null {
        return (
            this.reachable(targetId).find((entry) => entry.id === sourceId || entry.nodeId === sourceId) ?? this.readers.opened?.(targetId, sourceId) ?? null
        );
    }

    private reachable(targetId: string): ContextSource[] {
        return [...this.readers.sources(targetId), ...this.referenced(targetId).flatMap((reference) => reference.sources)];
    }

    private async readChat(chatId: string, tail: number | null): Promise<ContextReading | null> {
        const items = await this.readers.chatItems(chatId);
        if (!items) {
            return null;
        }
        const thread = lastLines(renderTranscript(items), tail);
        // Above the thread, where a tail never cuts it off: how far a child got is what its parent reads for first.
        const plans = (await this.readers.chatPlans?.(chatId).catch(() => [])) ?? [];
        const text = plans.length === 0 ? thread : `${plans.map((plan) => renderPlanText(plan)).join('\n\n')}\n\n${thread}`;
        const info = (await this.readers.chatInfo?.(chatId)) ?? null;
        if (info === null) {
            return { text };
        }
        // Kept under a tail too: whether a child is near its window or about to lose its cache is a parent's cheap question.
        const usage = chatReadUsage(info, this.readers.now?.() ?? Date.now());
        return { text: `${chatUsageLine(usage)}\n\n${text}`, usage };
    }

    /* A subagent is only ever reached through the chat it belongs to, so a link to that chat is what lets it be read. */
    private async readSubagent(source: ContextSource, toolUseId: string, tail: number | null): Promise<string> {
        if (source.kind !== 'chat') {
            throw new SubagentUnreadable(`${source.id} is a ${source.kind}, and only a chat has subagents`);
        }
        if (!this.readers.subagentItems) {
            throw new SubagentUnreadable('This machine cannot read the conversation of a subagent');
        }
        let items: ChatItem[];
        try {
            items = await this.readers.subagentItems(source.id, toolUseId);
        } catch (e) {
            throw new SubagentUnreadable(e instanceof Error ? e.message : `No conversation for subagent ${toolUseId}`);
        }
        return lastLines(renderTranscript(items), tail);
    }

    /*
     * One source as text, or a refusal that says why there is none. Only this side has the canvas the
     * id may be a node on, so a line drawn the other way round reads apart from an id nobody drew.
     */
    async answer(targetId: string, sourceId: string, tail: number | null, subagent: string | null): Promise<ContextReading> {
        const source = this.sourceFor(targetId, sourceId);
        const reading = source ? await this.reading(targetId, source, tail, subagent) : null;
        if (reading === null) {
            const { code, message, lines } = readRefusal(targetId, sourceId, this.reachable(targetId), this.readers.canvasOf?.(targetId) ?? null);
            throw new ContextRefusal(code, message, lines);
        }
        return reading;
    }

    /*
     * The same for a source that comes with its own reason to be read, so there is no line to explain;
     * `projectId` is the project it stands in when that is not the reader's own.
     */
    async answerSource(targetId: string, source: ContextSource, tail: number | null, subagent: string | null, projectId?: string): Promise<ContextReading> {
        const reading = await this.reading(targetId, source, tail, subagent, projectId);
        if (reading === null) {
            throw new ContextRefusal('unreadable', `${source.nodeId ?? source.id} is there, but there is nothing to read in it right now`);
        }
        return reading;
    }
}

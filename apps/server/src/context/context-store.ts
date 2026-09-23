import type { ChatItem, ContextSource, DeviceInfo, DiagramDocument, DrawingElement, Plan, ProjectCanvasView } from '@ruimte/contracts';
import { renderPlanText } from '@ruimte/plan';
import { contextChangeNote } from './context-note.ts';
import { CodedError } from '../coded-error.ts';
import { readRefusal } from './read-refusal.ts';
import { renderPage } from './context-browser.ts';
import { renderDevice } from './context-device.ts';
import { renderDiagram } from './context-diagram.ts';
import { renderDrawing } from './context-drawing.ts';

export const CONTEXT_PATH = '/context';

// A screen is read live; this keeps a long scrollback from flooding an agent's context.
export const MAX_SCREEN_LINES = 2000;

/* What `--tail` asks for. */
const lastLines = (text: string, count: number): string => {
    const lines = text.split('\n');
    return lines.slice(Math.max(0, lines.length - count)).join('\n');
};

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
    /* The elements of a drawing view, or null when no open project has one under that id. */
    drawingElements(viewId: string): Promise<DrawingElement[] | null>;
    /* The diagram of a view in the project of the agent asking, whether or not anyone has that project open. */
    diagramDocument(targetId: string, viewId: string): Promise<DiagramDocument | null>;
    /* The plain text of a terminal session's screen and scrollback, or null when there is none. */
    terminalText(sessionId: string): Promise<string | null>;
    /* A chat's thread, or null when there is none. */
    chatItems(chatId: string): ChatItem[] | null;
    /* The text of the page this machine has open under a browser node, null when it has none. */
    browserText?(browserId: string): Promise<string | null>;
    /* The devices this machine has right now, for looking up what a device node points at. */
    devices?(): Promise<DeviceInfo[]>;
    /* The plans a chat keeps, oldest first. */
    chatPlans?(chatId: string): Promise<Plan[]>;
    /* The whole conversation of one subagent of a chat; throws when the CLI kept none for it. */
    subagentItems?(chatId: string, toolUseId: string): Promise<ChatItem[]>;
    /* The canvas this agent is a node on, for saying why a read of a neighbor is refused; null when
       it is a view of its own, or when no known project places it. */
    canvasOf?(targetId: string): ProjectCanvasView | null;
}

/* The first line of a subagent's report that says something, which is all a line about it has room for. */
const firstLine = (text: string | null): string =>
    (text ?? '')
        .split('\n')
        .find((line) => line.trim() !== '')
        ?.trim() ?? '';

/*
 * A chat thread as an agent should read it: who said what, and what tools ran. A subagent is one line:
 * the work it did inside its row is its own, and printed between the parent's lines it would read as
 * if the parent had done it. Its whole conversation is `read <id> --subagent <toolUseId>`.
 */
export const renderTranscript = (items: ChatItem[]): string => {
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
                lines.push('## User', '', item.text, '');
                break;
            case 'assistant':
                if (item.text.trim() !== '') {
                    lines.push('## Assistant', '', item.text, '');
                }
                break;
            case 'tool': {
                const input = typeof item.input === 'object' && item.input !== null ? JSON.stringify(item.input) : String(item.input ?? '');
                lines.push(`> Tool ${item.name} (${item.state}): ${input.slice(0, 300)}`);
                if (item.output) {
                    lines.push('', '```', item.output.slice(0, 2000), '```', '');
                }
                break;
            }
            case 'question':
                lines.push(
                    `> Question: ${item.questions.map((question) => question.question).join(' / ')}${item.answers ? ` -> ${Object.values(item.answers).join(', ')}` : ''}`,
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
};

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
     * What changed since this agent was last told, and remembers what it is being told now. A chat
     * hears this between two turns of its own (`ChatSession`); a terminal agent has no such moment
     * and hears it through its hooks, which is the only way a line drawn while the shell runs
     * reaches the model at all. Null the first time, since the first answer carries the whole list.
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
     * One source as text. `tail` is the cheap read: the last lines of it, counted here rather than
     * in the CLI, because only this side knows what a line of each kind is (a chat and a drawing
     * are rendered here) and because the wire then carries fifteen lines instead of two thousand.
     */
    async read(targetId: string, sourceId: string, tail: number | null = null, subagent: string | null = null): Promise<string | null> {
        // Only what is linked into the asker matches, so a node id opens nothing an edge did not.
        const source = this.readers.sources(targetId).find((entry) => entry.id === sourceId || entry.nodeId === sourceId);
        if (!source) {
            return null;
        }
        if (subagent !== null) {
            return this.readSubagent(source, subagent, tail);
        }
        switch (source.kind) {
            case 'text':
                return tail === null ? (source.text ?? '') : lastLines(source.text ?? '', tail);
            case 'terminal': {
                const text = await this.readers.terminalText(source.id);
                if (text === null) {
                    return null;
                }
                // The screen cap stays the ceiling: a --tail past it cannot reach further back than the daemon keeps.
                return lastLines(text, Math.min(tail ?? MAX_SCREEN_LINES, MAX_SCREEN_LINES));
            }
            case 'chat': {
                const items = this.readers.chatItems(source.id);
                if (!items) {
                    return null;
                }
                const transcript = renderTranscript(items);
                const thread = tail === null ? transcript : lastLines(transcript, tail);
                // Above the thread, where a tail never cuts it off: how far a child got is what its parent reads for first.
                const plans = (await this.readers.chatPlans?.(source.id).catch(() => [])) ?? [];
                return plans.length === 0 ? thread : `${plans.map((plan) => renderPlanText(plan)).join('\n\n')}\n\n${thread}`;
            }
            /* The page as it stands, under the address the project file knows. Reading never moves it;
               where the page goes is `ruimte-context browser`, over the same line. */
            case 'browser': {
                const text = (await this.readers.browserText?.(source.id).catch(() => null)) ?? null;
                return renderPage(source.text ?? '', text, tail);
            }
            /* Which device, looked up now rather than when the line was drawn: what a machine has
               changes while nobody touches the canvas. A tail has three lines to leave out, so it does nothing. */
            case 'device': {
                if (!source.device) {
                    return null;
                }
                return renderDevice(source.device, (await this.readers.devices?.().catch(() => [])) ?? []);
            }
            case 'drawing': {
                const elements = await this.readers.drawingElements(source.id);
                return elements ? renderDrawing(elements, tail) : null;
            }
            case 'diagram': {
                const document = await this.readers.diagramDocument(targetId, source.id);
                return document ? renderDiagram(document, tail) : null;
            }
            /*
             * The path, never the bytes. An agent has file tools of its own, so reading it there is
             * fresher than whatever this answered, it does not count twice against the window, and a
             * file of a megabyte cannot push the rest of the context out. A drawing is the opposite
             * case, which is why that one is rendered here: an agent can read it nowhere else.
             * Three lines is the whole answer, so `--tail` has nothing to leave out here.
             */
            case 'file':
                return source.text ? `This is a file on disk. Read it with your own tools.\n\n${source.text}` : null;
        }
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
        const transcript = renderTranscript(items);
        return tail === null ? transcript : lastLines(transcript, tail);
    }

    /*
     * One source as text, or a refusal that says why there is none. Only this side has the canvas the
     * id may be a node on, so a line drawn the other way round reads apart from an id nobody drew.
     */
    async answer(targetId: string, sourceId: string, tail: number | null, subagent: string | null): Promise<string> {
        const text = await this.read(targetId, sourceId, tail, subagent);
        if (text === null) {
            const { code, message, lines } = readRefusal(targetId, sourceId, this.readers.sources(targetId), this.readers.canvasOf?.(targetId) ?? null);
            throw new ContextRefusal(code, message, lines);
        }
        return text;
    }
}

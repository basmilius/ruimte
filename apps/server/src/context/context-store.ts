import type { ChatItem, ContextSource, DiagramDocument, DrawingElement } from '@ruimte/contracts';
import { contextChangeNote } from './context-note.ts';
import { renderDiagram } from './context-diagram.ts';
import { renderDrawing } from './context-drawing.ts';

export const CONTEXT_PATH = '/context';

// A screen is read live; this keeps a long scrollback from flooding an agent's context.
export const MAX_SCREEN_LINES = 2000;

/* The last `count` lines of a text, which is what `--tail` asks for. */
const lastLines = (text: string, count: number): string => {
    const lines = text.split('\n');
    return lines.slice(Math.max(0, lines.length - count)).join('\n');
};

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
    /* The target a bearer token speaks for: a terminal session or a chat. */
    targetForToken(token: string): string | null;
}

/* A chat thread as an agent should read it: who said what, and what tools ran. */
export const renderTranscript = (items: ChatItem[]): string => {
    const lines: string[] = [];
    for (const item of items) {
        switch (item.kind) {
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
        return this.readers.sources(targetId).map(({ text: _text, nodeId: _nodeId, ...source }) => source);
    }

    /*
     * One source as text. `tail` is the cheap read: the last lines of it, counted here rather than
     * in the CLI, because only this side knows what a line of each kind is (a chat and a drawing
     * are rendered here) and because the wire then carries fifteen lines instead of two thousand.
     */
    async read(targetId: string, sourceId: string, tail: number | null = null): Promise<string | null> {
        // Only what is linked into the asker matches, so a node id opens nothing an edge did not.
        const source = this.readers.sources(targetId).find((entry) => entry.id === sourceId || entry.nodeId === sourceId);
        if (!source) {
            return null;
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
                return tail === null ? transcript : lastLines(transcript, tail);
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

    /* `GET /context` lists, `GET /context/<id>[?tail=N]` reads; the bearer token names the agent asking. */
    async handle(request: Request, pathname: string): Promise<Response> {
        if (request.method !== 'GET') {
            return new Response('Method not allowed', { status: 405 });
        }
        const header = request.headers.get('authorization') ?? '';
        const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
        const targetId = token ? this.readers.targetForToken(token) : null;
        if (!targetId) {
            return new Response('Unknown token', { status: 401 });
        }
        const rest = pathname.slice(CONTEXT_PATH.length).replace(/^\//, '');
        if (rest === '') {
            return Response.json({ sources: this.list(targetId) });
        }
        const asked = new URL(request.url).searchParams.get('tail');
        const tail = asked === null ? null : Number(asked);
        if (tail !== null && (!Number.isInteger(tail) || tail < 1)) {
            return new Response('tail takes a positive whole number of lines', { status: 400 });
        }
        const text = await this.read(targetId, decodeURIComponent(rest), tail);
        if (text === null) {
            return new Response('No such source', { status: 404 });
        }
        return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
}

import type { ChatItem, ContextSource } from '@ruimte/contracts';

export const CONTEXT_PATH = '/context';

// A screen is read live; this keeps a long scrollback from flooding an agent's context.
const MAX_LINES = 2000;

export interface ContextReaders {
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
 * What each agent node may read, as the client last told us. Texts arrive with their content;
 * terminals and chats are read at request time, so an agent always sees the current state.
 */
export class ContextStore {
    private readonly readers: ContextReaders;
    private readonly byTarget = new Map<string, ContextSource[]>();

    constructor(readers: ContextReaders) {
        this.readers = readers;
    }

    set(targetId: string, sources: ContextSource[]): void {
        if (sources.length === 0) {
            this.byTarget.delete(targetId);
        } else {
            this.byTarget.set(targetId, sources);
        }
    }

    has(targetId: string): boolean {
        return this.byTarget.has(targetId);
    }

    list(targetId: string): ContextSource[] {
        return (this.byTarget.get(targetId) ?? []).map(({ text: _text, ...source }) => source);
    }

    async read(targetId: string, sourceId: string): Promise<string | null> {
        const source = this.byTarget.get(targetId)?.find((entry) => entry.id === sourceId);
        if (!source) {
            return null;
        }
        switch (source.kind) {
            case 'text':
                return source.text ?? '';
            case 'terminal': {
                const text = await this.readers.terminalText(source.id);
                if (text === null) {
                    return null;
                }
                const lines = text.split('\n');
                return lines.slice(Math.max(0, lines.length - MAX_LINES)).join('\n');
            }
            case 'chat': {
                const items = this.readers.chatItems(source.id);
                return items ? renderTranscript(items) : null;
            }
        }
    }

    /* `GET /context` lists, `GET /context/<id>` reads; the bearer token names the agent asking. */
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
        const text = await this.read(targetId, decodeURIComponent(rest));
        if (text === null) {
            return new Response('No such source', { status: 404 });
        }
        return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
}

import type { EventMap, EventType, RequestMap, RequestType } from '@ruimte/contracts';
import { applyContentChanges, type ContentChange } from '@adecore/lsp';
import { TransportError, type Transport, type TransportStatus } from '@/transport/transport';

interface Call {
    type: string;
    payload: unknown;
}

/*
 * A transport with the daemon's side of the language wire in it, as far as a client can tell: it
 * owns each document's version the way the daemon does, so what the client does about a refused
 * change can be asserted against it. Requests the test wants to answer itself go through `answers`.
 */
export class FakeLanguageTransport implements Transport {
    status: TransportStatus = 'open';
    calls: Call[] = [];
    /* Each document by stored path: the text and version the daemon holds. */
    documents = new Map<string, { text: string; version: number; languageId: string }>();
    answers = new Map<string, (payload: never) => unknown>();
    /* What the daemon says a document may ask, which a test sets before the document opens. */
    providers: Record<string, unknown> = { 'textDocument/hover': {}, 'textDocument/completion': { triggerCharacters: ['.'] } };
    /* Held replies, released by a test to decide their order against events and changes. */
    private gates: Array<() => void> = [];
    private holdNext = false;
    private readonly handlers = new Map<string, Set<(value: never) => void>>();
    private readonly statusListeners = new Set<(status: TransportStatus) => void>();

    async request<T extends RequestType>(type: T, payload: RequestMap[T]['payload']): Promise<RequestMap[T]['result']> {
        this.calls.push({ type, payload });
        const answer = this.answers.get(type);
        // The daemon takes a request in the order it came, and answers it a turn later.
        const result = answer ? answer(payload as never) : this.daemon(type, payload as never);
        if (this.holdNext) {
            this.holdNext = false;
            await new Promise<void>((resolve) => this.gates.push(resolve));
        }
        await Promise.resolve();
        return result as RequestMap[T]['result'];
    }

    on<E extends EventType>(event: E, handler: (payload: EventMap[E]) => void): () => void {
        const handlers = this.handlers.get(event) ?? new Set();
        handlers.add(handler as (value: never) => void);
        this.handlers.set(event, handlers);
        return () => {
            handlers.delete(handler as (value: never) => void);
        };
    }

    subscribeStatus(listener: (status: TransportStatus) => void): () => void {
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
    }

    emit<E extends EventType>(event: E, payload: EventMap[E]): void {
        this.handlers.get(event)?.forEach((handler) => handler(payload as never));
    }

    setStatus(status: TransportStatus): void {
        this.status = status;
        this.statusListeners.forEach((listener) => listener(status));
    }

    /* The next request is answered only when `release` says so, though the daemon has already acted on it. */
    holdNextReply(): void {
        this.holdNext = true;
    }

    release(): void {
        this.gates.shift()?.();
    }

    callsOf(type: string): Call[] {
        return this.calls.filter((call) => call.type === type);
    }

    private daemon(
        type: string,
        payload: { path: string; text: string; languageId: string; baseVersion: number; version?: number; changes: ContentChange[]; method?: string }
    ): unknown {
        if (type === 'language.document.open') {
            const held = this.documents.get(payload.path);
            if (!held) {
                this.documents.set(payload.path, { text: payload.text, version: 1, languageId: payload.languageId });
            } else if (held.text !== payload.text) {
                held.text = payload.text;
                held.version++;
            }
            return {
                version: this.documents.get(payload.path)?.version,
                servers: ['typescript'],
                providers: this.providers
            };
        }
        const held = this.documents.get(payload.path);
        if (type === 'language.document.close') {
            this.documents.delete(payload.path);
            return {};
        }
        if (!held) {
            throw new TransportError('document-not-open', `${payload.path} is not open`);
        }
        if (type === 'language.document.change') {
            if (payload.baseVersion !== held.version) {
                throw new TransportError('stale-document', 'stale');
            }
            held.text = applyContentChanges(held.text, payload.changes);
            return { version: ++held.version };
        }
        if (type === 'language.request') {
            if (payload.version !== undefined && payload.version !== held.version) {
                throw new TransportError('stale-document', 'stale');
            }
            return {
                result: payload.method === 'textDocument/hover' ? { contents: `hover at ${held.version}` } : null,
                server: 'typescript',
                version: held.version
            };
        }
        throw new Error(`The fake daemon does not know ${type}`);
    }
}

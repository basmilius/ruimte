import { LspSession } from './session.ts';
import type { LspTransport, RpcMessage, ServerCapabilities } from './protocol.ts';

/* A transport that records what is sent and lets a test say what comes back, for tests that assert on the exact wire. */
export class ScriptedTransport implements LspTransport {
    sent: RpcMessage[] = [];
    messages = new Set<(message: unknown) => void>();
    closes = new Set<(error?: Error) => void>();
    autoInitialize: ServerCapabilities | undefined;

    send(message: RpcMessage): void {
        this.sent.push(message);
        if ('method' in message && message.method === 'initialize' && 'id' in message && this.autoInitialize) {
            queueMicrotask(() => this.emit({ jsonrpc: '2.0', id: message.id, result: { capabilities: this.autoInitialize } }));
        }
        if ('method' in message && message.method === 'shutdown' && 'id' in message) {
            queueMicrotask(() => this.emit({ jsonrpc: '2.0', id: message.id, result: null }));
        }
    }

    onMessage(listener: (message: unknown) => void) {
        this.messages.add(listener);
        return {
            dispose: () => {
                this.messages.delete(listener);
            }
        };
    }

    onClose(listener: (error?: Error) => void) {
        this.closes.add(listener);
        return {
            dispose: () => {
                this.closes.delete(listener);
            }
        };
    }

    close() {
        for (const listener of this.closes) {
            listener();
        }
    }

    emit(message: RpcMessage) {
        for (const listener of this.messages) {
            listener(message);
        }
    }

    /* The last request of `method` the client sent. */
    request(method: string) {
        return [...this.sent].reverse().find((message) => 'method' in message && message.method === method && 'id' in message) as {
            id: number;
            params: unknown;
        };
    }

    respond(method: string, result: unknown) {
        this.emit({ jsonrpc: '2.0', id: this.request(method).id, result });
    }

    methods(): string[] {
        return this.sent.flatMap((message) => ('method' in message ? [message.method] : []));
    }
}

export async function flush(): Promise<void> {
    for (let i = 0; i < 15; i++) {
        await Promise.resolve();
    }
}

export const origin = { line: 0, character: 0 };

export async function sessionWith(capabilities: ServerCapabilities = {}) {
    const transport = new ScriptedTransport();
    transport.autoInitialize = { textDocumentSync: 2, ...capabilities };
    const session = new LspSession(transport);
    await session.initialize();
    return { transport, session };
}

/* Bun runs the event loop inside `expect(promise).rejects` of a promise that has not settled, so a rejection that comes later is checked here. */
export function rejecting(promise: Promise<unknown>, check: (error: unknown) => void): Promise<void> {
    return promise.then(
        () => {
            throw new Error('Expected the promise to reject');
        },
        (error) => check(error)
    );
}

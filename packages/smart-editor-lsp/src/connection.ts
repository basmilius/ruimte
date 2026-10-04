import type { Disposable, LspTransport, RequestId, RequestOptions, RpcMessage, RpcRequest } from './protocol.ts';

/* The JSON-RPC and LSP codes this package answers with. */
export const ErrorCodes = {
    InvalidRequest: -32600,
    MethodNotFound: -32601,
    InternalError: -32603,
    ServerNotInitialized: -32002,
    RequestCancelled: -32800,
    ContentModified: -32801
} as const;

export class LspError extends Error {
    readonly code: number;
    readonly data?: unknown;

    constructor(message: string, code: number = ErrorCodes.InternalError, data?: unknown) {
        super(message);
        this.name = 'LspError';
        this.code = code;
        this.data = data;
    }
}

/* The document changed or closed before the answer arrived, so the answer describes a text that is gone. */
export class StaleResultError extends LspError {
    readonly uri: string;

    constructor(uri: string) {
        super(`The document changed before its language result arrived: ${uri}`, ErrorCodes.ContentModified);
        this.name = 'StaleResultError';
        this.uri = uri;
    }
}

export type RequestHandler = (params: unknown, signal: AbortSignal) => unknown | Promise<unknown>;
type NotificationHandler = (params: unknown) => void | Promise<void>;

interface PendingRequest {
    resolve(value: unknown): void;
    reject(error: unknown): void;
    cleanup(): void;
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

/* JSON-RPC 2.0 over an `LspTransport`: correlation, cancellation, and the requests a server sends back. */
export class JsonRpcConnection {
    readonly transport: LspTransport;
    readonly timeoutMs: number;
    private nextId = 0;
    private closed = false;
    private sendQueue: Promise<void> = Promise.resolve();
    private readonly pending = new Map<RequestId, PendingRequest>();
    private readonly incoming = new Map<RequestId, AbortController>();
    private readonly handlers = new Map<string, RequestHandler>();
    private readonly notifications = new Map<string, Set<NotificationHandler>>();
    private readonly errors = new Set<(error: Error) => void>();
    private readonly closes = new Set<(error?: Error) => void>();
    private readonly subscriptions: Disposable[];

    /* A `timeoutMs` of 0 turns the deadline off; a request then ends by its reply or its signal. */
    constructor(transport: LspTransport, timeoutMs = 30_000) {
        this.transport = transport;
        this.timeoutMs = timeoutMs;
        this.subscriptions = [
            transport.onMessage((message) => {
                void this.receive(message).catch((error) => this.reportError(error));
            }),
            transport.onClose((error) => this.finish(error))
        ];
    }

    get isClosed(): boolean {
        return this.closed;
    }

    request<T = unknown>(method: string, params?: unknown, options: RequestOptions = {}): Promise<T> {
        if (this.closed) {
            return Promise.reject(new LspError('LSP connection is closed'));
        }
        if (options.signal?.aborted) {
            return Promise.reject(new LspError('Request cancelled', ErrorCodes.RequestCancelled));
        }
        const id = ++this.nextId;
        return new Promise<T>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const cancel = (error: LspError): void => {
                if (!this.pending.has(id)) {
                    return;
                }
                this.settle(id, undefined, error);
                void this.notify('$/cancelRequest', { id }).catch((failure) => this.reportError(failure));
            };
            const abort = (): void => cancel(new LspError('Request cancelled', ErrorCodes.RequestCancelled));
            this.pending.set(id, {
                resolve: (value) => resolve(value as T),
                reject,
                cleanup: () => {
                    clearTimeout(timer);
                    options.signal?.removeEventListener('abort', abort);
                }
            });
            options.signal?.addEventListener('abort', abort, { once: true });
            const timeout = options.timeoutMs ?? this.timeoutMs;
            if (timeout > 0) {
                timer = setTimeout(() => cancel(new LspError(`LSP request timed out: ${method}`, ErrorCodes.RequestCancelled)), timeout);
            }
            void this.send({ jsonrpc: '2.0', id, method, params }).catch((error) => this.settle(id, undefined, error));
        });
    }

    notify(method: string, params?: unknown): Promise<void> {
        return this.send({ jsonrpc: '2.0', method, params });
    }

    onRequest(method: string, handler: RequestHandler): Disposable {
        if (this.handlers.has(method)) {
            throw new Error(`LSP request handler already registered: ${method}`);
        }
        this.handlers.set(method, handler);
        return {
            dispose: () => {
                if (this.handlers.get(method) === handler) {
                    this.handlers.delete(method);
                }
            }
        };
    }

    onNotification(method: string, listener: NotificationHandler): Disposable {
        let listeners = this.notifications.get(method);
        if (!listeners) {
            listeners = new Set();
            this.notifications.set(method, listeners);
        }
        const registered = listeners;
        registered.add(listener);
        return {
            dispose: () => {
                registered.delete(listener);
                if (registered.size === 0) {
                    this.notifications.delete(method);
                }
            }
        };
    }

    onError(listener: (error: Error) => void): Disposable {
        this.errors.add(listener);
        return {
            dispose: () => {
                this.errors.delete(listener);
            }
        };
    }

    onClose(listener: (error?: Error) => void): Disposable {
        this.closes.add(listener);
        if (this.closed) {
            listener();
        }
        return {
            dispose: () => {
                this.closes.delete(listener);
            }
        };
    }

    reportError(error: unknown): void {
        const normalized = asError(error);
        for (const listener of this.errors) {
            try {
                listener(normalized);
            } catch {
                // An error observer must not break protocol dispatch.
            }
        }
    }

    async close(): Promise<void> {
        this.finish();
        await this.transport.close();
    }

    private send(message: RpcMessage): Promise<void> {
        const sent = this.sendQueue.then(async () => {
            if (this.closed) {
                throw new LspError('LSP connection is closed');
            }
            await this.transport.send(message);
        });
        this.sendQueue = sent.catch((error) => this.finish(asError(error)));
        return sent;
    }

    private settle(id: RequestId, result?: unknown, error?: unknown): void {
        const request = this.pending.get(id);
        if (!request) {
            return;
        }
        this.pending.delete(id);
        request.cleanup();
        if (error !== undefined) {
            request.reject(error);
        } else {
            request.resolve(result);
        }
    }

    private async receive(value: unknown): Promise<void> {
        if (this.closed) {
            return;
        }
        if (!value || typeof value !== 'object' || !('jsonrpc' in value) || value.jsonrpc !== '2.0') {
            throw new LspError('Invalid JSON-RPC message', ErrorCodes.InvalidRequest);
        }
        const message = value as RpcMessage;
        if ('method' in message) {
            if (typeof message.method !== 'string') {
                throw new LspError('Invalid JSON-RPC method', ErrorCodes.InvalidRequest);
            }
            if ('id' in message) {
                if (typeof message.id !== 'number' && typeof message.id !== 'string') {
                    throw new LspError('Invalid request id', ErrorCodes.InvalidRequest);
                }
                await this.handleRequest(message);
            } else if (message.method === '$/cancelRequest') {
                const id = (message.params as { id?: RequestId } | undefined)?.id;
                if (id !== undefined) {
                    this.incoming.get(id)?.abort();
                }
            } else {
                for (const listener of this.notifications.get(message.method) ?? []) {
                    try {
                        await listener(message.params);
                    } catch (error) {
                        this.reportError(error);
                    }
                }
            }
        } else if ('id' in message && message.id !== null) {
            if (message.error) {
                this.settle(message.id, undefined, new LspError(message.error.message, message.error.code, message.error.data));
            } else if ('result' in message) {
                this.settle(message.id, message.result);
            } else {
                this.settle(message.id, undefined, new LspError('Invalid JSON-RPC response', ErrorCodes.InvalidRequest));
            }
        } else {
            throw new LspError('Invalid JSON-RPC response', ErrorCodes.InvalidRequest);
        }
    }

    private async handleRequest(message: RpcRequest): Promise<void> {
        const controller = new AbortController();
        this.incoming.set(message.id, controller);
        try {
            const handler = this.handlers.get(message.method);
            if (!handler) {
                throw new LspError(`Unsupported server request: ${message.method}`, ErrorCodes.MethodNotFound);
            }
            const result = await handler(message.params, controller.signal);
            if (controller.signal.aborted) {
                throw new LspError('Request cancelled', ErrorCodes.RequestCancelled);
            }
            await this.send({ jsonrpc: '2.0', id: message.id, result: result ?? null });
        } catch (error) {
            const failure = error instanceof LspError ? error : new LspError(asError(error).message);
            if (!this.closed) {
                await this.send({ jsonrpc: '2.0', id: message.id, error: { code: failure.code, message: failure.message, data: failure.data } });
            }
        } finally {
            this.incoming.delete(message.id);
        }
    }

    private finish(error?: Error): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        for (const id of [...this.pending.keys()]) {
            this.settle(id, undefined, error ?? new LspError('LSP connection closed'));
        }
        for (const controller of this.incoming.values()) {
            controller.abort();
        }
        this.incoming.clear();
        // A transport that is closed already calls back from inside the constructor, before the subscriptions exist.
        for (const subscription of this.subscriptions ?? []) {
            subscription.dispose();
        }
        for (const listener of this.closes) {
            try {
                listener(error);
            } catch (failure) {
                this.reportError(failure);
            }
        }
        this.handlers.clear();
        this.notifications.clear();
        this.closes.clear();
        if (error) {
            this.reportError(error);
        }
    }
}

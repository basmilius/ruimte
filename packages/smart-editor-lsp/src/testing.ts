import { JsonRpcConnection, type RequestHandler } from './connection.ts';
import { applyContentChanges } from './edits.ts';
import type { ContentChange, Diagnostic, InitializeResult, LspTransport, ServerCapabilities } from './protocol.ts';

export { createMemoryTransportPair } from './transport.ts';

export interface FakeLanguageServerOptions {
    capabilities?: ServerCapabilities;
    serverInfo?: InitializeResult['serverInfo'];
    handlers?: Record<string, RequestHandler>;
}

export interface FakeDocument {
    languageId: string;
    text: string;
    version: number;
}

export interface ReceivedMessage {
    method: string;
    params: unknown;
    /* Present for a request, absent for a notification. */
    id?: number | string;
}

/*
 * A language server for tests, on the far end of a transport. It answers the handshake, keeps the
 * text of every document it was told about the way a real server does, and answers whatever a test
 * registers with `handle`; any other request is refused as unsupported.
 */
export class FakeLanguageServer {
    readonly connection: JsonRpcConnection;
    readonly received: ReceivedMessage[] = [];
    readonly documents = new Map<string, FakeDocument>();
    shutdownRequested = false;
    exited = false;

    constructor(transport: LspTransport, options: FakeLanguageServerOptions = {}) {
        this.connection = new JsonRpcConnection(transport, 0);
        transport.onMessage((message) => {
            const { method, params, id } = message as ReceivedMessage;
            if (typeof method === 'string') {
                this.received.push({ method, params, id });
            }
        });
        this.connection.onRequest('initialize', () => ({ capabilities: options.capabilities ?? { textDocumentSync: 2 }, serverInfo: options.serverInfo }));
        this.connection.onRequest('shutdown', () => {
            this.shutdownRequested = true;
            return null;
        });
        this.connection.onNotification('exit', () => {
            this.exited = true;
        });
        this.connection.onNotification('textDocument/didOpen', (params) => {
            const { textDocument } = params as { textDocument: { uri: string; languageId: string; text: string; version: number } };
            this.documents.set(textDocument.uri, { languageId: textDocument.languageId, text: textDocument.text, version: textDocument.version });
        });
        this.connection.onNotification('textDocument/didChange', (params) => {
            const { textDocument, contentChanges } = params as { textDocument: { uri: string; version: number }; contentChanges: ContentChange[] };
            const document = this.documents.get(textDocument.uri);
            if (document) {
                document.text = applyContentChanges(document.text, contentChanges);
                document.version = textDocument.version;
            }
        });
        this.connection.onNotification('textDocument/didClose', (params) => {
            this.documents.delete((params as { textDocument: { uri: string } }).textDocument.uri);
        });
        for (const [method, handler] of Object.entries(options.handlers ?? {})) {
            this.connection.onRequest(method, handler);
        }
    }

    handle(method: string, handler: RequestHandler): void {
        this.connection.onRequest(method, handler);
    }

    /* The params of every request or notification of `method`, in the order they came. */
    paramsOf(method: string): unknown[] {
        return this.received.filter((message) => message.method === method).map((message) => message.params);
    }

    publishDiagnostics(uri: string, diagnostics: Diagnostic[], version?: number): Promise<void> {
        return this.connection.notify('textDocument/publishDiagnostics', { uri, version, diagnostics });
    }

    notify(method: string, params?: unknown): Promise<void> {
        return this.connection.notify(method, params);
    }

    request<T = unknown>(method: string, params?: unknown): Promise<T> {
        return this.connection.request<T>(method, params);
    }

    /* The process went away: the transport closes under the client. */
    crash(): Promise<void> {
        return this.connection.close();
    }
}

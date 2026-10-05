import { ErrorCodes, JsonRpcConnection, LspError, type RequestHandler } from './connection.ts';
import { LspDocument } from './document.ts';
import { globMatch } from './glob.ts';
import type {
    ApplyWorkspaceEditParams,
    ApplyWorkspaceEditResult,
    Command,
    ConfigurationItem,
    Disposable,
    DocumentItem,
    FileEvent,
    FileSystemWatcher,
    InitializeResult,
    LspTransport,
    ProgressParams,
    ProviderOptions,
    PublishDiagnosticsParams,
    Registration,
    RequestOptions,
    ServerCapabilities,
    TextDocumentSyncOptions,
    WorkspaceFolder,
    WorkspaceSymbol,
    WorkspaceSymbolResult
} from './protocol.ts';

export type SessionState = 'new' | 'initializing' | 'ready' | 'closing' | 'closed';

export interface LspSessionOptions {
    rootUri?: string | null;
    workspaceFolders?: WorkspaceFolder[];
    initializationOptions?: unknown;
    /* Sent after `initialized` and answered to every configuration query, before any document opens. */
    configuration?: Record<string, unknown>;
    clientInfo?: { name: string; version?: string };
    timeoutMs?: number;
    snippetSupport?: boolean;
    onConfiguration?: (item: ConfigurationItem) => unknown | Promise<unknown>;
    onApplyEdit?: (params: ApplyWorkspaceEditParams) => ApplyWorkspaceEditResult | Promise<ApplyWorkspaceEditResult>;
    onShowMessage?: (params: { type: number; message: string; actions?: { title: string }[] }) => { title: string } | null | Promise<{ title: string } | null>;
}

/* The capability that advertises each method statically. */
const PROVIDERS: Record<string, keyof ServerCapabilities> = {
    'textDocument/completion': 'completionProvider',
    'completionItem/resolve': 'completionProvider',
    'textDocument/hover': 'hoverProvider',
    'textDocument/signatureHelp': 'signatureHelpProvider',
    'textDocument/definition': 'definitionProvider',
    'textDocument/declaration': 'declarationProvider',
    'textDocument/typeDefinition': 'typeDefinitionProvider',
    'textDocument/implementation': 'implementationProvider',
    'textDocument/references': 'referencesProvider',
    'textDocument/prepareRename': 'renameProvider',
    'textDocument/documentHighlight': 'documentHighlightProvider',
    'textDocument/documentSymbol': 'documentSymbolProvider',
    'workspace/symbol': 'workspaceSymbolProvider',
    'workspaceSymbol/resolve': 'workspaceSymbolProvider',
    'textDocument/rename': 'renameProvider',
    'textDocument/codeAction': 'codeActionProvider',
    'codeAction/resolve': 'codeActionProvider',
    'textDocument/codeLens': 'codeLensProvider',
    'codeLens/resolve': 'codeLensProvider',
    'workspace/executeCommand': 'executeCommandProvider',
    'textDocument/formatting': 'documentFormattingProvider',
    'textDocument/rangeFormatting': 'documentRangeFormattingProvider',
    'textDocument/foldingRange': 'foldingRangeProvider',
    'textDocument/selectionRange': 'selectionRangeProvider',
    'textDocument/semanticTokens/full': 'semanticTokensProvider',
    'textDocument/semanticTokens/full/delta': 'semanticTokensProvider',
    'textDocument/semanticTokens/range': 'semanticTokensProvider',
    'textDocument/inlayHint': 'inlayHintProvider',
    'inlayHint/resolve': 'inlayHintProvider',
    'textDocument/diagnostic': 'diagnosticProvider'
};

/* A method whose dynamic registration is made under the name of another. */
const REGISTRATION_METHODS: Record<string, string> = {
    'completionItem/resolve': 'textDocument/completion',
    'codeAction/resolve': 'textDocument/codeAction',
    'codeLens/resolve': 'textDocument/codeLens',
    'inlayHint/resolve': 'textDocument/inlayHint',
    'textDocument/prepareRename': 'textDocument/rename',
    'workspaceSymbol/resolve': 'workspace/symbol',
    'textDocument/semanticTokens/full': 'textDocument/semanticTokens',
    'textDocument/semanticTokens/full/delta': 'textDocument/semanticTokens',
    'textDocument/semanticTokens/range': 'textDocument/semanticTokens'
};

const REFRESH_REQUESTS = ['workspace/semanticTokens/refresh', 'workspace/inlayHint/refresh', 'workspace/diagnostic/refresh', 'workspace/codeLens/refresh'];

function matches(options: ProviderOptions, document?: Pick<DocumentItem, 'uri' | 'languageId'>): boolean {
    if (options.documentSelector == null) {
        return true;
    }
    if (!document) {
        return options.documentSelector.length > 0;
    }
    const url = new URL(document.uri);
    return options.documentSelector.some(
        (filter) =>
            (!filter.language || filter.language === document.languageId) &&
            (!filter.scheme || filter.scheme === url.protocol.slice(0, -1)) &&
            (!filter.pattern || globMatch(decodeURIComponent(url.pathname), filter.pattern))
    );
}

/* One conversation with one language server: the handshake, what it can do, and the documents open in it. */
export class LspSession {
    readonly connection: JsonRpcConnection;
    readonly options: LspSessionOptions;
    serverInfo?: InitializeResult['serverInfo'];
    private phase: SessionState = 'new';
    private initialized?: Promise<InitializeResult>;
    private shutdownPromise?: Promise<void>;
    private serverCapabilities: ServerCapabilities = {};
    private readonly registrations = new Map<string, Registration>();
    private readonly documents = new Map<string, LspDocument>();
    private readonly diagnosticListeners = new Set<(params: PublishDiagnosticsParams) => void>();
    private readonly capabilityListeners = new Set<() => void>();
    private configuration: Record<string, unknown>;

    constructor(transport: LspTransport, options: LspSessionOptions = {}) {
        this.options = options;
        this.connection = new JsonRpcConnection(transport, options.timeoutMs);
        this.configuration = options.configuration ?? {};
        this.connection.onClose(() => {
            this.phase = 'closed';
            for (const document of [...this.documents.values()]) {
                document.disconnect();
            }
        });
        this.connection.onNotification('textDocument/publishDiagnostics', (params) => {
            const diagnostics = params as PublishDiagnosticsParams;
            const document = this.documents.get(diagnostics.uri);
            if (!document || document.isClosed || (diagnostics.version !== undefined && diagnostics.version !== document.version)) {
                return;
            }
            this.emitDiagnostics(diagnostics);
        });
        this.connection.onRequest('workspace/configuration', async (params) => {
            const { items } = params as { items: ConfigurationItem[] };
            return Promise.all(items.map((item) => (options.onConfiguration ? options.onConfiguration(item) : this.readConfiguration(item.section))));
        });
        this.connection.onRequest('workspace/workspaceFolders', () => this.workspaceFolders);
        this.connection.onRequest(
            'workspace/applyEdit',
            (params) => options.onApplyEdit?.(params as ApplyWorkspaceEditParams) ?? { applied: false, failureReason: 'No workspace edit handler is attached' }
        );
        this.connection.onRequest(
            'window/showMessageRequest',
            (params) => options.onShowMessage?.(params as Parameters<NonNullable<LspSessionOptions['onShowMessage']>>[0]) ?? null
        );
        this.connection.onRequest('window/workDoneProgress/create', () => null);
        this.connection.onRequest('client/registerCapability', (params) => {
            const { registrations } = params as { registrations: Registration[] };
            for (const registration of registrations) {
                this.registrations.set(registration.id, registration);
            }
            this.emitCapabilities();
            return null;
        });
        this.connection.onRequest('client/unregisterCapability', (params) => {
            // The misspelled field is part of the LSP 3.17 wire protocol.
            const { unregisterations } = params as { unregisterations: { id: string; method: string }[] };
            for (const registration of unregisterations) {
                this.registrations.delete(registration.id);
            }
            this.emitCapabilities();
            return null;
        });
        for (const method of REFRESH_REQUESTS) {
            this.connection.onRequest(method, () => {
                this.emitCapabilities();
                return null;
            });
        }
    }

    get state(): SessionState {
        return this.phase;
    }

    get capabilities(): Readonly<ServerCapabilities> {
        return this.serverCapabilities;
    }

    get workspaceFolders(): WorkspaceFolder[] | null {
        return this.options.workspaceFolders ?? (this.options.rootUri ? [{ uri: this.options.rootUri, name: 'Workspace' }] : null);
    }

    get syncOptions(): TextDocumentSyncOptions {
        const sync = this.serverCapabilities.textDocumentSync;
        return typeof sync === 'number' ? { openClose: sync !== 0, change: sync } : (sync ?? {});
    }

    initialize(): Promise<InitializeResult> {
        if (this.initialized) {
            return this.initialized;
        }
        if (this.phase !== 'new') {
            return Promise.reject(new LspError(`Cannot initialize a ${this.phase} session`));
        }
        this.phase = 'initializing';
        this.initialized = (async () => {
            try {
                const result = await this.connection.request<InitializeResult>('initialize', {
                    processId: null,
                    rootUri: this.options.rootUri ?? null,
                    workspaceFolders: this.workspaceFolders,
                    clientInfo: this.options.clientInfo ?? { name: '@ruimte/smart-editor-lsp' },
                    capabilities: clientCapabilities(this.options),
                    initializationOptions: this.options.initializationOptions
                });
                if (result.capabilities.positionEncoding && result.capabilities.positionEncoding !== 'utf-16') {
                    throw new LspError(`Unsupported server position encoding: ${result.capabilities.positionEncoding}`);
                }
                this.serverCapabilities = result.capabilities;
                this.serverInfo = result.serverInfo;
                await this.connection.notify('initialized', {});
                this.phase = 'ready';
                if (this.options.configuration !== undefined) {
                    await this.connection.notify('workspace/didChangeConfiguration', { settings: this.configuration });
                }
                this.emitCapabilities();
                return result;
            } catch (error) {
                await this.connection.close();
                throw error;
            }
        })();
        return this.initialized;
    }

    openDocument(item: DocumentItem): LspDocument {
        this.assertReady();
        if (this.documents.has(item.uri)) {
            throw new LspError(`Document already open: ${item.uri}`);
        }
        const document = new LspDocument(this, item);
        this.documents.set(item.uri, document);
        return document;
    }

    getDocument(uri: string): LspDocument | undefined {
        return this.documents.get(uri);
    }

    /* The options the server gave a method, from its capabilities or a registration whose selector takes `document`. */
    providerOptions(method: string, document?: Pick<DocumentItem, 'uri' | 'languageId'>): ProviderOptions | undefined {
        const name = REGISTRATION_METHODS[method] ?? method;
        const candidates: ProviderOptions[] = [];
        for (const registration of this.registrations.values()) {
            if (registration.method === name && matches(registration.registerOptions ?? {}, document)) {
                candidates.push(registration.registerOptions ?? {});
            }
        }
        const provider = this.serverCapabilities[PROVIDERS[method]];
        if (provider === true) {
            candidates.push({});
        } else if (provider && typeof provider === 'object' && matches(provider as ProviderOptions, document)) {
            candidates.push(provider as ProviderOptions);
        }
        return candidates.find((options) => {
            if (method.endsWith('/resolve')) {
                return options.resolveProvider === true;
            }
            if (method === 'textDocument/prepareRename') {
                return options.prepareProvider === true;
            }
            if (method === 'textDocument/semanticTokens/full/delta') {
                return typeof options.full === 'object' && options.full.delta === true;
            }
            if (method === 'textDocument/semanticTokens/full') {
                return !!options.full;
            }
            if (method === 'textDocument/semanticTokens/range') {
                return !!options.range;
            }
            return true;
        });
    }

    supports(method: string, document?: Pick<DocumentItem, 'uri' | 'languageId'>): boolean {
        return this.phase === 'ready' && this.providerOptions(method, document) !== undefined;
    }

    request<T = unknown>(method: string, params?: unknown, options?: RequestOptions): Promise<T> {
        this.assertReady();
        return this.connection.request<T>(method, params, options);
    }

    notify(method: string, params?: unknown): Promise<void> {
        this.assertReady();
        return this.connection.notify(method, params);
    }

    executeCommand<T = unknown>(command: Command | string, args?: unknown[], options?: RequestOptions): Promise<T> {
        if (!this.supports('workspace/executeCommand')) {
            return Promise.reject(new LspError('Server does not support commands', ErrorCodes.MethodNotFound));
        }
        return this.request('workspace/executeCommand', typeof command === 'string' ? { command, arguments: args } : command, options);
    }

    workspaceSymbols(query: string, options?: RequestOptions): Promise<WorkspaceSymbolResult> {
        if (!this.supports('workspace/symbol')) {
            return Promise.reject(new LspError('Server does not support workspace symbols', ErrorCodes.MethodNotFound));
        }
        return this.request('workspace/symbol', { query }, options);
    }

    resolveWorkspaceSymbol(symbol: WorkspaceSymbol, options?: RequestOptions): Promise<WorkspaceSymbol> {
        if (!this.supports('workspaceSymbol/resolve')) {
            return Promise.reject(new LspError('Server does not support workspace symbol resolution', ErrorCodes.MethodNotFound));
        }
        return this.request('workspaceSymbol/resolve', symbol, options);
    }

    async setConfiguration(settings: Record<string, unknown>): Promise<void> {
        this.configuration = settings;
        await this.notify('workspace/didChangeConfiguration', { settings });
    }

    onRequest(method: string, handler: RequestHandler): Disposable {
        return this.connection.onRequest(method, handler);
    }

    onNotification(method: string, listener: (params: unknown) => void | Promise<void>): Disposable {
        return this.connection.onNotification(method, listener);
    }

    onError(listener: (error: Error) => void): Disposable {
        return this.connection.onError(listener);
    }

    onProgress(listener: (params: ProgressParams) => void): Disposable {
        return this.onNotification('$/progress', (params) => listener(params as ProgressParams));
    }

    onDiagnostics(listener: (params: PublishDiagnosticsParams) => void): Disposable {
        this.diagnosticListeners.add(listener);
        return {
            dispose: () => {
                this.diagnosticListeners.delete(listener);
            }
        };
    }

    /* What the server registered to hear about, which is nothing until it registers for `workspace/didChangeWatchedFiles`. */
    watchedFiles(): FileSystemWatcher[] {
        return [...this.registrations.values()]
            .filter((registration) => registration.method === 'workspace/didChangeWatchedFiles')
            .flatMap((registration) => registration.registerOptions?.watchers ?? []);
    }

    /* Tells the server which files changed on disk. The caller holds back what its patterns do not name. */
    didChangeWatchedFiles(changes: readonly FileEvent[]): Promise<void> {
        return this.notify('workspace/didChangeWatchedFiles', { changes });
    }

    /* Registrations and the refresh requests of the server both land here, since each can change what a document may ask. */
    onCapabilitiesChanged(listener: () => void): Disposable {
        this.capabilityListeners.add(listener);
        return {
            dispose: () => {
                this.capabilityListeners.delete(listener);
            }
        };
    }

    shutdown(): Promise<void> {
        this.shutdownPromise ??= this.stop();
        return this.shutdownPromise;
    }

    /* Called by a document that closed, so its diagnostics go with it. */
    forgetDocument(document: LspDocument): void {
        if (this.documents.get(document.uri) !== document) {
            return;
        }
        this.documents.delete(document.uri);
        this.emitDiagnostics({ uri: document.uri, diagnostics: [] });
    }

    private assertReady(): void {
        if (this.phase !== 'ready') {
            throw new LspError(`LSP session is ${this.phase}; await initialize() first`, ErrorCodes.ServerNotInitialized);
        }
    }

    private async stop(): Promise<void> {
        try {
            if (this.phase === 'initializing') {
                await this.initialized;
            }
            if (this.phase === 'ready') {
                this.phase = 'closing';
                await Promise.all([...this.documents.values()].map((document) => document.close()));
                await this.connection.request('shutdown', undefined, { timeoutMs: 5_000 });
                await this.connection.notify('exit');
            }
        } finally {
            await this.connection.close();
            this.phase = 'closed';
        }
    }

    private readConfiguration(section?: string): unknown {
        if (!section) {
            return this.configuration;
        }
        if (Object.hasOwn(this.configuration, section)) {
            return this.configuration[section];
        }
        let result: unknown = this.configuration;
        for (const key of section.split('.')) {
            if (!result || typeof result !== 'object' || !Object.hasOwn(result, key)) {
                return null;
            }
            result = (result as Record<string, unknown>)[key];
        }
        return result ?? null;
    }

    private emitDiagnostics(params: PublishDiagnosticsParams): void {
        for (const listener of this.diagnosticListeners) {
            try {
                listener(params);
            } catch (error) {
                this.connection.reportError(error);
            }
        }
    }

    private emitCapabilities(): void {
        for (const listener of this.capabilityListeners) {
            try {
                listener();
            } catch (error) {
                this.connection.reportError(error);
            }
        }
    }
}

function clientCapabilities(options: LspSessionOptions): object {
    const dynamic = { dynamicRegistration: true };
    const symbolKind = { valueSet: Array.from({ length: 26 }, (_, index) => index + 1) };
    return {
        general: { positionEncodings: ['utf-16'] },
        workspace: {
            applyEdit: !!options.onApplyEdit,
            workspaceEdit: { documentChanges: true, failureHandling: 'abort' },
            configuration: true,
            workspaceFolders: true,
            executeCommand: dynamic,
            didChangeWatchedFiles: { ...dynamic, relativePatternSupport: true },
            symbol: { ...dynamic, symbolKind, tagSupport: { valueSet: [1] }, resolveSupport: { properties: ['location.range'] } },
            semanticTokens: { refreshSupport: true },
            inlayHint: { refreshSupport: true },
            codeLens: { refreshSupport: true },
            diagnostics: { refreshSupport: true }
        },
        window: { workDoneProgress: true, showMessage: { messageActionItem: { additionalPropertiesSupport: false } } },
        textDocument: {
            synchronization: { dynamicRegistration: false, didSave: true },
            publishDiagnostics: {
                versionSupport: true,
                relatedInformation: true,
                tagSupport: { valueSet: [1, 2] },
                codeDescriptionSupport: true,
                dataSupport: true
            },
            completion: {
                ...dynamic,
                contextSupport: true,
                completionItem: {
                    snippetSupport: options.snippetSupport ?? false,
                    commitCharactersSupport: true,
                    documentationFormat: ['markdown', 'plaintext'],
                    deprecatedSupport: true,
                    preselectSupport: true,
                    insertReplaceSupport: true,
                    labelDetailsSupport: true,
                    resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits', 'command'] }
                }
            },
            hover: { ...dynamic, contentFormat: ['markdown', 'plaintext'] },
            signatureHelp: {
                ...dynamic,
                contextSupport: true,
                signatureInformation: {
                    documentationFormat: ['markdown', 'plaintext'],
                    parameterInformation: { labelOffsetSupport: true },
                    activeParameterSupport: true
                }
            },
            definition: { ...dynamic, linkSupport: true },
            declaration: { ...dynamic, linkSupport: true },
            typeDefinition: { ...dynamic, linkSupport: true },
            implementation: { ...dynamic, linkSupport: true },
            references: dynamic,
            documentHighlight: dynamic,
            documentSymbol: { ...dynamic, symbolKind, hierarchicalDocumentSymbolSupport: true, tagSupport: { valueSet: [1] }, labelSupport: true },
            rename: { ...dynamic, prepareSupport: true, prepareSupportDefaultBehavior: 1 },
            codeAction: {
                ...dynamic,
                dataSupport: true,
                isPreferredSupport: true,
                disabledSupport: true,
                codeActionLiteralSupport: {
                    codeActionKind: {
                        valueSet: [
                            '',
                            'quickfix',
                            'refactor',
                            'refactor.extract',
                            'refactor.inline',
                            'refactor.rewrite',
                            'source',
                            'source.organizeImports',
                            'source.fixAll'
                        ]
                    }
                },
                resolveSupport: { properties: ['edit', 'command'] }
            },
            codeLens: dynamic,
            formatting: dynamic,
            rangeFormatting: dynamic,
            foldingRange: { ...dynamic, lineFoldingOnly: false, foldingRange: { collapsedText: false } },
            selectionRange: dynamic,
            semanticTokens: {
                ...dynamic,
                requests: { range: true, full: { delta: true } },
                tokenTypes: [
                    'namespace',
                    'type',
                    'class',
                    'enum',
                    'interface',
                    'struct',
                    'typeParameter',
                    'parameter',
                    'variable',
                    'property',
                    'enumMember',
                    'event',
                    'function',
                    'method',
                    'macro',
                    'keyword',
                    'modifier',
                    'comment',
                    'string',
                    'number',
                    'regexp',
                    'operator',
                    'decorator'
                ],
                tokenModifiers: [
                    'declaration',
                    'definition',
                    'readonly',
                    'static',
                    'deprecated',
                    'abstract',
                    'async',
                    'modification',
                    'documentation',
                    'defaultLibrary'
                ],
                formats: ['relative'],
                overlappingTokenSupport: false,
                multilineTokenSupport: false
            },
            inlayHint: { ...dynamic, resolveSupport: { properties: ['tooltip', 'textEdits', 'label.tooltip', 'label.location', 'label.command'] } },
            diagnostic: { ...dynamic, relatedDocumentSupport: true }
        }
    };
}

import { LANGUAGE_ERROR_CODES, resolveStoredPath, storedPathOf, type LanguageMethod, type LanguageProviders } from '@ruimte/contracts';
import {
    ErrorCodes,
    fileUriToPath,
    LspError,
    pathToFileUri,
    StaleResultError,
    type ApplyWorkspaceEditParams,
    type ApplyWorkspaceEditResult,
    type CodeAction,
    type CodeActionContext,
    type CodeLens,
    type Command,
    type CompletionContext,
    type CompletionItem,
    type CompletionResult,
    type ContentChange,
    type Disposable,
    type DocumentHighlight,
    type DocumentSymbolResult,
    type DiagnosticsReport,
    type FoldingRange,
    type FormattingOptions,
    type Hover,
    type InlayHint,
    type LanguageDocument,
    type LanguageRequestOptions,
    type LanguageService,
    type Location,
    type NavigationResult,
    type Position,
    type PrepareRenameResult,
    type ProviderOptions,
    type Range,
    type SelectionRange,
    type SemanticTokens,
    type SemanticTokensDelta,
    type SignatureHelp,
    type SignatureHelpContext,
    type TextEdit,
    type WorkspaceEdit,
    type WorkspaceSymbolResult
} from '@adecore/lsp';
import { TransportError, type Transport } from '@/transport/transport';

export interface WireLanguageServiceOptions {
    transport: Transport;
    projectId: string;
    /* The project folder on the machine of the daemon: a file URI and a stored path are made of each other against it. */
    folder: string;
    /*
     * The text the view holds now. A document is opened again with it whenever the daemon's copy
     * cannot be trusted, which is after a refused change, another client's text and a reconnect.
     */
    textOf(uri: string): string | undefined;
    /* Makes the edit a server asked for while a command of this client ran, and says whether it did. Without it every such edit is refused. */
    applyEdit?(params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResult>;
}

interface OpenDocument {
    readonly uri: string;
    readonly path: string;
    readonly languageId: string;
    /* The version the daemon will be at once every change sent so far has landed. 0 until the first open is answered. */
    version: number;
    providers: LanguageProviders;
    /* The kinds of language server that serve the document, as the daemon's last answer to its open said. */
    servers: readonly string[];
    /* While the daemon's copy is being replaced, changes wait for it: the text it carries is read after they were made. */
    resyncing: Promise<void> | null;
}

/* Where a result came from, so an item of it resolves against the same process and only for the text it was made for. */
interface Origin {
    server: string;
    version: number;
}

const RESYNC_ATTEMPTS = 3;

/* The daemon's copy of the document is not the one this side counts on, so it is opened again. */
function isOutOfStep(error: unknown): boolean {
    return error instanceof TransportError && (error.code === LANGUAGE_ERROR_CODES.staleDocument || error.code === LANGUAGE_ERROR_CODES.documentNotOpen);
}

/* The wire has no cancellation, so an aborted request is only no longer waited for; a reply that comes later is dropped. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const abort = (): void => reject(new LspError('Request cancelled', ErrorCodes.RequestCancelled));
        if (signal.aborted) {
            abort();
            return;
        }
        signal.addEventListener('abort', abort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener('abort', abort);
                resolve(value);
            },
            (error: unknown) => {
                signal.removeEventListener('abort', abort);
                reject(error);
            }
        );
    });
}

/*
 * The language service of one project on one machine, over that machine's transport. The daemon runs
 * the servers and owns each document's version. This side sends changes ahead of their answers, since
 * every accepted change raises the version by one, and so knows the version a result must be for. A
 * result for a text that has moved on rejects with `StaleResultError`, and a change the daemon refuses
 * opens the document again with the text of the view.
 */
export class WireLanguageService implements LanguageService {
    private readonly options: WireLanguageServiceOptions;
    private readonly documents = new Map<string, OpenDocument>();
    private readonly origins = new WeakMap<object, Origin>();
    private readonly latest = new Map<string, AbortController>();
    private readonly providerListeners = new Set<(uri: string) => void>();
    private readonly diagnosticListeners = new Set<(report: DiagnosticsReport) => void>();
    private readonly subscriptions: Array<() => void> = [];
    private linkWasDown = false;

    constructor(options: WireLanguageServiceOptions) {
        this.options = options;
        const { transport, projectId } = options;
        this.linkWasDown = transport.status !== 'open';
        this.subscriptions.push(
            transport.on('language.diagnostics', (event) => {
                const document = event.projectId === projectId ? this.documentOfPath(event.path) : undefined;
                // A report for an older version describes a text the view has left; the server will report again for the new one.
                if (!document || (document.version !== 0 && event.version !== undefined && event.version !== document.version)) {
                    return;
                }
                for (const listener of this.diagnosticListeners) {
                    listener({
                        uri: document.uri,
                        source: event.server,
                        version: event.version,
                        diagnostics: event.diagnostics as DiagnosticsReport['diagnostics']
                    });
                }
            }),
            transport.on('language.edit', (event) => {
                if (event.projectId === projectId) {
                    void this.answerEdit(event.editId, { label: event.label, edit: event.edit as ApplyWorkspaceEditParams['edit'] });
                }
            }),
            transport.on('language.providers', (event) => {
                const document = event.projectId === projectId ? this.documentOfPath(event.path) : undefined;
                if (document) {
                    this.setProviders(document, event.providers);
                }
            }),
            transport.subscribeStatus((status) => {
                if (status !== 'open') {
                    this.linkWasDown = true;
                } else if (this.linkWasDown) {
                    this.linkWasDown = false;
                    // A daemon that restarted has none of the documents; one that did not has them as they were. Either way the view's text is what holds.
                    for (const document of this.documents.values()) {
                        void this.resync(document);
                    }
                }
            })
        );
    }

    async openDocument(document: LanguageDocument): Promise<void> {
        const existing = this.documents.get(document.uri);
        const open: OpenDocument = existing ?? {
            uri: document.uri,
            path: this.pathOfUri(document.uri),
            languageId: document.languageId,
            version: 0,
            providers: {},
            servers: [],
            resyncing: null
        };
        this.documents.set(document.uri, open);
        const reply = await this.openOnDaemon(open, document.text);
        open.version = reply.version;
        open.servers = reply.servers;
        open.providers = reply.providers;
    }

    async changeDocument(uri: string, changes: readonly ContentChange[]): Promise<void> {
        const document = this.documentOf(uri);
        if (document.resyncing) {
            return document.resyncing;
        }
        const baseVersion = document.version;
        document.version = baseVersion + 1;
        try {
            const reply = await this.options.transport.request('language.document.change', {
                projectId: this.options.projectId,
                path: document.path,
                baseVersion,
                changes: [...changes]
            });
            if (reply.version !== baseVersion + 1) {
                await this.resync(document);
            }
        } catch (error) {
            if (isOutOfStep(error)) {
                await this.resync(document);
                return;
            }
            throw this.translate(error, uri);
        }
    }

    async closeDocument(uri: string): Promise<void> {
        const document = this.documents.get(uri);
        if (!document) {
            return;
        }
        this.documents.delete(uri);
        await this.options.transport.request('language.document.close', { projectId: this.options.projectId, path: document.path }).catch(() => undefined);
    }

    /* Lets go of the events and of the documents, which the daemon closes with the socket if this does not get to say so. */
    dispose(): void {
        for (const unsubscribe of this.subscriptions.splice(0)) {
            unsubscribe();
        }
        for (const uri of [...this.documents.keys()]) {
            void this.closeDocument(uri);
        }
        for (const controller of this.latest.values()) {
            controller.abort();
        }
    }

    /* The kinds of language server the daemon says serve the document: installed or not, and empty before the first answer. */
    serversOf(uri: string): readonly string[] {
        return this.documents.get(uri)?.servers ?? [];
    }

    supports(method: string, uri: string): boolean {
        return this.documents.get(uri)?.providers[method] !== undefined;
    }

    providerOptions(method: string, uri: string): ProviderOptions | undefined {
        return this.documents.get(uri)?.providers[method] as ProviderOptions | undefined;
    }

    onProvidersChanged(listener: (uri: string) => void): Disposable {
        this.providerListeners.add(listener);
        return {
            dispose: () => {
                this.providerListeners.delete(listener);
            }
        };
    }

    onDiagnostics(listener: (report: DiagnosticsReport) => void): Disposable {
        this.diagnosticListeners.add(listener);
        return {
            dispose: () => {
                this.diagnosticListeners.delete(listener);
            }
        };
    }

    completion(uri: string, position: Position, context?: CompletionContext, options?: LanguageRequestOptions): Promise<CompletionResult> {
        return this.call(uri, 'textDocument/completion', { position, context }, options);
    }

    resolveCompletion(uri: string, item: CompletionItem, options?: LanguageRequestOptions): Promise<CompletionItem> {
        return this.call(uri, 'completionItem/resolve', item, options);
    }

    hover(uri: string, position: Position, options?: LanguageRequestOptions): Promise<Hover | null> {
        return this.call(uri, 'textDocument/hover', { position }, options);
    }

    signatureHelp(uri: string, position: Position, context?: SignatureHelpContext, options?: LanguageRequestOptions): Promise<SignatureHelp | null> {
        return this.call(uri, 'textDocument/signatureHelp', { position, context }, options);
    }

    definition(uri: string, position: Position, options?: LanguageRequestOptions): Promise<NavigationResult> {
        return this.call(uri, 'textDocument/definition', { position }, options);
    }

    declaration(uri: string, position: Position, options?: LanguageRequestOptions): Promise<NavigationResult> {
        return this.call(uri, 'textDocument/declaration', { position }, options);
    }

    typeDefinition(uri: string, position: Position, options?: LanguageRequestOptions): Promise<NavigationResult> {
        return this.call(uri, 'textDocument/typeDefinition', { position }, options);
    }

    implementation(uri: string, position: Position, options?: LanguageRequestOptions): Promise<NavigationResult> {
        return this.call(uri, 'textDocument/implementation', { position }, options);
    }

    references(uri: string, position: Position, includeDeclaration = true, options?: LanguageRequestOptions): Promise<Location[] | null> {
        return this.call(uri, 'textDocument/references', { position, context: { includeDeclaration } }, options);
    }

    documentHighlights(uri: string, position: Position, options?: LanguageRequestOptions): Promise<DocumentHighlight[] | null> {
        return this.call(uri, 'textDocument/documentHighlight', { position }, options);
    }

    documentSymbols(uri: string, options?: LanguageRequestOptions): Promise<DocumentSymbolResult> {
        return this.call(uri, 'textDocument/documentSymbol', {}, options);
    }

    prepareRename(uri: string, position: Position, options?: LanguageRequestOptions): Promise<PrepareRenameResult> {
        return this.call(uri, 'textDocument/prepareRename', { position }, options);
    }

    rename(uri: string, position: Position, newName: string, options?: LanguageRequestOptions): Promise<WorkspaceEdit | null> {
        return this.call(uri, 'textDocument/rename', { position, newName }, options);
    }

    codeActions(
        uri: string,
        range: Range,
        context: CodeActionContext = { diagnostics: [] },
        options?: LanguageRequestOptions
    ): Promise<(CodeAction | Command)[] | null> {
        return this.call(uri, 'textDocument/codeAction', { range, context }, options);
    }

    resolveCodeAction(uri: string, action: CodeAction, options?: LanguageRequestOptions): Promise<CodeAction> {
        return this.call(uri, 'codeAction/resolve', action, options);
    }

    async executeCommand(uri: string, command: Command, options: LanguageRequestOptions = {}): Promise<unknown> {
        const document = this.documentOf(uri);
        if (document.resyncing) {
            await document.resyncing;
        }
        // Only the server is taken from where the command came from: the edit that came with it has moved the version on by now.
        const origin = this.origins.get(command);
        try {
            const request = this.options.transport.request('language.command', {
                projectId: this.options.projectId,
                path: document.path,
                command: command.command,
                ...(command.arguments ? { arguments: command.arguments } : {}),
                ...(origin ? { server: origin.server } : {})
            });
            const reply = options.signal ? await abortable(request, options.signal) : await request;
            return reply.result;
        } catch (error) {
            throw this.translate(error, uri);
        }
    }

    formatting(uri: string, formatting: FormattingOptions, options?: LanguageRequestOptions): Promise<TextEdit[] | null> {
        return this.call(uri, 'textDocument/formatting', { options: formatting }, options);
    }

    rangeFormatting(uri: string, range: Range, formatting: FormattingOptions, options?: LanguageRequestOptions): Promise<TextEdit[] | null> {
        return this.call(uri, 'textDocument/rangeFormatting', { range, options: formatting }, options);
    }

    semanticTokens(uri: string, options?: LanguageRequestOptions): Promise<SemanticTokens | null> {
        return this.call(uri, 'textDocument/semanticTokens/full', {}, options);
    }

    semanticTokensDelta(uri: string, previousResultId: string, options?: LanguageRequestOptions): Promise<SemanticTokens | SemanticTokensDelta | null> {
        return this.call(uri, 'textDocument/semanticTokens/full/delta', { previousResultId }, options);
    }

    semanticTokensRange(uri: string, range: Range, options?: LanguageRequestOptions): Promise<SemanticTokens | null> {
        return this.call(uri, 'textDocument/semanticTokens/range', { range }, options);
    }

    inlayHints(uri: string, range: Range, options?: LanguageRequestOptions): Promise<InlayHint[] | null> {
        return this.call(uri, 'textDocument/inlayHint', { range }, options);
    }

    resolveInlayHint(uri: string, hint: InlayHint, options?: LanguageRequestOptions): Promise<InlayHint> {
        return this.call(uri, 'inlayHint/resolve', hint, options);
    }

    workspaceSymbols(uri: string, query: string, options?: LanguageRequestOptions): Promise<WorkspaceSymbolResult> {
        return this.call(uri, 'workspace/symbol', { query }, options);
    }

    foldingRanges(uri: string, options?: LanguageRequestOptions): Promise<FoldingRange[] | null> {
        return this.call(uri, 'textDocument/foldingRange', {}, options);
    }

    selectionRanges(uri: string, positions: readonly Position[], options?: LanguageRequestOptions): Promise<SelectionRange[] | null> {
        return this.call(uri, 'textDocument/selectionRange', { positions }, options);
    }

    codeLenses(uri: string, options?: LanguageRequestOptions): Promise<CodeLens[] | null> {
        return this.call(uri, 'textDocument/codeLens', {}, options);
    }

    resolveCodeLens(uri: string, lens: CodeLens, options?: LanguageRequestOptions): Promise<CodeLens> {
        return this.call(uri, 'codeLens/resolve', lens, options);
    }

    /* The URI the language servers know a stored path by, for a location the view must open. */
    uriOfPath(path: string): string | null {
        const resolved = resolveStoredPath(this.options.folder, path);
        return resolved === null ? null : pathToFileUri(resolved);
    }

    /* The stored path of a location's URI, or null for a URI that is no file. */
    pathOfLocation(uri: string): string | null {
        const path = fileUriToPath(uri);
        return path === null ? null : storedPathOf(this.options.folder, path);
    }

    private async call<T>(uri: string, method: LanguageMethod, params: object, options: LanguageRequestOptions = {}): Promise<T> {
        const document = this.documentOf(uri);
        if (document.resyncing) {
            await document.resyncing;
        }
        const origin = method.endsWith('/resolve') ? this.origins.get(params) : undefined;
        if (origin && origin.version !== document.version) {
            throw new StaleResultError(uri);
        }
        const version = document.version;
        const key = `${uri}\0${method}`;
        const controller = new AbortController();
        if (!options.parallel) {
            this.latest.get(key)?.abort();
            this.latest.set(key, controller);
        }
        const abort = (): void => controller.abort();
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) {
            abort();
        }
        try {
            const reply = await abortable(
                this.options.transport.request('language.request', {
                    projectId: this.options.projectId,
                    path: document.path,
                    method,
                    params,
                    version,
                    ...(origin ? { server: origin.server } : {})
                }),
                controller.signal
            );
            if (this.documents.get(uri) !== document || document.version !== version) {
                throw new StaleResultError(uri);
            }
            this.remember(reply.result, { server: reply.server, version }, reply.itemServers);
            return reply.result as T;
        } catch (error) {
            if (isOutOfStep(error)) {
                void this.resync(document);
            }
            throw this.translate(error, uri);
        } finally {
            options.signal?.removeEventListener('abort', abort);
            if (this.latest.get(key) === controller) {
                this.latest.delete(key);
            }
        }
    }

    /* Opens the document again with the text of the view, until the view does not move while the daemon takes it. */
    private resync(document: OpenDocument): Promise<void> {
        document.resyncing ??= (async () => {
            try {
                for (let attempt = 0; attempt < RESYNC_ATTEMPTS; attempt++) {
                    const text = this.options.textOf(document.uri);
                    if (text === undefined || this.documents.get(document.uri) !== document) {
                        return;
                    }
                    const reply = await this.openOnDaemon(document, text);
                    document.version = reply.version;
                    document.servers = reply.servers;
                    this.setProviders(document, reply.providers);
                    if (this.options.textOf(document.uri) === text) {
                        return;
                    }
                }
            } catch {
                // A link that is down says so through its status, and the reconnect does this again.
            } finally {
                document.resyncing = null;
            }
        })();
        return document.resyncing;
    }

    private openOnDaemon(document: OpenDocument, text: string) {
        return this.options.transport.request('language.document.open', {
            projectId: this.options.projectId,
            path: document.path,
            languageId: document.languageId,
            text
        });
    }

    private setProviders(document: OpenDocument, providers: LanguageProviders): void {
        document.providers = providers;
        for (const listener of this.providerListeners) {
            listener(document.uri);
        }
    }

    private async answerEdit(editId: string, params: ApplyWorkspaceEditParams): Promise<void> {
        let answer: ApplyWorkspaceEditResult;
        try {
            answer = this.options.applyEdit
                ? await this.options.applyEdit(params)
                : { applied: false, failureReason: 'This client makes no edits for a server' };
        } catch (error) {
            answer = { applied: false, failureReason: error instanceof Error ? error.message : String(error) };
        }
        await this.options.transport
            .request('language.edit.answer', {
                projectId: this.options.projectId,
                editId,
                applied: answer.applied,
                ...(answer.failureReason ? { failureReason: answer.failureReason } : {})
            })
            .catch(() => undefined);
    }

    /* `itemServers` names the process of each item of a merged list, which then resolves against that process and not the one that headed the answer. */
    private remember(result: unknown, origin: Origin, itemServers?: readonly string[]): void {
        if (!result || typeof result !== 'object') {
            return;
        }
        this.origins.set(result, origin);
        if ('command' in result && typeof result.command === 'object') {
            this.remember(result.command, origin);
        }
        if (Array.isArray(result)) {
            result.forEach((item, index) => this.remember(item, { ...origin, server: itemServers?.[index] ?? origin.server }));
        } else if ('items' in result) {
            this.remember(result.items, origin, itemServers);
        }
    }

    private translate(error: unknown, uri: string): unknown {
        if (!(error instanceof TransportError)) {
            return error;
        }
        switch (error.code) {
            case LANGUAGE_ERROR_CODES.staleDocument:
            case LANGUAGE_ERROR_CODES.documentNotOpen:
                return new StaleResultError(uri);
            case LANGUAGE_ERROR_CODES.unavailable:
                return new LspError(error.message, ErrorCodes.ServerNotInitialized);
            case LANGUAGE_ERROR_CODES.unsupported:
                return new LspError(error.message, ErrorCodes.MethodNotFound);
            case LANGUAGE_ERROR_CODES.cancelled:
                return new LspError(error.message, ErrorCodes.RequestCancelled);
            case LANGUAGE_ERROR_CODES.failed:
                return new LspError(error.message, ErrorCodes.InternalError);
            default:
                return error;
        }
    }

    private documentOf(uri: string): OpenDocument {
        const document = this.documents.get(uri);
        if (!document) {
            throw new LspError(`Document is not open: ${uri}`);
        }
        return document;
    }

    private documentOfPath(path: string): OpenDocument | undefined {
        for (const document of this.documents.values()) {
            if (document.path === path) {
                return document;
            }
        }
        return undefined;
    }

    private pathOfUri(uri: string): string {
        const path = fileUriToPath(uri);
        if (path === null) {
            throw new LspError(`Only file documents have language features: ${uri}`);
        }
        return storedPathOf(this.options.folder, path);
    }
}

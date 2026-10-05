import type {
    CodeAction,
    CodeActionContext,
    CodeLens,
    Command,
    CompletionContext,
    CompletionItem,
    CompletionResult,
    ContentChange,
    Diagnostic,
    Disposable,
    DocumentHighlight,
    DocumentSymbolResult,
    FoldingRange,
    FormattingOptions,
    Hover,
    InlayHint,
    Location,
    NavigationResult,
    Position,
    PrepareRenameResult,
    ProviderOptions,
    Range,
    SelectionRange,
    SemanticTokens,
    SemanticTokensDelta,
    SignatureHelp,
    SignatureHelpContext,
    TextEdit,
    WorkspaceEdit,
    WorkspaceSymbolResult
} from './protocol.ts';

export interface LanguageDocument {
    /* The `file:` URI the language servers know the file by, which `pathToFileUri` makes of a path. */
    uri: string;
    languageId: string;
    text: string;
}

export interface LanguageRequestOptions {
    signal?: AbortSignal;
    /* Runs beside others of its feature, which a newer request would otherwise take over from; for a feature that asks many questions at once. */
    parallel?: boolean;
}

/* What one language server reported for a document. A new report replaces the earlier one of the same `source`. */
export interface DiagnosticsReport {
    uri: string;
    /* Which server, since a document of a pair (Vue and TypeScript) hears from two. */
    source: string;
    /* The document version the report is for; absent when the server did not say. */
    version?: number;
    diagnostics: Diagnostic[];
}

/*
 * What the editor asks of the language side. Everything is in LSP shapes, so a position is a line
 * and a UTF-16 character and a range is two of them; turning those into offsets in a text is the
 * caller's job. A request for a text that moved on rejects with `StaleResultError`, one for a
 * feature nothing supports with an `LspError` of code -32601, and one for a server that is not up
 * with an `LspError` of code -32002.
 */
export interface LanguageService {
    /* Opens the document, or joins it when another client already has it open; the text given then replaces what is held. */
    openDocument(document: LanguageDocument): Promise<void>;
    /* Applies `didChange` entries in order. Every call raises the version by one. */
    changeDocument(uri: string, changes: readonly ContentChange[]): Promise<void>;
    closeDocument(uri: string): Promise<void>;

    /* Whether any server of the document answers `method` now, and the options it gave (trigger characters, a legend, resolve support). */
    supports(method: string, uri: string): boolean;
    providerOptions(method: string, uri: string): ProviderOptions | undefined;
    /* What a document may ask changed: a server came up, registered a feature or asked for a refresh. Semantic tokens and hints are asked again. */
    onProvidersChanged(listener: (uri: string) => void): Disposable;
    onDiagnostics(listener: (report: DiagnosticsReport) => void): Disposable;

    completion(uri: string, position: Position, context?: CompletionContext, options?: LanguageRequestOptions): Promise<CompletionResult>;
    resolveCompletion(uri: string, item: CompletionItem, options?: LanguageRequestOptions): Promise<CompletionItem>;
    hover(uri: string, position: Position, options?: LanguageRequestOptions): Promise<Hover | null>;
    signatureHelp(uri: string, position: Position, context?: SignatureHelpContext, options?: LanguageRequestOptions): Promise<SignatureHelp | null>;
    definition(uri: string, position: Position, options?: LanguageRequestOptions): Promise<NavigationResult>;
    declaration(uri: string, position: Position, options?: LanguageRequestOptions): Promise<NavigationResult>;
    typeDefinition(uri: string, position: Position, options?: LanguageRequestOptions): Promise<NavigationResult>;
    implementation(uri: string, position: Position, options?: LanguageRequestOptions): Promise<NavigationResult>;
    references(uri: string, position: Position, includeDeclaration?: boolean, options?: LanguageRequestOptions): Promise<Location[] | null>;
    documentHighlights(uri: string, position: Position, options?: LanguageRequestOptions): Promise<DocumentHighlight[] | null>;
    documentSymbols(uri: string, options?: LanguageRequestOptions): Promise<DocumentSymbolResult>;
    prepareRename(uri: string, position: Position, options?: LanguageRequestOptions): Promise<PrepareRenameResult>;
    rename(uri: string, position: Position, newName: string, options?: LanguageRequestOptions): Promise<WorkspaceEdit | null>;
    codeActions(uri: string, range: Range, context?: CodeActionContext, options?: LanguageRequestOptions): Promise<(CodeAction | Command)[] | null>;
    resolveCodeAction(uri: string, action: CodeAction, options?: LanguageRequestOptions): Promise<CodeAction>;
    /* Runs a command of a code action on the server that offered it. The server may ask for edits while it runs, which the host applies. */
    executeCommand(uri: string, command: Command, options?: LanguageRequestOptions): Promise<unknown>;
    formatting(uri: string, formatting: FormattingOptions, options?: LanguageRequestOptions): Promise<TextEdit[] | null>;
    rangeFormatting(uri: string, range: Range, formatting: FormattingOptions, options?: LanguageRequestOptions): Promise<TextEdit[] | null>;
    semanticTokens(uri: string, options?: LanguageRequestOptions): Promise<SemanticTokens | null>;
    semanticTokensDelta(uri: string, previousResultId: string, options?: LanguageRequestOptions): Promise<SemanticTokens | SemanticTokensDelta | null>;
    semanticTokensRange(uri: string, range: Range, options?: LanguageRequestOptions): Promise<SemanticTokens | null>;
    inlayHints(uri: string, range: Range, options?: LanguageRequestOptions): Promise<InlayHint[] | null>;
    resolveInlayHint(uri: string, hint: InlayHint, options?: LanguageRequestOptions): Promise<InlayHint>;
    /* The symbols of the whole project that answer to a query, asked of the server that serves the document. */
    workspaceSymbols(uri: string, query: string, options?: LanguageRequestOptions): Promise<WorkspaceSymbolResult>;
    foldingRanges(uri: string, options?: LanguageRequestOptions): Promise<FoldingRange[] | null>;
    /* One chain per position, the smallest range first, each in its `parent`. */
    selectionRanges(uri: string, positions: readonly Position[], options?: LanguageRequestOptions): Promise<SelectionRange[] | null>;
    codeLenses(uri: string, options?: LanguageRequestOptions): Promise<CodeLens[] | null>;
    resolveCodeLens(uri: string, lens: CodeLens, options?: LanguageRequestOptions): Promise<CodeLens>;
}

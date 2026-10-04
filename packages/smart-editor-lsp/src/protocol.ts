export interface Disposable {
    dispose(): void;
}

export type RequestId = number | string;

export interface RpcRequest {
    jsonrpc: '2.0';
    id: RequestId;
    method: string;
    params?: unknown;
}

export interface RpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
}

export interface RpcResponse {
    jsonrpc: '2.0';
    id: RequestId | null;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

export type RpcMessage = RpcRequest | RpcNotification | RpcResponse;

/*
 * What a connection speaks over. A message arrives parsed and is not validated yet, since the
 * connection is the one that knows what a valid one looks like.
 */
export interface LspTransport {
    send(message: RpcMessage): void | Promise<void>;
    onMessage(listener: (message: unknown) => void): Disposable;
    onClose(listener: (error?: Error) => void): Disposable;
    close(): void | Promise<void>;
}

export interface RequestOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
}

export interface DocumentRequestOptions extends RequestOptions {
    /* A newer request for the same feature of the same document cancels this one. On unless `false`. */
    cancelPrevious?: boolean;
}

/* Zero-based, and a character counts UTF-16 code units. */
export interface Position {
    line: number;
    character: number;
}

export interface Range {
    start: Position;
    end: Position;
}

export interface Location {
    uri: string;
    range: Range;
}

export interface LocationLink {
    originSelectionRange?: Range;
    targetUri: string;
    targetRange: Range;
    targetSelectionRange: Range;
}

export type NavigationResult = Location | Location[] | LocationLink[] | null;

export interface TextEdit {
    range: Range;
    newText: string;
    annotationId?: string;
}

/* One entry of `didChange`: a replacement of a range, or without a range the whole text. */
export interface ContentChange {
    range?: Range;
    text: string;
}

export interface InsertReplaceEdit {
    newText: string;
    insert: Range;
    replace: Range;
}

export interface MarkupContent {
    kind: 'plaintext' | 'markdown';
    value: string;
}

export type MarkedString = string | { language: string; value: string };

export interface Command {
    title: string;
    command: string;
    arguments?: unknown[];
}

export interface Diagnostic {
    range: Range;
    message: string;
    severity?: 1 | 2 | 3 | 4;
    code?: number | string;
    codeDescription?: { href: string };
    source?: string;
    tags?: number[];
    relatedInformation?: { location: Location; message: string }[];
    data?: unknown;
}

export interface PublishDiagnosticsParams {
    uri: string;
    version?: number;
    diagnostics: Diagnostic[];
}

export interface CompletionContext {
    triggerKind: 1 | 2 | 3;
    triggerCharacter?: string;
}

export interface CompletionItem {
    label: string;
    labelDetails?: { detail?: string; description?: string };
    kind?: number;
    tags?: number[];
    detail?: string;
    documentation?: string | MarkupContent;
    deprecated?: boolean;
    preselect?: boolean;
    sortText?: string;
    filterText?: string;
    insertText?: string;
    insertTextFormat?: 1 | 2;
    insertTextMode?: 1 | 2;
    textEdit?: TextEdit | InsertReplaceEdit;
    textEditText?: string;
    additionalTextEdits?: TextEdit[];
    commitCharacters?: string[];
    command?: Command;
    data?: unknown;
    [extension: string]: unknown;
}

export interface CompletionList {
    isIncomplete: boolean;
    items: CompletionItem[];
    itemDefaults?: {
        commitCharacters?: string[];
        editRange?: Range | { insert: Range; replace: Range };
        insertTextFormat?: 1 | 2;
        insertTextMode?: 1 | 2;
        data?: unknown;
    };
}

export type CompletionResult = CompletionItem[] | CompletionList | null;

export interface Hover {
    contents: MarkupContent | MarkedString | MarkedString[];
    range?: Range;
}

export interface DocumentHighlight {
    range: Range;
    kind?: 1 | 2 | 3;
}

export type SymbolKind = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26;

export interface DocumentSymbol {
    name: string;
    detail?: string;
    kind: SymbolKind;
    tags?: 1[];
    deprecated?: boolean;
    range: Range;
    selectionRange: Range;
    children?: DocumentSymbol[];
}

export interface SymbolInformation {
    name: string;
    kind: SymbolKind;
    tags?: 1[];
    deprecated?: boolean;
    location: Location;
    containerName?: string;
}

export interface WorkspaceSymbol {
    name: string;
    kind: SymbolKind;
    tags?: 1[];
    containerName?: string;
    location: Location | { uri: string };
    data?: unknown;
}

export type DocumentSymbolResult = DocumentSymbol[] | SymbolInformation[] | null;
export type WorkspaceSymbolResult = SymbolInformation[] | WorkspaceSymbol[] | null;

export interface ParameterInformation {
    label: string | [number, number];
    documentation?: string | MarkupContent;
}

export interface SignatureInformation {
    label: string;
    documentation?: string | MarkupContent;
    parameters?: ParameterInformation[];
    activeParameter?: number;
}

export interface SignatureHelp {
    signatures: SignatureInformation[];
    activeSignature?: number;
    activeParameter?: number;
}

export interface SignatureHelpContext {
    triggerKind: 1 | 2 | 3;
    triggerCharacter?: string;
    isRetrigger: boolean;
    activeSignatureHelp?: SignatureHelp;
}

export type PrepareRenameResult = Range | { range: Range; placeholder: string } | { defaultBehavior: boolean } | null;

export interface TextDocumentEdit {
    textDocument: { uri: string; version: number | null };
    edits: TextEdit[];
}

export interface CreateFile {
    kind: 'create';
    uri: string;
    options?: { overwrite?: boolean; ignoreIfExists?: boolean };
    annotationId?: string;
}

export interface RenameFile {
    kind: 'rename';
    oldUri: string;
    newUri: string;
    options?: { overwrite?: boolean; ignoreIfExists?: boolean };
    annotationId?: string;
}

export interface DeleteFile {
    kind: 'delete';
    uri: string;
    options?: { recursive?: boolean; ignoreIfNotExists?: boolean };
    annotationId?: string;
}

export interface WorkspaceEdit {
    changes?: Record<string, TextEdit[]>;
    documentChanges?: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[];
    changeAnnotations?: Record<string, { label: string; needsConfirmation?: boolean; description?: string }>;
}

export interface ApplyWorkspaceEditParams {
    label?: string;
    edit: WorkspaceEdit;
}

export interface ApplyWorkspaceEditResult {
    applied: boolean;
    failureReason?: string;
    failedChange?: number;
}

export interface CodeAction {
    title: string;
    kind?: string;
    diagnostics?: Diagnostic[];
    isPreferred?: boolean;
    disabled?: { reason: string };
    edit?: WorkspaceEdit;
    command?: Command;
    data?: unknown;
    [extension: string]: unknown;
}

export interface CodeActionContext {
    diagnostics: Diagnostic[];
    only?: string[];
    triggerKind?: 1 | 2;
}

export interface FormattingOptions {
    tabSize: number;
    insertSpaces: boolean;
    trimTrailingWhitespace?: boolean;
    insertFinalNewline?: boolean;
    trimFinalNewlines?: boolean;
    [key: string]: boolean | number | string | undefined;
}

export interface SemanticTokens {
    resultId?: string;
    data: number[];
}

export interface SemanticTokensDelta {
    resultId?: string;
    edits: { start: number; deleteCount: number; data?: number[] }[];
}

export interface SemanticTokensLegend {
    tokenTypes: string[];
    tokenModifiers: string[];
}

export interface InlayHintLabelPart {
    value: string;
    tooltip?: string | MarkupContent;
    location?: Location;
    command?: Command;
}

export interface InlayHint {
    position: Position;
    label: string | InlayHintLabelPart[];
    kind?: 1 | 2;
    textEdits?: TextEdit[];
    tooltip?: string | MarkupContent;
    paddingLeft?: boolean;
    paddingRight?: boolean;
    data?: unknown;
    [extension: string]: unknown;
}

export interface FoldingRange {
    startLine: number;
    startCharacter?: number;
    endLine: number;
    endCharacter?: number;
    kind?: string;
    collapsedText?: string;
}

export interface CodeLens {
    range: Range;
    command?: Command;
    data?: unknown;
}

export type DocumentDiagnosticReport =
    | { kind: 'full'; resultId?: string; items: Diagnostic[]; relatedDocuments?: Record<string, DocumentDiagnosticReport> }
    | { kind: 'unchanged'; resultId: string; relatedDocuments?: Record<string, DocumentDiagnosticReport> };

export interface DocumentFilter {
    language?: string;
    scheme?: string;
    pattern?: string;
}

export interface Registration {
    id: string;
    method: string;
    registerOptions?: ProviderOptions;
}

export interface ProviderOptions {
    documentSelector?: DocumentFilter[] | null;
    resolveProvider?: boolean;
    prepareProvider?: boolean;
    triggerCharacters?: string[];
    retriggerCharacters?: string[];
    commands?: string[];
    codeActionKinds?: string[];
    legend?: SemanticTokensLegend;
    range?: boolean | object;
    full?: boolean | { delta?: boolean };
    [option: string]: unknown;
}

export interface TextDocumentSyncOptions {
    openClose?: boolean;
    change?: 0 | 1 | 2;
    willSave?: boolean;
    willSaveWaitUntil?: boolean;
    save?: boolean | { includeText?: boolean };
}

export interface ServerCapabilities {
    positionEncoding?: string;
    textDocumentSync?: 0 | 1 | 2 | TextDocumentSyncOptions;
    completionProvider?: ProviderOptions;
    hoverProvider?: boolean | ProviderOptions;
    signatureHelpProvider?: ProviderOptions;
    definitionProvider?: boolean | ProviderOptions;
    declarationProvider?: boolean | ProviderOptions;
    typeDefinitionProvider?: boolean | ProviderOptions;
    implementationProvider?: boolean | ProviderOptions;
    referencesProvider?: boolean | ProviderOptions;
    documentHighlightProvider?: boolean | ProviderOptions;
    documentSymbolProvider?: boolean | ProviderOptions;
    workspaceSymbolProvider?: boolean | ProviderOptions;
    renameProvider?: boolean | ProviderOptions;
    codeActionProvider?: boolean | ProviderOptions;
    codeLensProvider?: ProviderOptions;
    executeCommandProvider?: ProviderOptions;
    documentFormattingProvider?: boolean | ProviderOptions;
    documentRangeFormattingProvider?: boolean | ProviderOptions;
    foldingRangeProvider?: boolean | ProviderOptions;
    semanticTokensProvider?: ProviderOptions & { legend: SemanticTokensLegend };
    inlayHintProvider?: boolean | ProviderOptions;
    diagnosticProvider?: ProviderOptions;
    [capability: string]: unknown;
}

export interface InitializeResult {
    capabilities: ServerCapabilities;
    serverInfo?: { name: string; version?: string };
}

export interface WorkspaceFolder {
    uri: string;
    name: string;
}

export interface DocumentItem {
    uri: string;
    languageId: string;
    text: string;
    version?: number;
}

export interface ConfigurationItem {
    scopeUri?: string;
    section?: string;
}

export interface ProgressParams {
    token: string | number;
    value: unknown;
}

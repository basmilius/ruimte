import { changedSpan, DocumentModel, type EditorSnapshot, replacementText } from '@ruimte/smart-editor-core';
import { InputController } from './controller.ts';
import { emit, type Listener, subscribe } from './listeners.ts';
import type {
    Editor,
    EditorBlock,
    EditorChangeMark,
    EditorClickHandler,
    EditorContextMenu,
    EditorContentChange,
    EditorEngine,
    EditorFindQuery,
    EditorIndentation,
    EditorFindState,
    EditorGutterAction,
    EditorHighlight,
    EditorHover,
    EditorInlayHint,
    EditorKeyHandler,
    EditorMarker,
    EditorOptions,
    EditorPosition,
    EditorRange,
    EditorRect,
    EditorSemanticToken,
    EditorTextChange,
    EditorTheme,
    EditorWidget,
    SmartEditorEngineOptions
} from './types.ts';
import { EditorView, type ViewSettings } from './view.ts';

const DEFAULT_TAB_SIZE = 4;

class SmartEditor implements Editor {
    private readonly model: DocumentModel;
    private readonly settings: ViewSettings;
    private readonly view: EditorView;
    private readonly controller: InputController;
    private readonly changes = new Set<Listener>();
    private readonly textChanges = new Set<(change: EditorTextChange) => void>();
    private readonly carets = new Set<(position: EditorPosition) => void>();
    private caretOffset = 0;
    private readonly saves = new Set<Listener>();
    private readonly blurs = new Set<Listener>();
    private readonly subscription: { dispose(): void };
    private language: string | undefined;
    private theme: EditorTheme;
    private revision: number;
    private tokenizerRequest = 0;
    private settingText = false;
    private disposed = false;

    private readonly engine: SmartEditorEngineOptions;

    constructor(engine: SmartEditorEngineOptions, element: HTMLElement, options: EditorOptions) {
        this.engine = engine;
        this.model = new DocumentModel(options.text);
        this.language = options.language;
        this.theme = options.theme;
        this.settings = {
            language: options.language,
            tabSize: options.indentation?.tabSize ?? DEFAULT_TAB_SIZE,
            insertSpaces: options.indentation?.insertSpaces ?? true,
            readOnly: options.readOnly ?? false,
            readOnlyReason: options.readOnlyReason,
            wrap: options.wrap ?? false
        };
        this.view = new EditorView(element, this.model, this.settings);
        this.controller = new InputController(this.view, {
            handBack: engine.handBack ?? [],
            apple: engine.apple ?? false,
            save: () => emit(this.saves),
            blur: () => emit(this.blurs)
        });
        this.revision = this.model.getRevision();
        this.caretOffset = this.model.getSelections()[0]!.head;
        this.subscription = this.model.subscribe((snapshot) => {
            this.caretMoved(snapshot.selections[0]!.head);
            if (snapshot.revision !== this.revision) {
                this.revision = snapshot.revision;
                if (snapshot.contentEdits !== undefined && snapshot.contentEdits.length > 0) {
                    this.announceTextChange(snapshot.contentEdits, snapshot.source ?? 'external');
                }
                if (!this.settingText) {
                    emit(this.changes);
                }
            }
        });
        this.loadTokenizer();
        this.placeCursor(options);
    }

    /* Where the editor opens: on a line and column, scrolled to a position, or with that line in view. */
    private placeCursor(options: EditorOptions): void {
        if (options.line !== undefined) {
            const line = this.clampLine(options.line);
            const bounds = this.model.getLine(line);
            const offset = Math.min(bounds.end, bounds.start + Math.max(0, (options.column ?? 1) - 1));
            this.model.setSelections([{ anchor: offset, head: offset }]);
            if (options.scrollTop === undefined) {
                this.view.revealOffset(offset, true);
            }
        }
        if (options.scrollTop !== undefined) {
            this.view.render();
            this.view.viewport.scrollTop = options.scrollTop;
            this.view.render();
        }
    }

    private loadTokenizer(): void {
        const request = ++this.tokenizerRequest;
        void this.engine
            .scopeColors?.(this.theme)
            .catch(() => null)
            .then((colors) => {
                if (!this.disposed && request === this.tokenizerRequest) {
                    this.view.setScopeColors(colors ?? null);
                }
            });
        void this.engine
            .tokenizer(this.language, this.theme)
            .catch(() => null)
            .then((tokenizer) => {
                if (!this.disposed && request === this.tokenizerRequest) {
                    this.view.setTokenizer(tokenizer);
                }
            });
    }

    getText(): string {
        return this.model.getText();
    }

    setText(text: string): void {
        const span = changedSpan(this.model.getText(), text);
        if (span === null) {
            return;
        }
        this.settingText = true;
        try {
            // An edit and not a reset, which would drop the undo history and put the cursor on line one.
            this.model.applyEdits([{ from: span.start, to: span.end, text: span.text }], { source: 'external' });
        } finally {
            this.settingText = false;
        }
    }

    onChange(listener: Listener): () => void {
        return subscribe(this.changes, listener);
    }

    onTextChange(listener: (change: EditorTextChange) => void): () => void {
        this.textChanges.add(listener);
        return () => {
            this.textChanges.delete(listener);
        };
    }

    private announceTextChange(edits: NonNullable<EditorSnapshot['contentEdits']>, source: EditorTextChange['source']): void {
        const change: EditorTextChange = {
            source,
            changes: edits.map((edit) => ({
                range: { start: { line: edit.start.line, character: edit.start.column }, end: { line: edit.end.line, character: edit.end.column } },
                text: edit.text
            }))
        };
        for (const listener of [...this.textChanges]) {
            listener(change);
        }
    }

    private caretMoved(head: number): void {
        if (head === this.caretOffset) {
            return;
        }
        this.caretOffset = head;
        const position = this.positionAt(head);
        for (const listener of [...this.carets]) {
            listener(position);
        }
    }

    getCaret(): EditorPosition {
        return this.positionAt(this.model.getSelections()[0]!.head);
    }

    getSelection(): EditorRange {
        const { anchor, head } = this.model.getSelections()[0]!;
        return { start: this.positionAt(Math.min(anchor, head)), end: this.positionAt(Math.max(anchor, head)) };
    }

    getIndentation(): EditorIndentation {
        return { tabSize: this.settings.tabSize, insertSpaces: this.settings.insertSpaces };
    }

    setCaret(position: EditorPosition): void {
        const offset = this.offsetAt(position);
        this.model.setSelections([{ anchor: offset, head: offset }]);
        this.view.revealOffset(offset);
    }

    onCaret(listener: (position: EditorPosition) => void): () => void {
        this.carets.add(listener);
        return () => {
            this.carets.delete(listener);
        };
    }

    onHover(listener: (hover: EditorHover | null) => void): () => void {
        return this.view.onHover((offset) => {
            const rect = offset === null ? null : this.view.clientRectOf(offset);
            listener(offset === null || rect === null ? null : { position: this.positionAt(offset), rect });
        });
    }

    rectAt(position: EditorPosition): EditorRect | null {
        return this.view.clientRectOf(this.offsetAt(position));
    }

    onViewChange(listener: Listener): () => void {
        return this.view.onViewChange(listener);
    }

    onClick(handler: EditorClickHandler): () => void {
        return this.controller.onClick(handler);
    }

    onContextMenu(listener: (menu: EditorContextMenu) => void): () => void {
        return this.controller.onContextMenu(listener);
    }

    onKeyDown(handler: EditorKeyHandler): () => void {
        return this.controller.onKeyDown(handler);
    }

    applyEdits(edits: readonly EditorContentChange[]): boolean {
        if (this.settings.readOnly || edits.length === 0) {
            return false;
        }
        try {
            return this.model.applyEdits(
                edits.map((edit) => ({ from: this.offsetAt(edit.range.start), to: this.offsetAt(edit.range.end), text: edit.text })),
                { source: 'command' }
            );
        } catch {
            return false;
        }
    }

    setMarkers(markers: readonly EditorMarker[]): void {
        this.view.setMarkers(
            markers.map((marker) => ({
                severity: marker.severity,
                from: this.offsetAt(marker.range.start),
                to: this.offsetAt(marker.range.end),
                unnecessary: marker.unnecessary === true,
                deprecated: marker.deprecated === true
            }))
        );
    }

    setInlayHints(hints: readonly EditorInlayHint[]): void {
        this.view.setInlays(hints.map((hint, index) => ({ id: `hint-${index}`, at: this.offsetAt(hint.position), text: hint.label })));
    }

    setSemanticTokens(tokens: readonly EditorSemanticToken[] | null): void {
        this.view.setSemanticTokens(
            tokens === null
                ? null
                : tokens.map((token) => {
                      const from = this.offsetAt({ line: token.line, character: token.character });
                      return { from, to: from + token.length, scopes: token.scopes };
                  })
        );
    }

    setHighlights(highlights: readonly EditorHighlight[]): void {
        this.view.setOccurrences(
            highlights.map((highlight) => ({ from: this.offsetAt(highlight.range.start), to: this.offsetAt(highlight.range.end), kind: highlight.kind }))
        );
    }

    positionAt(offset: number): EditorPosition {
        const { line, column } = this.model.positionAt(offset);
        return { line, character: column };
    }

    textInRange(range: EditorRange): string {
        return this.model.slice(this.offsetAt(range.start), this.offsetAt(range.end));
    }

    offsetAt(position: EditorPosition): number {
        return this.model.offsetAt({ line: Math.max(0, position.line), column: Math.max(0, position.character) });
    }

    onSave(listener: Listener): () => void {
        return subscribe(this.saves, listener);
    }

    onBlur(listener: Listener): () => void {
        return subscribe(this.blurs, listener);
    }

    revealLine(line: number): void {
        const bounds = this.model.getLine(this.clampLine(line));
        this.model.setSelections([{ anchor: bounds.start, head: bounds.start }]);
        this.view.revealOffset(bounds.start, true);
    }

    find(query: EditorFindQuery | null): void {
        this.view.setFind(query, true);
    }

    findStep(direction: 1 | -1): void {
        this.view.stepFind(direction);
    }

    replace(replacement: string): boolean {
        const { find } = this.view;
        const mark = find.currentMark;
        const query = find.activeQuery;
        if (mark === null || query === null || this.blockedByReadOnly()) {
            return false;
        }
        try {
            const options = { caseSensitive: query.caseSensitive, wholeWord: query.wholeWord, regex: query.regex, from: mark.from, to: mark.to, maxResults: 1 };
            const match = this.model.find(query.text, options)[0];
            if (match === undefined) {
                return false;
            }
            // The next match is looked for after what was written, or a replacement that holds the query would find itself again.
            find.pendingAnchor = mark.from + replacementText(this.model.getText(), match, replacement).length;
            if (!this.model.replace(match, replacement)) {
                find.pendingAnchor = undefined;
                return false;
            }
        } catch {
            find.pendingAnchor = undefined;
            return false;
        }
        this.view.revealFind();
        this.view.render();
        return true;
    }

    replaceAll(replacement: string): number {
        const query = this.view.find.activeQuery;
        if (query === null || this.blockedByReadOnly()) {
            return 0;
        }
        try {
            return this.model.replaceAll(query.text, replacement, { caseSensitive: query.caseSensitive, wholeWord: query.wholeWord, regex: query.regex });
        } catch {
            return 0;
        }
    }

    private blockedByReadOnly(): boolean {
        if (!this.settings.readOnly) {
            return false;
        }
        if (this.settings.readOnlyReason) {
            this.view.notify(this.settings.readOnlyReason);
        }
        return true;
    }

    onFind(listener: (state: EditorFindState) => void): () => void {
        return this.view.onFind(listener);
    }

    endFind(): void {
        const mark = this.view.find.currentMark;
        this.view.setFind(null, false);
        if (mark) {
            this.view.ensureVisible(mark.from);
            this.model.setSelections([{ anchor: mark.from, head: mark.to }]);
            this.view.revealCaret();
        }
    }

    setWrap(wrap: boolean): void {
        this.settings.wrap = wrap;
        if (wrap) {
            this.view.viewport.scrollLeft = 0;
        }
        this.view.applySettings();
    }

    setChangeMarks(marks: readonly EditorChangeMark[]): void {
        this.view.setChangeMarks(marks);
    }

    setWidgets(widgets: readonly EditorWidget[]): void {
        this.view.setBlockWidgets(
            widgets.map((widget) => ({
                id: `widget:${widget.id}`,
                at: this.offsetAt({ line: widget.line, character: 0 }),
                placement: 'below' as const,
                height: widget.height,
                render: (container: HTMLElement) => {
                    container.classList.add('se-widget');
                    widget.render(container);
                }
            }))
        );
    }

    setGutterAction(action: EditorGutterAction | null): void {
        this.view.setGutterAction(action);
    }

    onGutterAction(listener: (line: number) => void): () => void {
        return this.view.onGutterAction(listener);
    }

    setBlocks(blocks: readonly EditorBlock[] | null): void {
        this.view.setBlocks(blocks);
    }

    onScope(listener: (scope: readonly EditorBlock[]) => void): () => void {
        return this.view.onScope(listener);
    }

    setIndentation(indentation: EditorIndentation): void {
        if (indentation.tabSize === this.settings.tabSize && indentation.insertSpaces === this.settings.insertSpaces) {
            return;
        }
        this.settings.tabSize = indentation.tabSize;
        this.settings.insertSpaces = indentation.insertSpaces;
        this.view.applySettings();
    }

    setTheme(theme: EditorTheme): void {
        if (theme !== this.theme) {
            this.theme = theme;
            this.loadTokenizer();
        }
    }

    refreshFont(): void {
        this.view.refreshFont();
    }

    setReadOnly(readOnly: boolean, reason?: string): void {
        this.settings.readOnly = readOnly;
        this.settings.readOnlyReason = reason;
        this.view.applySettings();
    }

    focus(): void {
        this.view.focus();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.changes.clear();
        this.textChanges.clear();
        this.carets.clear();
        this.saves.clear();
        this.blurs.clear();
        this.subscription.dispose();
        this.controller.dispose();
        this.view.dispose();
    }

    private clampLine(line: number): number {
        return Math.min(Math.max(1, Math.trunc(line) || 1), this.model.getLineCount()) - 1;
    }
}

class SmartEditorEngine implements EditorEngine {
    private readonly options: SmartEditorEngineOptions;

    constructor(options: SmartEditorEngineOptions) {
        this.options = options;
    }

    mount(element: HTMLElement, options: EditorOptions): Editor {
        return new SmartEditor(this.options, element, options);
    }
}

export function createSmartEditorEngine(options: SmartEditorEngineOptions): EditorEngine {
    return new SmartEditorEngine(options);
}

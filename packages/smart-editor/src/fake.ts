import type {
    Editor,
    EditorBlock,
    EditorChangeMark,
    EditorClick,
    EditorClickHandler,
    EditorContextMenu,
    EditorContentChange,
    EditorEngine,
    EditorFindQuery,
    EditorFindState,
    EditorGutterAction,
    EditorHighlight,
    EditorHover,
    EditorIndentation,
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
    EditorWidget
} from './types.ts';
import { emit, type Listener, subscribe } from './listeners.ts';
import { changedSpan } from '@ruimte/smart-editor-core';

function positionIn(text: string, offset: number): EditorPosition {
    const before = text.slice(0, Math.max(0, offset));
    const lines = before.split('\n');
    return { line: lines.length - 1, character: lines.at(-1)!.length };
}

/* An editor without a DOM, for tests: `type`, `save` and `blur` do what a person would, the rest says what the client asked of it. */
export class FakeEditor implements Editor {
    readonly element: HTMLElement;
    readonly language: string | undefined;
    readonly path: string | undefined;
    readonly column: number | null;
    readonly scrollTop: number | null;
    wrap: boolean;
    theme: EditorTheme;
    readOnly: boolean;
    readOnlyReason: string | undefined;
    revealedLine: number | null;
    focused = false;
    indentation: EditorIndentation;
    /* How often the client asked it to read the code face off the page again. */
    fontRefreshes = 0;
    disposed = false;
    /* What the client asked to find last; null once it ended the find. */
    findQuery: EditorFindQuery | null = null;
    findState: EditorFindState = { count: 0, current: null };
    private text: string;
    private readonly changes = new Set<Listener>();
    private readonly textChanges = new Set<(change: EditorTextChange) => void>();
    private readonly saves = new Set<Listener>();
    private readonly blurs = new Set<Listener>();
    private readonly finds = new Set<(state: EditorFindState) => void>();

    constructor(element: HTMLElement, options: EditorOptions) {
        this.element = element;
        this.text = options.text;
        this.language = options.language;
        this.path = options.path;
        this.wrap = options.wrap ?? false;
        this.indentation = options.indentation ?? { tabSize: 4, insertSpaces: true };
        this.theme = options.theme;
        this.readOnly = options.readOnly ?? false;
        this.readOnlyReason = options.readOnlyReason;
        this.revealedLine = options.line ?? null;
        this.column = options.column ?? null;
        this.scrollTop = options.scrollTop ?? null;
    }

    /* A person's edit: the text changes and every change listener hears it. A read-only editor refuses it, as the real editor does. */
    type(text: string): void {
        this.assertLive();
        if (this.readOnly || text === this.text) {
            return;
        }
        this.replaceText(text, 'input');
        emit(this.changes);
    }

    /* Mod+S inside the editor. */
    save(): void {
        this.assertLive();
        emit(this.saves);
    }

    /* The focus leaving the editor. */
    blur(): void {
        this.assertLive();
        this.focused = false;
        emit(this.blurs);
    }

    getText(): string {
        return this.text;
    }

    setText(text: string): void {
        this.assertLive();
        this.replaceText(text);
    }

    /* The text becomes `text`, and listeners of the text hear the one stretch that differs, as the real editor reports it. */
    private replaceText(text: string, source: EditorTextChange['source'] = 'external'): void {
        const span = changedSpan(this.text, text);
        const before = this.text;
        this.text = text;
        if (span === null) {
            return;
        }
        // As in the real editor the caret lands behind what was typed, and listeners of the caret hear it before those of the text.
        if (source !== 'external') {
            this.moveCaret(positionIn(text, span.start + span.text.length));
        }
        const change: EditorTextChange = {
            source,
            changes: [{ range: { start: positionIn(before, span.start), end: positionIn(before, span.end) }, text: span.text }]
        };
        for (const listener of [...this.textChanges]) {
            listener(change);
        }
    }

    onTextChange(listener: (change: EditorTextChange) => void): () => void {
        this.textChanges.add(listener);
        return () => {
            this.textChanges.delete(listener);
        };
    }

    positionAt(offset: number): EditorPosition {
        return positionIn(this.text, offset);
    }

    textInRange(range: EditorRange): string {
        return this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
    }

    offsetAt(position: EditorPosition): number {
        const lines = this.text.split('\n');
        let offset = 0;
        for (let line = 0; line < Math.min(position.line, lines.length - 1); line++) {
            offset += lines[line]!.length + 1;
        }
        const current = lines[Math.min(position.line, lines.length - 1)]!;
        return offset + Math.min(position.character, current.length);
    }

    onChange(listener: Listener): () => void {
        return subscribe(this.changes, listener);
    }

    onSave(listener: Listener): () => void {
        return subscribe(this.saves, listener);
    }

    onBlur(listener: Listener): () => void {
        return subscribe(this.blurs, listener);
    }

    revealLine(line: number): void {
        this.revealedLine = line;
    }

    /* Counts plain occurrences only; the matcher itself is the editor's, and a test here is about the client's side. */
    find(query: EditorFindQuery | null): void {
        this.findQuery = query;
        const needle = query === null || query.text === '' ? '' : query.caseSensitive ? query.text : query.text.toLowerCase();
        const haystack = query?.caseSensitive === true ? this.text : this.text.toLowerCase();
        const count = needle === '' ? 0 : haystack.split(needle).length - 1;
        this.announceFind({ count, current: count === 0 ? null : 0 });
    }

    /* What the client asked to replace, one match at a time and all at once. */
    replacements: string[] = [];
    replacementsOfAll: string[] = [];

    replace(replacement: string): boolean {
        this.replacements.push(replacement);
        return !this.readOnly && this.findState.count > 0;
    }

    replaceAll(replacement: string): number {
        this.replacementsOfAll.push(replacement);
        return this.readOnly ? 0 : this.findState.count;
    }

    findStep(direction: 1 | -1): void {
        const { count, current } = this.findState;
        if (count > 0) {
            this.announceFind({ count, current: ((current ?? 0) + direction + count) % count });
        }
    }

    onFind(listener: (state: EditorFindState) => void): () => void {
        this.finds.add(listener);
        return () => {
            this.finds.delete(listener);
        };
    }

    endFind(): void {
        this.find(null);
    }

    setWrap(wrap: boolean): void {
        this.wrap = wrap;
    }

    /* What the client handed it last; null while it reads the structure itself. */
    blocks: readonly EditorBlock[] | null = null;
    private readonly scopes = new Set<(scope: readonly EditorBlock[]) => void>();

    /* What the client marked as changed last. */
    changeMarks: readonly EditorChangeMark[] = [];

    setChangeMarks(marks: readonly EditorChangeMark[]): void {
        this.changeMarks = marks;
    }

    /* What the client put under lines of the text last. */
    widgets: readonly EditorWidget[] = [];

    setWidgets(widgets: readonly EditorWidget[]): void {
        this.widgets = widgets;
    }

    /* The button the client set in the gutter last. */
    gutterAction: EditorGutterAction | null = null;
    private readonly gutterActionListeners = new Set<(line: number) => void>();

    setGutterAction(action: EditorGutterAction | null): void {
        this.gutterAction = action;
    }

    onGutterAction(listener: (line: number) => void): () => void {
        this.gutterActionListeners.add(listener);
        return () => {
            this.gutterActionListeners.delete(listener);
        };
    }

    /* A press on the gutter button, if there is one. */
    pressGutterAction(): void {
        if (this.gutterAction !== null) {
            for (const listener of [...this.gutterActionListeners]) {
                listener(this.gutterAction.line);
            }
        }
    }

    setBlocks(blocks: readonly EditorBlock[] | null): void {
        this.blocks = blocks;
    }

    onScope(listener: (scope: readonly EditorBlock[]) => void): () => void {
        this.scopes.add(listener);
        return () => {
            this.scopes.delete(listener);
        };
    }

    /* The caret moving into blocks, for a test of what the client draws from it. */
    enterScope(scope: readonly EditorBlock[]): void {
        for (const listener of [...this.scopes]) {
            listener(scope);
        }
    }

    setIndentation(indentation: EditorIndentation): void {
        this.indentation = indentation;
    }

    /* What the client marked and highlighted last. */
    markers: readonly EditorMarker[] = [];
    highlights: readonly EditorHighlight[] = [];
    caret: EditorPosition = { line: 0, character: 0 };
    /* Where `rectAt` puts a position, which a test can move to simulate scrolling. */
    origin = { left: 100, top: 100 };
    charSize = { width: 8, height: 20 };
    private readonly carets = new Set<(position: EditorPosition) => void>();
    private readonly hovers = new Set<(hover: EditorHover | null) => void>();
    private readonly views = new Set<Listener>();
    private readonly keys = new Set<EditorKeyHandler>();

    setMarkers(markers: readonly EditorMarker[]): void {
        this.markers = markers;
    }

    /* What the client drew as hints last. */
    inlayHints: readonly EditorInlayHint[] = [];

    setInlayHints(hints: readonly EditorInlayHint[]): void {
        this.inlayHints = hints;
    }

    /* What the client classified last. */
    semanticTokens: readonly EditorSemanticToken[] | null = null;

    setSemanticTokens(tokens: readonly EditorSemanticToken[] | null): void {
        this.semanticTokens = tokens;
    }

    setHighlights(highlights: readonly EditorHighlight[]): void {
        this.highlights = highlights;
    }

    getCaret(): EditorPosition {
        return this.caret;
    }

    getScrollTop(): number {
        return this.scrollTop ?? 0;
    }

    /* The selection a person made; without one the caret. */
    selection: EditorRange | null = null;

    getSelection(): EditorRange {
        return this.selection ?? { start: this.caret, end: this.caret };
    }

    getIndentation(): EditorIndentation {
        return this.indentation;
    }

    setCaret(position: EditorPosition): void {
        this.caret = position;
        this.revealedLine = position.line + 1;
        this.moveCaret(position);
    }

    /* The caret a person's click or key moved. */
    moveCaret(position: EditorPosition): void {
        this.caret = position;
        this.selection = null;
        for (const listener of [...this.carets]) {
            listener(position);
        }
    }

    onCaret(listener: (position: EditorPosition) => void): () => void {
        this.carets.add(listener);
        return () => {
            this.carets.delete(listener);
        };
    }

    onHover(listener: (hover: EditorHover | null) => void): () => void {
        this.hovers.add(listener);
        return () => {
            this.hovers.delete(listener);
        };
    }

    /* The pointer resting on a position, or leaving the text. */
    hover(position: EditorPosition | null): void {
        const hover = position === null ? null : { position, rect: this.rectAt(position)! };
        for (const listener of [...this.hovers]) {
            listener(hover);
        }
    }

    rectAt(position: EditorPosition): EditorRect | null {
        const left = this.origin.left + position.character * this.charSize.width;
        const top = this.origin.top + position.line * this.charSize.height;
        return { left, top, right: left + this.charSize.width, bottom: top + this.charSize.height };
    }

    onViewChange(listener: Listener): () => void {
        return subscribe(this.views, listener);
    }

    /* The editor scrolling. */
    scroll(): void {
        emit(this.views);
    }

    onKeyDown(handler: EditorKeyHandler): () => void {
        this.keys.add(handler);
        return () => {
            this.keys.delete(handler);
        };
    }

    private readonly clickHandlers = new Set<EditorClickHandler>();
    private readonly contextListeners = new Set<(menu: EditorContextMenu) => void>();

    onClick(handler: EditorClickHandler): () => void {
        this.clickHandlers.add(handler);
        return () => {
            this.clickHandlers.delete(handler);
        };
    }

    onContextMenu(listener: (menu: EditorContextMenu) => void): () => void {
        this.contextListeners.add(listener);
        return () => {
            this.contextListeners.delete(listener);
        };
    }

    /* A press on a character as the editor sees it first; true when a handler took it, and the caret stays where it is otherwise only until the test moves it. */
    click(click: EditorClick): boolean {
        return [...this.clickHandlers].some((handler) => handler(click));
    }

    /* The context menu asked for at a position. */
    openContextMenu(menu: EditorContextMenu): void {
        for (const listener of [...this.contextListeners]) {
            listener(menu);
        }
    }

    /* A key as the editor sees it first; true when a handler took it. */
    press(event: Pick<KeyboardEvent, 'key'> & Partial<KeyboardEvent>): boolean {
        const full = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: () => undefined, ...event } as KeyboardEvent;
        return [...this.keys].some((handler) => handler(full));
    }

    applyEdits(edits: readonly EditorContentChange[]): boolean {
        if (this.readOnly || edits.length === 0) {
            return false;
        }
        let text = this.text;
        const ordered = edits
            .map((edit) => ({ from: this.offsetAt(edit.range.start), to: this.offsetAt(edit.range.end), text: edit.text }))
            .sort((a, b) => b.from - a.from);
        for (const edit of ordered) {
            text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
        }
        this.replaceText(text, 'command');
        emit(this.changes);
        return true;
    }

    setTheme(theme: EditorTheme): void {
        this.theme = theme;
    }

    refreshFont(): void {
        this.fontRefreshes += 1;
    }

    setReadOnly(readOnly: boolean, reason?: string): void {
        this.readOnly = readOnly;
        this.readOnlyReason = reason;
    }

    focus(): void {
        this.focused = true;
    }

    dispose(): void {
        this.disposed = true;
        this.changes.clear();
        this.textChanges.clear();
        this.carets.clear();
        this.hovers.clear();
        this.views.clear();
        this.keys.clear();
        this.saves.clear();
        this.blurs.clear();
        this.finds.clear();
        this.scopes.clear();
    }

    private announceFind(state: EditorFindState): void {
        this.findState = state;
        for (const listener of [...this.finds]) {
            listener(state);
        }
    }

    /* A test that drives an editor its client already disposed has found a leak. */
    private assertLive(): void {
        if (this.disposed) {
            throw new Error('The editor is disposed');
        }
    }
}

export class FakeEditorEngine implements EditorEngine {
    readonly editors: FakeEditor[] = [];

    mount(element: HTMLElement, options: EditorOptions): FakeEditor {
        const editor = new FakeEditor(element, options);
        this.editors.push(editor);
        return editor;
    }

    /* The editor mounted last, which is the one a test of a single surface drives. */
    get last(): FakeEditor {
        const editor = this.editors.at(-1);
        if (!editor) {
            throw new Error('No editor was mounted');
        }
        return editor;
    }
}

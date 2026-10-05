import type {
    Editor,
    EditorAttributionHover,
    EditorAttributionMark,
    EditorBlock,
    EditorCodeBlockOptions,
    EditorLineHighlight,
    EditorChangeMark,
    EditorCodeVision,
    EditorClick,
    EditorClickHandler,
    EditorContextMenu,
    EditorContentChange,
    EditorEngine,
    EditorFindQuery,
    EditorFindState,
    EditorReplaceOptions,
    EditorGutterAction,
    EditorHighlight,
    EditorHover,
    EditorIndentation,
    EditorInlayHint,
    EditorKeyHandler,
    EditorMarker,
    EditorOptions,
    EditorPosition,
    EditorRemoteCursor,
    EditorRange,
    EditorReveal,
    EditorRect,
    EditorRunCommand,
    EditorSelectionRanges,
    EditorFoldHints,
    EditorFoldOutline,
    EditorFolds,
    EditorSemanticToken,
    EditorSmartKeys,
    EditorTextChange,
    EditorTrackedRange,
    EditorTheme,
    EditorWidget
} from './types.ts';
import { emit, type Listener, subscribe } from './listeners.ts';
import { changedSpan } from '@ruimte/smart-editor-core';
import { mapTrackedRange } from './tracked-range.ts';

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
        this.smartKeys = options.smartKeys ?? {};
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
        this.followTracked(span.start, span.end, span.text.length);
        const change: EditorTextChange = {
            source,
            changes: [{ range: { start: positionIn(before, span.start), end: positionIn(before, span.end) }, text: span.text }]
        };
        for (const listener of [...this.textChanges]) {
            listener(change);
        }
    }

    private readonly tracked = new Set<{ from: number; to: number; lost: boolean }>();

    /* The fake sees one change per edit, the stretch that differs, so a range it tracks is lost a little sooner than the real editor's. */
    private followTracked(from: number, to: number, insertedLength: number): void {
        for (const entry of this.tracked) {
            const mapped = mapTrackedRange(entry.from, entry.to, [{ from, to, insertedLength }]);
            if (mapped === null) {
                this.tracked.delete(entry);
                entry.lost = true;
            } else {
                Object.assign(entry, mapped);
            }
        }
    }

    trackRange(range: EditorRange): EditorTrackedRange {
        const entry = { from: this.offsetAt(range.start), to: this.offsetAt(range.end), lost: false };
        this.tracked.add(entry);
        return {
            get: () => (entry.lost ? null : { start: this.positionAt(entry.from), end: this.positionAt(entry.to) }),
            dispose: () => {
                entry.lost = true;
                this.tracked.delete(entry);
            }
        };
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

    /* How the client last asked the view to follow a jump. */
    lastReveal: EditorReveal | null = null;

    revealLine(line: number, reveal: EditorReveal = 'center'): void {
        this.revealedLine = line;
        this.lastReveal = reveal;
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
    replaceOptions: EditorReplaceOptions[] = [];
    /* What the client last asked to show under the match. */
    replacePreview: string | null = null;
    /* What the client asked to select all matches of, and how many it was told there were. */
    selectedMatches = 0;
    lastFindFromCursor: { query: EditorFindQuery; direction: 1 | -1 } | null = null;
    replacementsOfAll: string[] = [];

    replace(replacement: string, options: EditorReplaceOptions = {}): boolean {
        this.replacements.push(replacement);
        this.replaceOptions.push(options);
        return !this.readOnly && this.findState.count > 0;
    }

    replaceAll(replacement: string, options: EditorReplaceOptions = {}): number {
        this.replacementsOfAll.push(replacement);
        this.replaceOptions.push(options);
        return this.readOnly ? 0 : this.findState.count;
    }

    setReplacePreview(replacement: string | null): void {
        this.replacePreview = replacement;
    }

    selectFindMatches(): number {
        this.selectedMatches = this.findState.count;
        this.find(null);
        return this.selectedMatches;
    }

    findFromCursor(query: EditorFindQuery, direction: 1 | -1): boolean {
        this.lastFindFromCursor = { query, direction };
        return true;
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

    /* The tinted lines the client set last. */
    lineHighlights: readonly EditorLineHighlight[] = [];

    setLineHighlights(highlights: readonly EditorLineHighlight[]): void {
        this.lineHighlights = highlights;
    }

    /* What the client drew as code outside the document: the text and how, and into which element. */
    codeBlocks: { container: HTMLElement; text: string; options: EditorCodeBlockOptions }[] = [];

    renderCode(container: HTMLElement, text: string, options: EditorCodeBlockOptions = {}): void {
        this.codeBlocks.push({ container, text, options });
    }

    /* The cursors of agents the client set last. */
    remoteCursors: readonly EditorRemoteCursor[] = [];

    setRemoteCursors(cursors: readonly EditorRemoteCursor[]): void {
        this.remoteCursors = cursors;
    }

    /* What the client marked as written by an agent last. */
    attributionMarks: readonly EditorAttributionMark[] = [];
    private readonly attributionHovers = new Set<(hover: EditorAttributionHover | null) => void>();

    setAttributionMarks(marks: readonly EditorAttributionMark[]): void {
        this.attributionMarks = marks;
    }

    onAttributionHover(listener: (hover: EditorAttributionHover | null) => void): () => void {
        this.attributionHovers.add(listener);
        return () => {
            this.attributionHovers.delete(listener);
        };
    }

    /* The pointer on the bar of a mark, or leaving it. The rect is where `rectAt` puts the mark's first line unless given. */
    hoverAttribution(id: string | null, rect?: EditorRect): void {
        const mark = id === null ? undefined : this.attributionMarks.find((candidate) => candidate.id === id);
        const hover =
            mark === undefined
                ? null
                : { id: mark.id, rect: rect ?? this.rectAt({ line: mark.startLine - 1, character: 0 }) ?? { left: 0, top: 0, right: 0, bottom: 0 } };
        for (const listener of [...this.attributionHovers]) {
            listener(hover);
        }
    }

    /* What each owner put next to lines of the text last. */
    readonly widgetsByOwner = new Map<string, readonly EditorWidget[]>();

    /* The default owner's rows. */
    get widgets(): readonly EditorWidget[] {
        return this.widgetsByOwner.get('default') ?? [];
    }

    setWidgets(widgets: readonly EditorWidget[], owner = 'default'): void {
        if (widgets.length === 0) {
            this.widgetsByOwner.delete(owner);
        } else {
            this.widgetsByOwner.set(owner, widgets);
        }
    }

    /* The code vision rows the client set last. */
    codeVision: readonly EditorCodeVision[] = [];

    setCodeVision(rows: readonly EditorCodeVision[]): void {
        this.codeVision = rows;
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

    smartKeys: Partial<EditorSmartKeys>;

    guides = true;
    whitespace = false;
    rightMargin: number | null = null;

    setGuides(guides: boolean): void {
        this.guides = guides;
    }

    setWhitespace(whitespace: boolean): void {
        this.whitespace = whitespace;
    }

    setRightMargin(column: number | null): void {
        this.rightMargin = column;
    }

    foldOutline: EditorFoldOutline = 'hover';
    foldHints: EditorFoldHints | null = null;

    setFoldOutline(outline: EditorFoldOutline): void {
        this.foldOutline = outline;
    }

    setFoldHints(hints: EditorFoldHints | null): void {
        this.foldHints = hints;
    }

    setSmartKeys(keys: Partial<EditorSmartKeys>): void {
        this.smartKeys = keys;
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

    /* What the client drew as a link last. */
    link: EditorRange | null = null;

    setLink(range: EditorRange | null): void {
        this.link = range;
    }

    setHighlights(highlights: readonly EditorHighlight[]): void {
        this.highlights = highlights;
    }

    getCaret(): EditorPosition {
        return this.caret;
    }

    /* The folds the client asked to keep. */
    folds: EditorFolds = { collapsed: [], custom: [] };

    getFolds(): EditorFolds {
        return this.folds;
    }

    getScrollTop(): number {
        return this.scrollTop ?? 0;
    }

    /* The selection a person made; without one the caret. */
    selection: EditorRange | null = null;

    getSelection(): EditorRange {
        return this.selection ?? { start: this.caret, end: this.caret };
    }

    /* The other selections of the editor; the primary one is always last. */
    private otherSelections: EditorRange[] = [];

    /* The other carets of the editor, which a test sets. */
    get otherCarets(): EditorPosition[] {
        return this.otherSelections.map((range) => range.end);
    }

    set otherCarets(positions: EditorPosition[]) {
        this.otherSelections = positions.map((position) => ({ start: position, end: position }));
    }

    getSelections(): EditorRange[] {
        return [...this.otherSelections, this.getSelection()];
    }

    setSelections(ranges: readonly EditorRange[], reveal: EditorReveal = 'relative'): void {
        const last = ranges.at(-1);
        if (last === undefined) {
            return;
        }
        this.otherSelections = ranges.slice(0, -1).map((range) => ({ ...range }));
        this.setSelection(last, reveal);
    }

    getIndentation(): EditorIndentation {
        return this.indentation;
    }

    setCaret(position: EditorPosition, reveal: EditorReveal = 'relative'): void {
        this.lastReveal = reveal;
        this.caret = position;
        this.revealedLine = position.line + 1;
        this.moveCaret(position);
    }

    setSelection(range: EditorRange, reveal: EditorReveal = 'relative'): void {
        this.lastReveal = reveal;
        this.caret = range.end;
        this.selection = range;
        for (const listener of [...this.carets]) {
            listener(range.end);
        }
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

    /* What `getVisibleRange` answers; the whole text until a test scrolls. */
    visibleRange: EditorRange | null = null;

    getVisibleRange(): EditorRange {
        return this.visibleRange ?? { start: { line: 0, character: 0 }, end: this.positionAt(Number.MAX_SAFE_INTEGER) };
    }

    /* The editor scrolling, to a range of lines when a test says which. */
    scroll(range?: EditorRange): void {
        if (range !== undefined) {
            this.visibleRange = range;
        }
        emit(this.views);
    }

    /* What `setSelectionRanges` was last given. */
    selectionRanges: EditorSelectionRanges | null = null;

    setSelectionRanges(provider: EditorSelectionRanges | null): void {
        this.selectionRanges = provider;
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
        // The other carets follow the text as the real editor's do: one inside a replaced stretch ends behind what replaced it.
        const others = this.otherSelections.map((range) => ({ anchor: this.offsetAt(range.start), head: this.offsetAt(range.end) }));
        const follow = (offset: number): number => {
            let delta = 0;
            for (const edit of [...ordered].reverse()) {
                if (offset < edit.from) {
                    break;
                }
                if (offset < edit.to || (offset === edit.from && edit.from === edit.to)) {
                    return edit.from + delta + edit.text.length;
                }
                delta += edit.text.length - (edit.to - edit.from);
            }
            return offset + delta;
        };
        const moved = others.map((range) => ({ anchor: follow(range.anchor), head: follow(range.head) }));
        this.replaceText(text, 'command');
        this.otherSelections = moved.map((range) => ({
            start: positionIn(text, Math.min(range.anchor, range.head)),
            end: positionIn(text, Math.max(range.anchor, range.head))
        }));
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

    /* The commands run, in order; the fake has no commands of its own to carry out. */
    readonly commands: EditorRunCommand[] = [];

    runCommand(command: EditorRunCommand): boolean {
        this.commands.push(command);
        return false;
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
        this.attributionHovers.clear();
        this.views.clear();
        this.keys.clear();
        this.saves.clear();
        this.blurs.clear();
        this.finds.clear();
        this.scopes.clear();
        this.tracked.clear();
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

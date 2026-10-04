import { type DocumentModel, type EditorSnapshot, type FoldingRange, scanBrackets, type BracketIndex } from '@ruimte/smart-editor-core';
import { FindController } from './find.ts';
import { type BlockWidget, EditorLayout, type FoldState, type Inlay, type LayoutRect, type LayoutRow, RIGHT_PADDING, type TextRow } from './layout.ts';
import { createMetrics, type EditorFont, readEditorFont } from './metrics.ts';
import { mapOffset } from './offsets.ts';
import { Outline, scopeChain, type StickyPlacement, stickyCover, stickyPlacements, structuralEntries } from './outline.ts';
import { type OverviewSpan, overviewTicks, paintOverview } from './overview.ts';
import { paintCarets, paintGutter, paintOverlays, paintSticky, RowPainter, type StickyEntry } from './paint.ts';
import { TokenCache } from './tokens.ts';
import type { EditorBlock, EditorChangeKind, EditorChangeMark, EditorFindQuery, EditorFindState, LineTokenizer } from './types.ts';

export interface ViewSettings {
    language: string | undefined;
    tabSize: number;
    insertSpaces: boolean;
    readOnly: boolean;
    readOnlyReason: string | undefined;
    wrap: boolean;
}

/* The lines past the visible ones that are colored ahead of the scroll, and how long one slice of that work may take. */
const COLOR_MARGIN = 80;
const COLOR_SLICE_MS = 8;
const FIRST_PAINT_MS = 12;
const FOLD_DELAY_MS = 300;
const NOTICE_MS = 3000;
const DEFAULT_HEIGHT = 400;
const DEFAULT_WIDTH = 800;
const FOLD_LIMIT = 2_000_000;
const MIN_GUTTER_WIDTH = 64;
/* The caret stays solid this long after it moved, so holding an arrow key does not blink it between steps. */
const CARET_SOLID_MS = 500;
const STICKY_MAX_LINES = 5;
/* A view shows at most this share of its rows as sticky headers, so a small node keeps most of its text. */
const STICKY_ROW_SHARE = 4;

/* A line that starts several ranges folds as the outermost one, which the sort puts first. */
export function outermostPerLine(ranges: readonly FoldingRange[]): FoldingRange[] {
    return ranges.filter((range, index) => index === 0 || range.startLine !== ranges[index - 1]!.startLine);
}

/* A mark the host asked for, such as every use of the name under the caret. */
export interface Occurrence {
    from: number;
    to: number;
}

/*
 * What is drawn and where: the DOM of the editor, the layout under it, and the colors of its lines.
 * It never decides what a key does; `InputController` does, and asks this for where things are.
 */
export class EditorView {
    readonly root: HTMLElement;
    readonly viewport: HTMLElement;
    readonly input: HTMLTextAreaElement;
    readonly layout: EditorLayout;
    readonly find: FindController;
    readonly tokens: TokenCache;
    private readonly content: HTMLElement;
    private readonly gutter: HTMLElement;
    private readonly gutterLines: HTMLElement;
    private readonly overlays: HTMLElement;
    private readonly carets: HTMLElement;
    private readonly notice: HTMLElement;
    private readonly sticky: HTMLElement;
    private readonly overview: HTMLElement;
    private readonly painter: RowPainter;
    private readonly document: Document;
    private readonly resizeObserver: ResizeObserver | undefined;
    private readonly blockObserver: ResizeObserver | undefined;
    private readonly subscription: { dispose(): void };
    private readonly findListeners = new Set<(state: EditorFindState) => void>();
    private readonly scopeListeners = new Set<(scope: readonly EditorBlock[]) => void>();
    private readonly outline = new Outline();
    private stickyEntries: StickyEntry[] = [];
    private scopeKey = '';
    private changeMarks: { kind: EditorChangeKind; from: number; to: number }[] = [];
    private changeVersion = 0;
    private overviewKey = '';
    private gutterWidth = MIN_GUTTER_WIDTH;
    private frame: number | undefined;
    private caretTimer: ReturnType<typeof setTimeout> | undefined;
    private caretKey = '';
    private renderedScroll = { top: -1, left: -1 };
    private font: EditorFont;
    private layoutVersion = 0;
    private revision: number;
    private rendering = false;
    private disposed = false;
    private inlays: Inlay[] = [];
    private blocks: BlockWidget[] = [];
    private occurrences: Occurrence[] = [];
    private composition: string | undefined;
    private foldRanges: FoldingRange[] = [];
    private collapsed = new Set<number>();
    private foldTimer: ReturnType<typeof setTimeout> | undefined;
    private colorTimer: ReturnType<typeof setTimeout> | undefined;
    private noticeTimer: ReturnType<typeof setTimeout> | undefined;
    private bracketCache: { revision: number; language: string | undefined; index: BracketIndex } | undefined;
    private wrapWidth: number | null = null;
    /* The offset a click past the end of a wrapped visual line chose, which its caret is drawn at the end of that line for. */
    private rowEndCaret: number | null = null;
    /* The first line on screen as an offset and how far into its row the scroll is, so an edit above it does not move what is read. */
    private topAnchor: { offset: number; delta: number } | undefined;

    readonly model: DocumentModel;
    readonly settings: ViewSettings;

    constructor(container: HTMLElement, model: DocumentModel, settings: ViewSettings) {
        this.model = model;
        this.settings = settings;
        const document = container.ownerDocument;
        this.document = document;
        const make = <Tag extends keyof HTMLElementTagNameMap>(tag: Tag, className: string): HTMLElementTagNameMap[Tag] => {
            const element = document.createElement(tag);
            element.className = className;
            return element;
        };
        this.root = make('div', 'se-editor');
        this.gutter = make('div', 'se-gutter');
        this.gutterLines = make('div', 'se-gutter-lines');
        this.gutter.append(this.gutterLines);
        this.viewport = make('div', 'se-viewport');
        this.content = make('div', 'se-content');
        this.overlays = make('div', 'se-overlays');
        const code = make('div', 'se-code');
        this.carets = make('div', 'se-carets');
        for (const layer of [this.overlays, this.carets]) {
            layer.setAttribute('aria-hidden', 'true');
        }
        code.setAttribute('aria-hidden', 'true');
        this.content.append(this.overlays, code, this.carets);
        // The gutter is in the scroller with the text and sticks to its left, so the browser moves both in the same frame.
        const scroller = make('div', 'se-scroller');
        scroller.append(this.gutter, this.content);
        this.viewport.append(scroller);
        this.input = make('textarea', 'se-input');
        this.input.wrap = 'off';
        this.input.spellcheck = false;
        for (const name of ['autocapitalize', 'autocomplete', 'autocorrect']) {
            this.input.setAttribute(name, 'off');
        }
        this.input.setAttribute('aria-multiline', 'true');
        this.input.setAttribute('aria-label', 'Code editor');
        this.sticky = make('div', 'se-sticky');
        this.sticky.setAttribute('aria-hidden', 'true');
        this.sticky.hidden = true;
        this.overview = make('div', 'se-overview');
        this.overview.setAttribute('aria-hidden', 'true');
        this.notice = make('div', 'se-notice');
        this.notice.setAttribute('role', 'status');
        this.notice.hidden = true;
        this.root.append(this.viewport, this.sticky, this.overview, this.input, this.notice);
        container.append(this.root);

        this.font = readEditorFont(this.root);
        this.layout = new EditorLayout(model, createMetrics(this.font, settings.tabSize, document));
        this.find = new FindController(model);
        this.tokens = new TokenCache({ getLineCount: () => model.getLineCount(), getLineText: (line) => model.getLine(line).text });
        const ResizeObserverClass = document.defaultView?.ResizeObserver;
        this.blockObserver = ResizeObserverClass
            ? new ResizeObserverClass((entries) => {
                  let changed = false;
                  this.anchorScroll(() => {
                      for (const entry of entries) {
                          const element = entry.target as HTMLElement;
                          changed = this.layout.setMeasuredHeight(element.dataset.rowKey!, element.getBoundingClientRect().height) || changed;
                      }
                  });
                  if (changed) {
                      this.render();
                  }
              })
            : undefined;
        this.resizeObserver = ResizeObserverClass ? new ResizeObserverClass(() => this.requestRender()) : undefined;
        this.resizeObserver?.observe(this.viewport);
        this.painter = new RowPainter(code, this.layout, this.blockObserver);
        this.revision = model.getRevision();
        this.subscription = model.subscribe((snapshot) => this.modelChanged(snapshot));
        this.applySettings();
        this.scheduleFolds();
    }

    /* Settings that are read off the page or off `settings` are applied again: after a change to either. */
    applySettings(): void {
        this.input.readOnly = this.settings.readOnly;
        this.root.dataset.readonly = String(this.settings.readOnly);
        this.root.dataset.wrap = String(this.settings.wrap);
        this.layoutVersion++;
        this.layout.configure({ metrics: createMetrics(this.font, this.settings.tabSize, this.document) });
        this.render();
    }

    refreshFont(): void {
        this.font = readEditorFont(this.root);
        this.applySettings();
    }

    setTokenizer(tokenizer: LineTokenizer | null): void {
        this.tokens.setTokenizer(tokenizer);
        this.colorAhead();
        this.render();
    }

    setInlays(inlays: readonly Inlay[]): void {
        this.inlays = inlays.map((inlay) => ({ ...inlay, text: inlay.text.replace(/[\r\n]/g, ' ') }));
        this.configureText();
    }

    setBlockWidgets(blocks: readonly BlockWidget[]): void {
        this.blocks = [...blocks];
        this.anchorScroll(() => this.layout.configure({ blocks: this.blocks }));
        this.render();
    }

    setOccurrences(occurrences: readonly Occurrence[]): void {
        this.occurrences = [...occurrences];
        this.render();
    }

    /* What an input method has composed so far, drawn at the caret and not yet in the document. */
    setComposition(text: string | undefined): void {
        this.composition = text;
        this.configureText();
    }

    notify(message: string): void {
        this.notice.textContent = message;
        this.notice.hidden = false;
        clearTimeout(this.noticeTimer);
        this.noticeTimer = setTimeout(() => {
            this.notice.hidden = true;
        }, NOTICE_MS);
    }

    get gutterElement(): HTMLElement {
        return this.gutter;
    }

    get stickyElement(): HTMLElement {
        return this.sticky;
    }

    focus(): void {
        this.input.focus({ preventScroll: true });
    }

    get focused(): boolean {
        return this.document.activeElement === this.input;
    }

    private get viewportHeight(): number {
        return this.viewport.clientHeight || DEFAULT_HEIGHT;
    }

    /* The width the text has, which is what the viewport has left of the gutter. */
    private get viewportWidth(): number {
        return Math.max(1, (this.viewport.clientWidth || DEFAULT_WIDTH) - this.gutterWidth);
    }

    private modelChanged(snapshot: EditorSnapshot): void {
        if (snapshot.revision !== this.revision) {
            this.revision = snapshot.revision;
            this.rowEndCaret = null;
            const batches = snapshot.changes ?? [];
            for (const changes of batches) {
                this.inlays = this.inlays.map((inlay) => ({ ...inlay, at: mapOffset(inlay.at, changes) }));
                this.blocks = this.blocks.map((block) => ({ ...block, at: mapOffset(block.at, changes) }));
                this.collapsed = new Set([...this.collapsed].map((anchor) => mapOffset(anchor, changes)));
                this.changeMarks = this.changeMarks.map((mark) => ({ ...mark, from: mapOffset(mark.from, changes), to: mapOffset(mark.to, changes) }));
            }
            const anchor = this.topAnchor;
            this.occurrences = [];
            this.outline.edited(batches);
            this.changeVersion++;
            this.tokens.edited(batches, (offset) => this.model.positionAt(offset).line);
            this.layout.configure({ textChanged: true, inlays: this.displayedInlays(), blocks: this.blocks, folds: this.foldStates() });
            if (anchor && this.viewport.scrollTop > 0) {
                let offset = anchor.offset;
                for (const changes of batches) {
                    offset = mapOffset(offset, changes);
                }
                this.viewport.scrollTop = Math.max(0, this.layout.rowForLine(this.model.positionAt(offset).line).top + anchor.delta);
            }
            this.find.refresh();
            this.announceFind();
            this.scheduleFolds();
            this.colorAhead(true);
        }
        if (this.rowEndCaret !== null && this.model.getSelections()[0]!.head !== this.rowEndCaret) {
            this.rowEndCaret = null;
        }
        this.requestRender();
    }

    private displayedInlays(): Inlay[] {
        return this.composition ? [...this.inlays, { id: '__composition', at: this.model.getSelections()[0]!.head, text: this.composition }] : this.inlays;
    }

    private configureText(): void {
        this.layoutVersion++;
        this.layout.configure({ inlays: this.displayedInlays() });
        this.render();
    }

    private foldStates(): FoldState[] {
        return this.foldRanges.map((range) => ({
            startLine: range.startLine,
            endLine: range.endLine,
            collapsed: this.collapsed.has(range.from),
            closer: this.collapsed.has(range.from) ? this.closerOf(range) : undefined
        }));
    }

    /* The folds of the document, a moment after the last edit since they read all of it. */
    private scheduleFolds(): void {
        clearTimeout(this.foldTimer);
        this.foldTimer = setTimeout(() => this.refreshFolds(), FOLD_DELAY_MS);
    }

    /* Reads the folds off the document now, which otherwise waits for a pause in editing. */
    refreshFolds(): void {
        if (this.disposed) {
            return;
        }
        const ranges =
            this.model.getLength() > FOLD_LIMIT
                ? []
                : this.model.getFoldingRanges({ indentation: /^(python|py|yaml|yml)$/.test(this.settings.language ?? ''), tabSize: this.settings.tabSize });
        this.foldRanges = outermostPerLine(ranges);
        this.outline.setStructure(
            structuralEntries(
                ranges,
                this.model,
                (from, to) => this.model.slice(from, to),
                (offset) => this.brackets().pairs.get(offset)
            )
        );
        const anchors = new Set(this.foldRanges.map((range) => range.from));
        this.collapsed = new Set([...this.collapsed].filter((anchor) => anchors.has(anchor)));
        this.anchorScroll(() => this.layout.configure({ folds: this.foldStates() }));
        this.moveHiddenCarets();
        this.render();
    }

    /* Where what stays visible of a collapsed range starts on its last line: its closer, with any closers right before it, so `])` is kept whole. */
    private closerOf(range: FoldingRange): number | undefined {
        if (range.kind === 'comment') {
            return range.to - 2;
        }
        if (range.kind !== 'bracket') {
            return undefined;
        }
        const lineStart = this.model.getLine(range.endLine).start;
        let start = range.to - 1;
        while (start > lineStart && /[)\]}]/.test(this.model.slice(start - 1, start))) {
            start--;
        }
        return start;
    }

    /* The range a collapsed or collapsible line starts, outermost first. */
    private foldAt(line: number): FoldingRange | undefined {
        return this.foldRanges.find((range) => range.startLine === line);
    }

    toggleFold(line: number, collapse?: boolean): boolean {
        const range = this.foldAt(line);
        if (!range) {
            return false;
        }
        const next = collapse ?? !this.collapsed.has(range.from);
        if (next) {
            this.collapsed.add(range.from);
        } else {
            this.collapsed.delete(range.from);
        }
        this.refoldLayout();
        return true;
    }

    /* Folds or unfolds every range, or only the ones around the caret. */
    foldAround(collapse: boolean, all: boolean): void {
        const line = this.model.positionAt(this.model.getSelections()[0]!.head).line;
        const targets = this.foldRanges.filter((range) => all || (range.startLine <= line && range.endLine >= line));
        const chosen = all ? targets : collapse ? targets.slice(-1) : targets.filter((range) => this.collapsed.has(range.from)).slice(0, 1);
        for (const range of chosen) {
            if (collapse) {
                this.collapsed.add(range.from);
            } else {
                this.collapsed.delete(range.from);
            }
        }
        this.refoldLayout();
    }

    private refoldLayout(): void {
        this.anchorScroll(() => this.layout.configure({ folds: this.foldStates() }));
        this.moveHiddenCarets();
        this.render();
    }

    /* A caret in a line a fold hides would be typing where nobody can see. */
    private moveHiddenCarets(): void {
        const visible = (offset: number): number => {
            const line = this.model.positionAt(offset).line;
            if (!this.layout.isHidden(line)) {
                return offset;
            }
            return this.model.getLine(this.layout.rowForLine(line).line).end;
        };
        const selections = this.model.getSelections();
        const moved = selections.map((selection) => ({ anchor: visible(selection.anchor), head: visible(selection.head) }));
        if (moved.some((selection, index) => selection.anchor !== selections[index]!.anchor || selection.head !== selections[index]!.head)) {
            this.model.setSelections(moved);
        }
    }

    /* Opens the folds that hide an offset, so a caret or a search result is where it can be seen. */
    ensureVisible(offset: number): void {
        const line = this.model.positionAt(offset).line;
        if (!this.layout.isHidden(line)) {
            return;
        }
        for (const range of this.foldRanges) {
            if (range.startLine < line && range.endLine >= line) {
                this.collapsed.delete(range.from);
            }
        }
        this.anchorScroll(() => this.layout.configure({ folds: this.foldStates() }));
    }

    /* Keeps the first row on screen where it is while the rows above it change height. */
    private anchorScroll(action: () => void): void {
        const top = this.viewport.scrollTop;
        if (top <= 0) {
            action();
            return;
        }
        const anchor = this.layout.rowAt(top);
        const offset = top - anchor.top;
        action();
        const next = this.layout.rows.find((row) => row.key === anchor.key);
        if (next) {
            this.viewport.scrollTop = Math.max(0, next.top + offset);
        }
    }

    private syncWrap(): void {
        const width =
            this.settings.wrap && this.viewport.clientWidth > 0 ? Math.max(this.layout.metrics.charWidth * 8, this.viewportWidth - RIGHT_PADDING) : null;
        if (width !== this.wrapWidth) {
            this.wrapWidth = width;
            this.layoutVersion++;
            this.anchorScroll(() => this.layout.configure({ wrapWidth: width }));
        }
    }

    private bracketAt(from: number, to: number, head: number): number | undefined {
        if (to - from > 1) {
            return undefined;
        }
        const candidates = from !== to ? [from] : [head, head - 1];
        return candidates.find((at) => at >= 0 && /[()[\]{}]/.test(this.model.slice(at, at + 1)));
    }

    private brackets(): BracketIndex {
        if (this.bracketCache?.revision !== this.revision || this.bracketCache.language !== this.settings.language) {
            this.bracketCache = {
                revision: this.revision,
                language: this.settings.language,
                index: scanBrackets(this.model.getText(), this.settings.language)
            };
        }
        return this.bracketCache.index;
    }

    /* The offset a bracket at the caret pairs with, if it is one. */
    matchingBracket(selection: { anchor: number; head: number }): { at: number; mate: number | undefined } | null {
        const at = this.bracketAt(Math.min(selection.anchor, selection.head), Math.max(selection.anchor, selection.head), selection.head);
        return at === undefined ? null : { at, mate: this.brackets().pairs.get(at) };
    }

    unmatchedBracket(at: number): boolean {
        return this.brackets().unmatched.has(at);
    }

    /* A point of the screen in the coordinates of the content, undoing the scale a canvas puts on a node. */
    contentPoint(clientX: number, clientY: number): { x: number; y: number } {
        const rect = this.viewport.getBoundingClientRect?.();
        if (!rect) {
            return { x: clientX - this.gutterWidth + this.viewport.scrollLeft, y: clientY + this.viewport.scrollTop };
        }
        const scaleX = this.viewport.offsetWidth > 0 ? rect.width / this.viewport.offsetWidth : 1;
        const scaleY = this.viewport.offsetHeight > 0 ? rect.height / this.viewport.offsetHeight : 1;
        return { x: (clientX - rect.left) / scaleX - this.gutterWidth + this.viewport.scrollLeft, y: (clientY - rect.top) / scaleY + this.viewport.scrollTop };
    }

    offsetAtPoint(clientX: number, clientY: number): number {
        const point = this.contentPoint(clientX, clientY);
        const hit = this.layout.hitTestRow(point.x, point.y);
        this.rowEndCaret = hit.rowEnd ? hit.offset : null;
        return hit.offset;
    }

    private caretOf(head: number): LayoutRect {
        return this.layout.caret(head, 'after', head === this.rowEndCaret);
    }

    /* Scrolls the least that brings the offset into view; `center` puts its line in the middle instead. */
    revealOffset(offset: number, center = false): void {
        this.ensureVisible(offset);
        this.syncWrap();
        const caret = this.layout.caret(offset);
        const height = this.viewportHeight;
        const width = this.viewportWidth;
        const cover = this.stickyHeightAt(this.viewport.scrollTop);
        this.content.style.height = `${this.layout.height}px`;
        this.content.style.width = `${Math.max(this.layout.width, width)}px`;
        if (center) {
            this.viewport.scrollTop = Math.max(0, caret.y - (height - caret.height) / 2);
        } else if (caret.y < this.viewport.scrollTop + cover) {
            // The headers pinned at the top would cover it, so it stops under them.
            this.viewport.scrollTop = Math.max(0, caret.y - this.stickyHeightAt(Math.max(0, caret.y - cover)));
        } else if (caret.y + caret.height > this.viewport.scrollTop + height) {
            this.viewport.scrollTop = caret.y + caret.height - height;
        }
        if (!this.settings.wrap) {
            if (caret.x < this.viewport.scrollLeft + 8) {
                this.viewport.scrollLeft = Math.max(0, caret.x - 8);
            } else if (caret.x > this.viewport.scrollLeft + width - 24) {
                this.viewport.scrollLeft = caret.x - width + 24;
            }
        }
        this.requestRender();
    }

    revealCaret(): void {
        this.revealOffset(this.model.getSelections()[0]!.head);
    }

    setFind(query: EditorFindQuery | null, reveal: boolean): void {
        this.find.set(query);
        this.announceFind();
        if (reveal) {
            this.revealFind();
        }
        this.render();
    }

    stepFind(direction: 1 | -1): void {
        this.find.step(direction);
        this.announceFind();
        this.revealFind();
        this.render();
    }

    onFind(listener: (state: EditorFindState) => void): () => void {
        this.findListeners.add(listener);
        return () => {
            this.findListeners.delete(listener);
        };
    }

    private announceFind(): void {
        for (const listener of [...this.findListeners]) {
            listener(this.find.state);
        }
    }

    revealFind(): void {
        const mark = this.find.currentMark;
        if (!mark) {
            return;
        }
        this.ensureVisible(mark.from);
        const caret = this.layout.caret(mark.from);
        const top = this.viewport.scrollTop;
        if (caret.y < top || caret.y + caret.height > top + this.viewportHeight) {
            this.viewport.scrollTop = Math.max(0, caret.y - this.viewportHeight / 2);
        }
    }

    /* Colors the lines on and just past the screen, a slice at a time so typing never waits on a grammar. */
    colorAhead(immediate = false): void {
        if (this.disposed || !this.tokens.ready) {
            return;
        }
        clearTimeout(this.colorTimer);
        const target = this.layout.rowAt(this.viewport.scrollTop + this.viewportHeight).line + COLOR_MARGIN;
        if (this.tokens.covers(target)) {
            return;
        }
        this.colorTimer = setTimeout(
            () => {
                const changed = this.tokens.advance(target, COLOR_SLICE_MS);
                if (changed) {
                    this.render();
                }
                this.colorAhead();
            },
            immediate ? 0 : 1
        );
    }

    /* The gutter is as wide as its widest number needs, which only changes when the line count gains a digit. */
    private syncGutter(): void {
        const digits = String(this.model.getLineCount()).length;
        const width = Math.max(MIN_GUTTER_WIDTH, Math.ceil(digits * this.layout.metrics.charWidth) + 40);
        if (width !== this.gutterWidth) {
            this.gutterWidth = width;
            this.root.style.setProperty('--se-gutter-width', `${width}px`);
        }
    }

    /* A render in the next frame, so a key that moves the caret and scrolls, and the scroll event after it, paint once together. */
    requestRender(): void {
        if (this.disposed || this.frame !== undefined) {
            return;
        }
        const view = this.document.defaultView;
        if (!view?.requestAnimationFrame) {
            this.render();
            return;
        }
        this.frame = view.requestAnimationFrame(() => {
            this.frame = undefined;
            this.render();
        });
    }

    /* The viewport scrolled, by the wheel, a scroll bar or the browser; what is drawn follows unless it already did. */
    scrolled(): void {
        if (this.viewport.scrollTop !== this.renderedScroll.top || this.viewport.scrollLeft !== this.renderedScroll.left) {
            this.requestRender();
        }
    }

    render(): void {
        if (this.disposed || this.rendering) {
            return;
        }
        this.rendering = true;
        try {
            this.syncGutter();
            this.syncWrap();
            let rows = this.layout.visibleRows(this.viewport.scrollTop, this.viewportHeight);
            if (this.layout.syncRows(rows)) {
                rows = this.layout.visibleRows(this.viewport.scrollTop, this.viewportHeight);
            }
            const lastLine = rows.at(-1)?.line ?? 0;
            const firstRow = this.layout.rowAt(this.viewport.scrollTop);
            this.topAnchor = { offset: this.model.getLine(firstRow.line).start, delta: this.viewport.scrollTop - firstRow.top };
            if (lastLine - this.tokens.colored <= COLOR_MARGIN * 4) {
                this.tokens.advance(lastLine, FIRST_PAINT_MS);
            }
            const paint = {
                layoutVersion: this.layoutVersion,
                tokensOf: (line: number) => this.tokens.tokensOf(line),
                viewportWidth: this.viewportWidth - RIGHT_PADDING,
                onUnfold: (line: number) => this.toggleFold(line, false)
            };
            if (this.painter.paint(rows, paint)) {
                rows = this.layout.visibleRows(this.viewport.scrollTop, this.viewportHeight);
                this.painter.paint(rows, paint);
            }
            this.content.style.height = `${this.layout.height}px`;
            this.content.style.width = `${Math.max(this.layout.width, this.viewportWidth)}px`;
            this.renderedScroll = { top: this.viewport.scrollTop, left: this.viewport.scrollLeft };
            this.paintDecorations(rows);
            this.paintSticky();
            this.paintOverview();
            this.announceScope();
            this.colorAhead();
        } finally {
            this.rendering = false;
        }
    }

    private paintDecorations(rows: readonly LayoutRow[]): void {
        const selections = this.model.getSelections();
        const primary = selections[0]!;
        const focused = this.focused;
        const foldable = new Map<number, boolean>();
        for (const range of this.foldRanges) {
            if (!foldable.has(range.startLine)) {
                foldable.set(range.startLine, this.collapsed.has(range.from));
            }
        }
        paintGutter(this.gutterLines, this.layout, rows, {
            changes: this.changedLines(rows),
            activeLines: new Set(selections.map((selection) => this.model.positionAt(selection.head).line)),
            foldable
        });
        const marks: { className: string; rects: LayoutRect[] }[] = [];
        const row = this.layout.rowForLine(this.model.positionAt(primary.head).line);
        const currentLine =
            primary.anchor === primary.head && row.kind === 'text'
                ? { x: 0, y: row.top, width: Math.max(this.layout.width, this.viewportWidth), height: row.height }
                : null;
        marks.push({ className: 'se-occurrence', rects: this.occurrences.flatMap((mark) => this.layout.rectangles(mark.from, mark.to, rows)) });
        const current = this.find.currentMark;
        const textRows = rows.filter((candidate) => candidate.kind === 'text');
        const visibleFrom = textRows.length > 0 ? this.model.getLine(textRows[0]!.line).start : 0;
        const visibleTo = textRows.length > 0 ? this.model.getLine(textRows.at(-1)!.line).next : 0;
        for (const mark of this.find.matches) {
            if (mark.to > mark.from && mark.to >= visibleFrom && mark.from <= visibleTo) {
                marks.push({ className: mark === current ? 'se-find-current' : 'se-find-match', rects: this.layout.rectangles(mark.from, mark.to, rows) });
            }
        }
        const seen = new Set<number>();
        for (const selection of selections) {
            const bracket = this.matchingBracket(selection);
            if (!bracket) {
                continue;
            }
            if (bracket.mate === undefined) {
                if (this.unmatchedBracket(bracket.at)) {
                    marks.push({ className: 'se-bracket-unmatched', rects: this.layout.rectangles(bracket.at, bracket.at + 1, rows) });
                }
                continue;
            }
            for (const offset of [bracket.at, bracket.mate]) {
                if (!seen.has(offset)) {
                    seen.add(offset);
                    marks.push({ className: 'se-bracket-match', rects: this.layout.rectangles(offset, offset + 1, rows) });
                }
            }
        }
        const selected = selections.flatMap((selection) =>
            selection.anchor === selection.head
                ? []
                : this.layout.rectangles(Math.min(selection.anchor, selection.head), Math.max(selection.anchor, selection.head), rows)
        );
        paintOverlays(this.overlays, { currentLine, selections: selected, focused, marks });
        const top = this.viewport.scrollTop;
        const caretRects = focused
            ? selections
                  .map((selection) => this.caretOf(selection.head))
                  .filter((rect) => rect.y + rect.height >= top - rect.height && rect.y <= top + this.viewportHeight)
            : [];
        const caretKey = caretRects.map((rect) => `${rect.x},${rect.y}`).join(' ');
        if (caretKey !== this.caretKey) {
            this.caretKey = caretKey;
            this.carets.dataset.moving = 'true';
            clearTimeout(this.caretTimer);
            this.caretTimer = setTimeout(() => delete this.carets.dataset.moving, CARET_SOLID_MS);
        }
        paintCarets(this.carets, caretRects);
        const caret = this.caretOf(primary.head);
        this.input.style.left = `${this.gutterWidth + Math.max(0, Math.min(this.viewportWidth - 2, caret.x - this.viewport.scrollLeft))}px`;
        this.input.style.top = `${Math.max(0, Math.min(this.viewportHeight - this.layout.metrics.lineHeight, caret.y - top))}px`;
        this.input.style.height = `${this.layout.metrics.lineHeight}px`;
        this.root.dataset.carets = String(selections.length);
    }

    /* The lines the host marked, which stay on their lines through edits until it marks them again. */
    setChangeMarks(marks: readonly EditorChangeMark[]): void {
        const last = this.model.getLineCount();
        const clamp = (line: number): number => Math.min(last, Math.max(1, Math.trunc(line) || 1)) - 1;
        this.changeMarks = marks.map((mark) => {
            const from = this.model.getLine(clamp(mark.startLine)).start;
            return { kind: mark.kind, from, to: mark.kind === 'deleted' ? from : this.model.getLine(Math.max(clamp(mark.startLine), clamp(mark.endLine))).end };
        });
        this.changeVersion++;
        this.render();
    }

    private markedLines(mark: { kind: EditorChangeKind; from: number; to: number }): { start: number; end: number } {
        const start = this.model.positionAt(mark.from).line;
        return { start, end: mark.kind === 'deleted' ? start : this.model.positionAt(Math.max(mark.from, mark.to)).line };
    }

    /* How each line on screen differs, a removal never covering a line that was added or changed. */
    private changedLines(rows: readonly LayoutRow[]): Map<number, EditorChangeKind> {
        const lines = new Map<number, EditorChangeKind>();
        const first = rows[0]?.line ?? 0;
        const lastRow = rows.at(-1);
        const last = lastRow?.kind === 'text' ? lastRow.lastLine : (lastRow?.line ?? 0);
        for (const mark of this.changeMarks) {
            const { start, end } = this.markedLines(mark);
            for (let line = Math.max(start, first); line <= Math.min(end, last); line++) {
                if (mark.kind !== 'deleted' || !lines.has(line)) {
                    lines.set(line, mark.kind);
                }
            }
        }
        return lines;
    }

    /* The find matches and the changes as ticks in the scroll track, redrawn when what they stand on changes. */
    private paintOverview(): void {
        const trackHeight = this.viewportHeight;
        const matches = this.find.matches;
        const current = this.find.current;
        const key = `${this.revision}|${this.changeVersion}|${this.layout.height}|${trackHeight}|${matches.length}|${current}|${matches[0]?.from}|${matches.at(-1)?.from}`;
        if (key === this.overviewKey) {
            return;
        }
        this.overviewKey = key;
        const spans: OverviewSpan[] = [];
        const rowTop = (line: number): number => this.layout.rowForLine(line).top;
        const rowBottom = (line: number): number => {
            const row = this.layout.rowForLine(line);
            return row.top + row.height;
        };
        for (const mark of this.changeMarks) {
            const { start, end } = this.markedLines(mark);
            spans.push({ kind: mark.kind, top: rowTop(start), bottom: mark.kind === 'deleted' ? rowTop(start) : rowBottom(end) });
        }
        matches.forEach((match, index) => {
            const line = this.model.positionAt(match.from).line;
            spans.push({ kind: index === current ? 'find-current' : 'find', top: rowTop(line), bottom: rowBottom(line) });
        });
        paintOverview(this.overview, overviewTicks(spans, this.layout.height, trackHeight));
    }

    /* The blocks sticky scroll and the breadcrumb go by; null goes back to the editor's own reading. */
    setBlocks(blocks: readonly EditorBlock[] | null): void {
        this.outline.setProvided(blocks, this.model);
        this.render();
    }

    onScope(listener: (scope: readonly EditorBlock[]) => void): () => void {
        this.scopeListeners.add(listener);
        return () => {
            this.scopeListeners.delete(listener);
        };
    }

    private announceScope(): void {
        const line = this.model.positionAt(this.model.getSelections()[0]!.head).line;
        const scope = scopeChain(this.outline.blocks(this.model), line).map((block): EditorBlock => ({
            startLine: block.startLine + 1,
            endLine: block.endLine + 1,
            name: block.name!,
            ...(block.kind === undefined ? {} : { kind: block.kind })
        }));
        const key = scope.map((block) => `${block.startLine}:${block.endLine}:${block.name}:${block.kind ?? ''}`).join('|');
        if (key === this.scopeKey) {
            return;
        }
        this.scopeKey = key;
        for (const listener of [...this.scopeListeners]) {
            listener(scope);
        }
    }

    private stickyLimit(): number {
        return Math.min(STICKY_MAX_LINES, Math.floor(this.viewportHeight / this.layout.metrics.lineHeight / STICKY_ROW_SHARE));
    }

    private stickyAt(scrollTop: number): StickyPlacement[] {
        const { layout } = this;
        const bottomOf = (line: number): number => {
            const row = layout.rowForLine(line);
            return row.top + row.height;
        };
        return stickyPlacements(this.outline.blocks(this.model), scrollTop, layout.metrics.lineHeight, this.stickyLimit(), {
            top: (line) => layout.rowForLine(line).top,
            bottom: bottomOf,
            startsRow: (line) => {
                const row = layout.rowForLine(line);
                return row.kind === 'text' && row.line === line;
            }
        });
    }

    private stickyHeightAt(scrollTop: number): number {
        return scrollTop <= 0 ? 0 : stickyCover(this.stickyAt(scrollTop), this.layout.metrics.lineHeight);
    }

    /* Pins the headers of the blocks that have scrolled out of sight above the first visible line, and pushes the last one out as its block ends. */
    private paintSticky(): void {
        const lineHeight = this.layout.metrics.lineHeight;
        const placements = this.viewport.scrollTop <= 0 ? [] : this.stickyAt(this.viewport.scrollTop);
        const entries = placements.map((placement): StickyEntry => {
            const row = this.layout.rowForLine(placement.block.startLine) as TextRow;
            return { line: placement.block.startLine, geometry: this.layout.geometry(row), tokens: this.tokens.tokensOf(placement.block.startLine) };
        });
        const changed =
            entries.length !== this.stickyEntries.length ||
            entries.some((entry, index) => {
                const before = this.stickyEntries[index]!;
                return entry.line !== before.line || entry.geometry !== before.geometry || entry.tokens !== before.tokens;
            });
        this.sticky.hidden = entries.length === 0;
        this.sticky.style.setProperty('--se-scroll-left', `${this.viewport.scrollLeft}px`);
        this.sticky.style.setProperty('--se-scrollbar', `${Math.max(0, this.viewport.offsetWidth - this.viewport.clientWidth)}px`);
        if (changed) {
            this.stickyEntries = entries;
            paintSticky(this.sticky, entries, lineHeight);
        }
        this.sticky.style.height = `${stickyCover(placements, lineHeight)}px`;
        placements.forEach((placement, index) => {
            const row = this.sticky.children[index] as HTMLElement | undefined;
            if (row) {
                row.style.transform = placement.offset === 0 ? '' : `translateY(${placement.offset}px)`;
                row.style.zIndex = String(placements.length - index);
            }
        });
    }

    /* A click on a pinned header: the caret goes to it and it scrolls into place under the headers of the blocks around it. */
    jumpToHeader(line: number, depth: number): void {
        const bounds = this.model.getLine(line);
        const indent = bounds.text.length - bounds.text.trimStart().length;
        this.model.setSelections([{ anchor: bounds.start + indent, head: bounds.start + indent }]);
        this.viewport.scrollTop = Math.max(0, this.layout.rowForLine(line).top - depth * this.layout.metrics.lineHeight);
        this.render();
    }

    /* Whether a click at this point of the gutter is on a fold control, and which line it folds. */
    foldLineOf(target: EventTarget | null): number | null {
        const button = (target as HTMLElement | null)?.closest?.('[data-fold-line]');
        return button ? Number((button as HTMLElement).dataset.foldLine) : null;
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.subscription.dispose();
        this.resizeObserver?.disconnect();
        this.blockObserver?.disconnect();
        clearTimeout(this.foldTimer);
        clearTimeout(this.colorTimer);
        clearTimeout(this.noticeTimer);
        clearTimeout(this.caretTimer);
        if (this.frame !== undefined) {
            this.document.defaultView?.cancelAnimationFrame?.(this.frame);
        }
        this.findListeners.clear();
        this.scopeListeners.clear();
        this.painter.clear();
        this.root.remove();
    }
}

import {
    type DocumentChange,
    type DocumentModel,
    type EditorSnapshot,
    type FoldHints,
    type FoldRole,
    type FoldingRange,
    replacementText,
    scanBrackets,
    type BracketIndex,
    type Selection as EditorSelection
} from '@ruimte/smart-editor-core';
import { FindController } from './find.ts';
import { type BlockWidget, EditorLayout, type FoldState, type Inlay, type LayoutRect, type LayoutRow, RIGHT_PADDING, type TextRow } from './layout.ts';
import { createMetrics, type EditorFont, readEditorFont } from './metrics.ts';
import { type AttributedLines, AttributionRuns, colorValue, tintValue } from './attribution.ts';
import { renderCodeBlock } from './code-block.ts';
import { mapOffset } from './offsets.ts';
import { mapTrackedRange } from './tracked-range.ts';
import { type ScrollKind, scrollPosition } from './scroll.ts';
import { easeOut, scrollDuration } from './scroll-animation.ts';
import { Outline, scopeChain, type StickyPlacement, stickyCover, stickyPlacements, structuralEntries } from './outline.ts';
import { type OverviewSpan, overviewTicks, paintOverview } from './overview.ts';
import {
    paintCarets,
    paintGutter,
    paintOver,
    paintOverlays,
    paintRemoteCarets,
    paintSigns,
    paintSticky,
    type RemoteCaret,
    RowPainter,
    type StickyEntry,
    type WrapSign
} from './paint.ts';
import { overlayTokens, type SemanticSpan } from './semantic.ts';
import { indentationColumn } from '@ruimte/smart-editor-core';
import { TokenCache } from './tokens.ts';
import type {
    EditorBlock,
    EditorChangeKind,
    EditorChangeMark,
    EditorCodeBlockOptions,
    EditorFindQuery,
    EditorFindState,
    EditorHighlightKind,
    EditorMarkerSeverity,
    EditorMessages,
    EditorRect,
    EditorSmartKeys,
    LineToken,
    LineTokenizer,
    ScopeColors
} from './types.ts';

function sameRect(left: EditorRect, right: EditorRect): boolean {
    return left.left === right.left && left.top === right.top && left.right === right.right && left.bottom === right.bottom;
}

export interface ViewSettings {
    language: string | undefined;
    tabSize: number;
    insertSpaces: boolean;
    readOnly: boolean;
    readOnlyReason: string | undefined;
    wrap: boolean;
    smartKeys: EditorSmartKeys;
    messages: Partial<EditorMessages>;
    /* A line at each indentation level, and the one of the scope around the caret stronger. */
    guides: boolean;
    /* Spaces drawn as dots and tabs as arrows. */
    whitespace: boolean;
    /* The column a line is held to, drawn as a line; null for none. */
    rightMargin: number | null;
    /* When the arrow that folds a block shows in the gutter. */
    foldOutline: 'off' | 'hover' | 'always';
}

/* The lines past the visible ones that are colored ahead of the scroll, and how long one slice of that work may take. */
const COLOR_MARGIN = 80;
const MIN_OVERSCAN = 400;
const COLOR_SLICE_MS = 8;
const FIRST_PAINT_MS = 12;
const FOLD_DELAY_MS = 300;

/* The space between the last character of a line and what the host puts after it. */
const LINE_ACTION_GAP = 28;
const NOTICE_MS = 3000;
const DEFAULT_HEIGHT = 400;
const DEFAULT_WIDTH = 800;
const FOLD_LIMIT = 2_000_000;
const MIN_GUTTER_WIDTH = 64;
const ATTRIBUTION_WIDTH = 3;
const ATTRIBUTION_REACH = 3;
/* The height of an agent's name over its caret, which the label's style in `editor.css` has too. */
const REMOTE_LABEL_HEIGHT = 18;
/* The caret stays solid this long after it moved, so holding an arrow key does not blink it between steps. */
const CARET_SOLID_MS = 500;
/* A jump moves the view even to something already in view, as the platform does by default. */
const REFRAIN_FROM_SCROLLING = false;
/* Selecting text marks its other occurrences, unless there are more than this many, which would be noise. */
const OCCURRENCE_LIMIT = 50;
const OCCURRENCE_TEXT_LIMIT = 1000;
/* How far the guides look for the lines around a blank one, and how far a scope's guide is followed from the caret. */
const GUIDE_SCAN_LINES = 100;
const GUIDE_RUN_LINES = 5000;
const STICKY_MAX_LINES = 5;
/* A view shows at most this share of its rows as sticky headers, so a small node keeps most of its text. */
const STICKY_ROW_SHARE = 4;

/* A range of lines that folds: the document's own, or one a person made of a selection. */
export type ViewFold = Omit<FoldingRange, 'kind'> & { kind: FoldingRange['kind'] | 'custom' };

/* A mark the host asked for, such as every use of the name under the caret. */
export interface Occurrence {
    from: number;
    to: number;
    kind?: EditorHighlightKind;
}

/* A stretch of text the language servers classified, anchored to offsets that follow the text through edits. */
export interface ViewSemanticToken {
    from: number;
    to: number;
    scopes: readonly string[];
}

/* A problem the host marked, anchored to offsets that follow the text through edits. */
export interface ViewMarker {
    severity: EditorMarkerSeverity;
    from: number;
    to: number;
    unnecessary: boolean;
    deprecated: boolean;
    message?: string;
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
    private readonly over: HTMLElement;
    private readonly carets: HTMLElement;
    private readonly remote: HTMLElement;
    private readonly actions: HTMLElement;
    private readonly preview: HTMLElement;
    private readonly signs: HTMLElement;
    private readonly notice: HTMLElement;
    private readonly sticky: HTMLElement;
    private readonly overview: HTMLElement;
    private readonly tickTip: HTMLElement;
    private readonly painter: RowPainter;
    private readonly document: Document;
    private readonly resizeObserver: ResizeObserver | undefined;
    private readonly blockObserver: ResizeObserver | undefined;
    private readonly subscription: { dispose(): void };
    private readonly findListeners = new Set<(state: EditorFindState) => void>();
    private readonly scopeListeners = new Set<(scope: readonly EditorBlock[]) => void>();
    private readonly viewListeners = new Set<() => void>();
    private readonly gutterActionListeners = new Set<(line: number) => void>();
    private gutterAction: { line: number; label: string } | null = null;
    private readonly gutterMarkerListeners = new Set<(id: string) => void>();
    private readonly gutterMarkers = new Map<string, readonly { id: string; line: number; label: string }[]>();
    private semantic: ViewSemanticToken[] = [];
    private scopeColors: ScopeColors | null = null;
    private semanticVersion = 0;
    private semanticIndex: { key: string; lines: Map<number, SemanticSpan[]> } | undefined;
    private readonly semanticLines = new Map<number, { base: readonly LineToken[]; signature: string; result: readonly LineToken[] }>();
    private markers: ViewMarker[] = [];
    private markerVersion = 0;
    private viewKey = '';
    private readonly hoverListeners = new Set<(offset: number | null) => void>();
    private hoverOffset: number | null = null;
    private readonly outline = new Outline();
    private stickyEntries: StickyEntry[] = [];
    private scopeKey = '';
    private changeMarks: { kind: EditorChangeKind; from: number; to: number }[] = [];
    private changeVersion = 0;
    private readonly attribution = new AttributionRuns();
    private readonly highlights = new AttributionRuns();
    private remoteCarets: { id: string; name: string; color: string; at: number }[] = [];
    private remoteKey: string | null = null;
    /* The host's DOM after the last character of a line, by owner; `at` is the start of its line and follows the text through edits. */
    private readonly lineActions = new Map<string, { id: string; at: number; render: (container: HTMLElement) => void }[]>();
    private readonly actionElements = new Map<string, HTMLElement>();
    private readonly attributionListeners = new Set<(hover: { id: string; rect: EditorRect } | null) => void>();
    private attributionHover: { id: string; rect: EditorRect } | null = null;
    /* Where the pointer is in the gutter, so the bar under it is found again after the view scrolled or the text moved. */
    private attributionPointer: { x: number; y: number } | null = null;
    private readonly tracked = new Set<{ from: number; to: number; lost: boolean }>();
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
    private frameGeometry: { top: number; left: number; width: number; height: number } | null = null;
    private disposed = false;
    private inlays: Inlay[] = [];
    /* The host's widgets by owner, so one owner setting its rows never takes another's away. */
    private readonly blocks = new Map<string, BlockWidget[]>();
    private lenses: BlockWidget[] = [];
    private occurrences: Occurrence[] = [];
    private replacePreview: { text: string; preserveCase: boolean } | null = null;
    private dropCaret: number | null = null;
    private activeGuideCache: { key: string; guide: { column: number; first: number; last: number } | null } | undefined;
    /* Column mode: a drag or Shift with the arrows selects a box of columns, as Alt does for a drag. */
    columnMode = false;
    /* A scroll on its way: where it started and ends, when, and the frame that moves it. */
    private scrollRun: { frame: number; from: { x: number; y: number }; to: { x: number; y: number }; start: number | null; duration: number } | null = null;
    private selectionOccurrenceCache: { key: string; ranges: readonly { from: number; to: number }[] } = { key: '', ranges: [] };
    private link: { from: number; to: number } | null = null;
    private composition: string | undefined;
    private ghost: { at: number; text: string; accessory: ((container: HTMLElement) => void) | undefined } | null = null;
    private ghostSerial = 0;
    private foldRanges: ViewFold[] = [];
    /* The folds made of a selection, which follow their text through edits. */
    private customFolds: { from: number; to: number }[] = [];
    private collapsed = new Set<number>();
    /* What a language server said about the folds, in offsets that follow the text through edits. */
    private foldHints: FoldHints | null = null;
    /* The roles that fold by themselves while the file is as it was opened; null once a person edited or the file opened with folds of its own. */
    private defaultRoles: ReadonlySet<FoldRole> | null = null;
    /* The folds somebody already decided on, a person or the defaults, so a later answer of a server leaves them as they are. */
    private settled = new Set<number>();
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
        this.over = make('div', 'se-over');
        this.carets = make('div', 'se-carets');
        this.remote = make('div', 'se-remote');
        this.actions = make('div', 'se-actions');
        this.signs = make('div', 'se-signs');
        this.signs.setAttribute('aria-hidden', 'true');
        this.preview = make('div', 'se-preview');
        this.preview.setAttribute('aria-hidden', 'true');
        this.preview.hidden = true;
        for (const layer of [this.overlays, this.over, this.carets, this.remote]) {
            layer.setAttribute('aria-hidden', 'true');
        }
        code.setAttribute('aria-hidden', 'true');
        this.content.append(this.overlays, this.signs, code, this.over, this.carets, this.remote, this.actions, this.preview);
        // The gutter is in the scroller with the text and sticks to its left, so the browser moves both in the same frame.
        const scroller = make('div', 'se-scroller');
        // The pinned headers stick to the corner the same way, which keeps them still against the text while the browser scrolls.
        const stickyAnchor = make('div', 'se-sticky-anchor');
        this.sticky = make('div', 'se-sticky');
        stickyAnchor.append(this.sticky);
        scroller.append(stickyAnchor, this.gutter, this.content);
        this.viewport.append(scroller);
        this.input = make('textarea', 'se-input');
        this.input.wrap = 'off';
        this.input.spellcheck = false;
        for (const name of ['autocapitalize', 'autocomplete', 'autocorrect']) {
            this.input.setAttribute(name, 'off');
        }
        this.input.setAttribute('aria-multiline', 'true');
        this.input.setAttribute('aria-label', 'Code editor');
        this.sticky.setAttribute('aria-hidden', 'true');
        this.sticky.hidden = true;
        this.overview = make('div', 'se-overview');
        this.overview.setAttribute('aria-hidden', 'true');
        this.tickTip = make('div', 'se-tick-tip');
        this.tickTip.hidden = true;
        this.notice = make('div', 'se-notice');
        this.notice.setAttribute('role', 'status');
        this.notice.hidden = true;
        this.root.append(this.viewport, this.overview, this.tickTip, this.input, this.notice);
        this.wireOverview();
        this.wireAttribution();
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
        this.root.dataset.foldOutline = this.settings.foldOutline;
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

    setBlockWidgets(owner: string, blocks: readonly BlockWidget[]): void {
        if (blocks.length === 0) {
            this.blocks.delete(owner);
        } else {
            this.blocks.set(owner, [...blocks]);
        }
        this.anchorScroll(() => this.layout.configure({ blocks: this.allBlocks() }));
        this.render();
    }

    /* The quiet rows above declarations: kept apart from the host's widgets, so setting one kind never takes the other away. */
    setLenses(lenses: readonly BlockWidget[]): void {
        this.lenses = [...lenses];
        this.anchorScroll(() => this.layout.configure({ blocks: this.allBlocks() }));
        this.render();
    }

    /* Rows under the same line go by owner name and then by the order the owner gave them, so they never swap places when another owner sets its own. */
    private allBlocks(): BlockWidget[] {
        const owners = [...this.blocks.keys()].sort();
        return [...owners.flatMap((owner) => this.blocks.get(owner)!), ...this.lenses];
    }

    setOccurrences(occurrences: readonly Occurrence[]): void {
        if (occurrences.length === 0 && this.occurrences.length === 0) {
            return;
        }
        this.occurrences = [...occurrences];
        this.render();
    }

    /* A name underlined as a link a press follows, with the pointer to match; null takes it away. */
    setLink(link: { from: number; to: number } | null): void {
        this.link = link;
        this.content.classList.toggle('se-content-link', link !== null);
        this.render();
    }

    /* What the language servers classified, drawn over the grammar's colors; null takes it away. */
    setSemanticTokens(tokens: readonly ViewSemanticToken[] | null): void {
        this.semantic = tokens === null ? [] : [...tokens];
        this.semanticVersion++;
        this.render();
    }

    /* How the current theme draws a scope; without it the classification has no colors to draw in. */
    setScopeColors(colors: ScopeColors | null): void {
        this.scopeColors = colors;
        this.semanticVersion++;
        this.semanticLines.clear();
        this.render();
    }

    /* The grammar's colors of a line with the servers' laid over them, the same object for as long as neither changed. */
    private styledTokensOf(line: number): readonly LineToken[] | null {
        const base = this.tokens.tokensOf(line);
        if (base === null || this.semantic.length === 0 || this.scopeColors === null) {
            return base;
        }
        const spans = this.semanticSpans().get(line);
        if (spans === undefined) {
            return base;
        }
        const signature = spans.map((span) => `${span.from}:${span.to}:${span.color}:${span.fontStyle}`).join('|');
        const cached = this.semanticLines.get(line);
        if (cached?.base === base && cached.signature === signature) {
            return cached.result;
        }
        if (this.semanticLines.size > 600) {
            this.semanticLines.clear();
        }
        const result = overlayTokens(base, spans);
        this.semanticLines.set(line, { base, signature, result });
        return result;
    }

    private semanticSpans(): Map<number, SemanticSpan[]> {
        const key = `${this.revision}|${this.semanticVersion}`;
        if (this.semanticIndex?.key === key) {
            return this.semanticIndex.lines;
        }
        const lines = new Map<number, SemanticSpan[]>();
        const colors = this.scopeColors;
        for (const token of this.semantic) {
            const style = colors?.(token.scopes);
            if (style === undefined || token.to <= token.from) {
                continue;
            }
            const line = this.model.positionAt(token.from).line;
            const start = this.model.getLine(line).start;
            const end = this.model.getLine(line).end;
            if (token.to > end) {
                continue;
            }
            const list = lines.get(line) ?? [];
            list.push({ from: token.from - start, to: token.to - start, color: style.color, fontStyle: style.fontStyle });
            lines.set(line, list);
        }
        for (const list of lines.values()) {
            list.sort((left, right) => left.from - right.from);
        }
        this.semanticIndex = { key, lines };
        return lines;
    }

    setMarkers(markers: readonly ViewMarker[]): void {
        this.markers = [...markers];
        this.markerVersion++;
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

    get viewportHeight(): number {
        return this.clientHeight || DEFAULT_HEIGHT;
    }

    /* Read once at the start of a render: a read after the first write of the frame makes the browser lay the page out again. */
    private get scrollTop(): number {
        return this.frameGeometry?.top ?? this.viewport.scrollTop;
    }

    private get scrollLeft(): number {
        return this.frameGeometry?.left ?? this.viewport.scrollLeft;
    }

    private get clientWidth(): number {
        return this.frameGeometry?.width ?? this.viewport.clientWidth;
    }

    private get clientHeight(): number {
        return this.frameGeometry?.height ?? this.viewport.clientHeight;
    }

    /* A viewport of rows on each side, so a fling the compositor runs ahead of this thread still lands on drawn rows. */
    private get overscan(): number {
        return Math.max(MIN_OVERSCAN, this.viewportHeight);
    }

    /* The width the text has, which is what the viewport has left of the gutter. */
    private get viewportWidth(): number {
        return Math.max(1, (this.clientWidth || DEFAULT_WIDTH) - this.gutterWidth);
    }

    private modelChanged(snapshot: EditorSnapshot): void {
        if (snapshot.revision !== this.revision) {
            this.cancelScroll();
            this.revision = snapshot.revision;
            this.defaultRoles = null;
            this.rowEndCaret = null;
            this.hoverOffset = null;
            const batches = snapshot.changes ?? [];
            if (this.ghost !== null && batches.length > 0) {
                this.ghost = null;
                this.layoutGhostParts();
            }
            for (const changes of batches) {
                this.inlays = this.inlays.map((inlay) => ({ ...inlay, at: mapOffset(inlay.at, changes) }));
                for (const [owner, blocks] of this.blocks) {
                    this.blocks.set(
                        owner,
                        blocks.map((block) => ({ ...block, at: mapOffset(block.at, changes) }))
                    );
                }
                this.lenses = this.lenses.map((lens) => ({ ...lens, at: mapOffset(lens.at, changes) }));
                this.collapsed = new Set([...this.collapsed].map((anchor) => mapOffset(anchor, changes)));
                this.settled = new Set([...this.settled].map((anchor) => mapOffset(anchor, changes)));
                if (this.foldHints !== null) {
                    this.foldHints = {
                        symbols:
                            this.foldHints.symbols?.map((hint) => ({ ...hint, from: mapOffset(hint.from, changes), to: mapOffset(hint.to, changes) })) ?? [],
                        ranges: this.foldHints.ranges?.map((hint) => ({ ...hint, from: mapOffset(hint.from, changes), to: mapOffset(hint.to, changes) })) ?? []
                    };
                }
                this.customFolds = this.customFolds.map((fold) => ({ from: mapOffset(fold.from, changes), to: mapOffset(fold.to, changes) }));
                this.find.mapBounds(changes);
                this.changeMarks = this.changeMarks.map((mark) => ({ ...mark, from: mapOffset(mark.from, changes), to: mapOffset(mark.to, changes) }));
                this.markers = this.markers.map((marker) => ({ ...marker, from: mapOffset(marker.from, changes), to: mapOffset(marker.to, changes) }));
                this.mapTracked(changes);
                this.attribution.map(changes);
                this.highlights.map(changes);
                this.remoteCarets = this.remoteCarets.map((caret) => ({ ...caret, at: mapOffset(caret.at, changes) }));
                for (const [owner, entries] of this.lineActions) {
                    this.lineActions.set(
                        owner,
                        entries.map((entry) => ({ ...entry, at: mapOffset(entry.at, changes) }))
                    );
                }
                this.semantic = this.semantic.map((token) => ({ ...token, from: mapOffset(token.from, changes), to: mapOffset(token.to, changes) }));
            }
            this.foldRanges = this.mappedFolds(batches);
            this.semanticVersion++;
            this.markerVersion++;
            const anchor = this.topAnchor;
            this.occurrences = [];
            this.link = null;
            this.content.classList.remove('se-content-link');
            this.outline.edited(batches);
            this.changeVersion++;
            this.tokens.edited(batches, (offset) => this.model.positionAt(offset).line);
            this.layout.configure({ textChanged: true, inlays: this.displayedInlays(), blocks: this.allBlocks(), folds: this.foldStates() });
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
        if (this.rowEndCaret !== null && this.model.getPrimary().head !== this.rowEndCaret) {
            this.rowEndCaret = null;
        }
        this.requestRender();
    }

    private mapTracked(changes: readonly DocumentChange[]): void {
        for (const entry of this.tracked) {
            const mapped = mapTrackedRange(entry.from, entry.to, changes);
            if (mapped === null) {
                entry.lost = true;
                this.tracked.delete(entry);
            } else {
                entry.from = mapped.from;
                entry.to = mapped.to;
            }
        }
    }

    /* A range that follows the text through edits and is lost once one touches it; see `mapTrackedRange`. */
    trackRange(from: number, to: number): { get(): { from: number; to: number } | null; dispose(): void } {
        const entry = { from, to, lost: false };
        this.tracked.add(entry);
        return {
            get: () => (entry.lost ? null : { from: entry.from, to: entry.to }),
            dispose: () => {
                entry.lost = true;
                this.tracked.delete(entry);
            }
        };
    }

    /* The ranges follow the text until the next read of the document, so a fold above an edit stays closed meanwhile. */
    private mappedFolds(batches: readonly (readonly DocumentChange[])[]): ViewFold[] {
        const mapped: ViewFold[] = [];
        for (const range of this.foldRanges) {
            let from = range.from;
            let to = range.to;
            for (const changes of batches) {
                from = mapOffset(from, changes);
                to = mapOffset(to, changes);
            }
            const startLine = this.model.positionAt(from).line;
            const endLine = this.model.positionAt(to).line;
            if (endLine > startLine) {
                mapped.push({ ...range, from, to, startLine, endLine });
            }
        }
        return mapped;
    }

    private displayedInlays(): Inlay[] {
        const inlays = this.composition
            ? [...this.inlays, { id: '__composition', at: this.model.getPrimary().head, text: this.composition, composition: true }]
            : this.inlays;
        const [first = ''] = this.ghost?.text.split(/\r?\n/) ?? [];
        return this.ghost === null || first === '' ? inlays : [...inlays, { id: '__ghost', at: this.ghost.at, text: first, ghost: true }];
    }

    /* A suggestion after the caret: its first line in the text, the rest in rows under the line, and the host's accessory after the first line. */
    setGhost(ghost: { at: number; text: string; accessory: ((container: HTMLElement) => void) | undefined } | null): void {
        this.ghost = ghost === null || ghost.text === '' ? null : ghost;
        this.layoutGhostParts();
        this.configureText();
    }

    private layoutGhostParts(): void {
        const ghost = this.ghost;
        const [, ...rest] = ghost?.text.split(/\r?\n/) ?? [];
        const owner = '__ghost';
        this.setBlockWidgets(
            owner,
            ghost === null || rest.length === 0
                ? []
                : [
                      {
                          id: owner,
                          at: ghost.at,
                          placement: 'below',
                          height: rest.length * this.layout.metrics.lineHeight,
                          render: (container) => {
                              container.classList.add('se-widget', 'se-ghost-rows');
                              renderCodeBlock(container, rest.join('\n'), null, this.settings.tabSize, {});
                          }
                      }
                  ]
        );
        this.setLineActions(
            owner,
            ghost?.accessory === undefined
                ? []
                : [
                      {
                          id: `ghost-${++this.ghostSerial}`,
                          at: ghost.at,
                          render: (container) => {
                              container.classList.add('se-ghost-accessory');
                              ghost.accessory?.(container);
                          }
                      }
                  ]
        );
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
                : this.model.getFoldingRanges({
                      indentation: /^(python|py|yaml|yml)$/.test(this.settings.language ?? ''),
                      tabSize: this.settings.tabSize,
                      ...(this.settings.language === undefined ? {} : { language: this.settings.language }),
                      ...(this.foldHints === null ? {} : { hints: this.foldHints })
                  });
        this.foldRanges = this.withCustomFolds(ranges);
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

    /* The folds a person made of a selection, which the document's own structure does not know, among the ones it does. */
    private withCustomFolds(ranges: readonly FoldingRange[]): ViewFold[] {
        const custom = this.customFolds.flatMap((fold): ViewFold[] => {
            const startLine = this.model.positionAt(fold.from).line;
            const endLine = this.model.positionAt(fold.to).line;
            return endLine > startLine ? [{ startLine, endLine, from: fold.from, to: fold.to, kind: 'custom' }] : [];
        });
        return [...ranges, ...custom].sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
    }

    /* Where what stays visible of a collapsed range starts on its last line: its closer, with any closers right before it, so `])` is kept whole. */
    private closerOf(range: ViewFold): number | undefined {
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
    private foldAt(line: number): ViewFold | undefined {
        return this.foldRanges.find((range) => range.startLine === line);
    }

    /* The range that starts on a line when it is the only one, as the platform's fold commands read a line. */
    private soleFoldAt(line: number): ViewFold | undefined {
        const starting = this.foldRanges.filter((range) => range.startLine === line);
        return starting.length === 1 ? starting[0] : undefined;
    }

    /* The ranges an offset is in or at the edge of, the innermost first. */
    private foldsAt(offset: number): ViewFold[] {
        return this.foldRanges.filter((range) => range.from <= offset && offset <= range.to).sort((left, right) => right.from - left.from);
    }

    private isCollapsed(range: ViewFold): boolean {
        return this.collapsed.has(range.from);
    }

    private setCollapsed(range: ViewFold, collapse: boolean): void {
        this.settled.add(range.from);
        if (collapse) {
            this.collapsed.add(range.from);
        } else {
            this.collapsed.delete(range.from);
        }
    }

    /* A click on a line's control: the outermost range there folds, and unfolding opens every range that starts there. */
    toggleFold(line: number, collapse?: boolean): boolean {
        const range = this.foldAt(line);
        if (!range) {
            return false;
        }
        const next = collapse ?? !this.foldRanges.some((candidate) => candidate.startLine === line && this.isCollapsed(candidate));
        for (const candidate of this.foldRanges) {
            if (candidate.startLine === line && (next ? candidate === range : true)) {
                this.setCollapsed(candidate, next);
            }
        }
        this.refoldLayout();
        return true;
    }

    /* Folds, at every caret, the range that starts on its line, or else the innermost open range around it. */
    collapseRegion(): void {
        const carets = this.model.getSelections();
        const primary = this.model.getPrimary().head;
        for (const caret of carets) {
            const range = this.soleFoldAt(this.model.positionAt(caret.head).line);
            if (range !== undefined && !this.isCollapsed(range)) {
                this.setCollapsed(range, true);
            } else {
                const open = this.foldsAt(primary).find((candidate) => !this.isCollapsed(candidate));
                if (open !== undefined) {
                    this.setCollapsed(open, true);
                }
            }
        }
        this.refoldLayout();
    }

    /* Opens, at every caret, the range that starts on its line when it is folded, or else the outermost folded range around it. */
    expandRegion(): void {
        for (const caret of this.model.getSelections()) {
            const range = this.soleFoldAt(this.model.positionAt(caret.head).line);
            if (range !== undefined && this.isCollapsed(range)) {
                this.setCollapsed(range, false);
            } else {
                const closed = this.foldsAt(caret.head).findLast((candidate) => this.isCollapsed(candidate));
                if (closed !== undefined) {
                    this.setCollapsed(closed, false);
                }
            }
        }
        this.refoldLayout();
    }

    /* The range at the primary caret and every range inside it, to be folded or opened together. */
    private foldTreeAtCaret(collapse: boolean): ViewFold[] {
        const head = this.model.getPrimary().head;
        let root = this.soleFoldAt(this.model.positionAt(head).line);
        if (root === undefined || (collapse && this.isCollapsed(root))) {
            root = this.foldsAt(head).find((candidate) => !this.isCollapsed(candidate) === collapse);
        }
        return root === undefined ? [] : this.foldRanges.filter((range) => root.from <= range.from && range.to <= root.to);
    }

    collapseRecursively(): void {
        for (const range of this.foldTreeAtCaret(true)) {
            this.setCollapsed(range, true);
        }
        this.refoldLayout();
    }

    expandRecursively(): void {
        for (const range of this.foldTreeAtCaret(false)) {
            this.setCollapsed(range, false);
        }
        this.refoldLayout();
    }

    /* Folds or opens every range, or the ones inside the selection when it holds any. */
    foldAll(collapse: boolean): void {
        const { anchor, head } = this.model.getPrimary();
        const from = Math.min(anchor, head);
        const to = Math.max(anchor, head);
        const inside = from === to ? [] : this.foldRanges.filter((range) => from <= range.from && range.to <= to);
        for (const range of inside.length > 0 ? inside : this.foldRanges) {
            this.setCollapsed(range, collapse);
        }
        this.refoldLayout();
    }

    /*
     * Folds the lines of the selection under its first line, with a chip, or takes a fold of the same lines
     * away. With nothing selected it takes away the fold around the caret that a selection made, or opens
     * and closes one of the document's own. A selection inside one line has no line to fold.
     */
    foldSelection(): void {
        const { anchor, head } = this.model.getPrimary();
        let from = Math.min(anchor, head);
        let to = Math.max(anchor, head);
        if (from === to) {
            const around = this.foldsAt(head)[0];
            if (around?.kind === 'custom') {
                this.customFolds = this.customFolds.filter((fold) => fold.from !== around.from);
                this.collapsed.delete(around.from);
            } else if (around !== undefined) {
                this.setCollapsed(around, !this.isCollapsed(around));
            }
            this.refreshFolds();
            return;
        }
        if (this.model.slice(to - 1, to) === '\n') {
            to--;
        }
        const startLine = this.model.positionAt(from).line;
        if (this.model.positionAt(to).line <= startLine) {
            return;
        }
        from = this.model.getLine(startLine).start;
        const existing = this.foldRanges.find((range) => range.kind === 'custom' && range.from === from && range.to === to);
        if (existing !== undefined) {
            this.customFolds = this.customFolds.filter((fold) => fold.from !== from);
            this.collapsed.delete(from);
        } else {
            this.customFolds = [...this.customFolds, { from, to }];
            this.collapsed.add(from);
        }
        this.refreshFolds();
    }

    /* The lines that are folded and the ones a selection folded, for a host that opens the file again where it left it. */
    getFolds(): { collapsed: { startLine: number; endLine: number }[]; custom: { startLine: number; endLine: number }[] } {
        const lines = (range: ViewFold): { startLine: number; endLine: number } => ({ startLine: range.startLine, endLine: range.endLine });
        return {
            collapsed: this.foldRanges.filter((range) => this.isCollapsed(range)).map(lines),
            custom: this.foldRanges.filter((range) => range.kind === 'custom').map(lines)
        };
    }

    /*
     * Folds the lines a host remembers, those that still start a range of the same lines or else any range
     * at their first line, after the ranges are read. Without a memory the roles in `defaults` fold, which
     * is what a file opens as the first time, and again as a language server names more of them.
     */
    restoreFolds(
        state: { collapsed: readonly { startLine: number; endLine: number }[]; custom: readonly { startLine: number; endLine: number }[] } | null,
        defaults: readonly FoldRole[] = []
    ): void {
        const last = this.model.getLineCount() - 1;
        if (state !== null) {
            this.customFolds = state.custom
                .filter((fold) => fold.startLine < fold.endLine && fold.endLine <= last)
                .map((fold) => ({ from: this.model.getLine(fold.startLine).start, to: this.model.getLine(fold.endLine).end }));
        }
        this.refreshFolds();
        this.defaultRoles = state === null && defaults.length > 0 ? new Set(defaults) : null;
        for (const remembered of state?.collapsed ?? []) {
            const match =
                this.foldRanges.find((range) => range.startLine === remembered.startLine && range.endLine === remembered.endLine) ??
                this.foldRanges.find((range) => range.startLine === remembered.startLine);
            if (match !== undefined) {
                this.setCollapsed(match, true);
            }
        }
        this.applyFoldDefaults();
        this.refoldLayout();
    }

    /* Hands over what a language server knows about the folds; null forgets it. The defaults fold what the answer names, once. */
    setFoldHints(hints: FoldHints | null): void {
        this.foldHints = hints;
        this.refreshFolds();
        this.applyFoldDefaults();
        this.refoldLayout();
    }

    /* Folds the ranges whose role is a default, except a range somebody decided on or one that has the caret or a selection in it. */
    private applyFoldDefaults(): void {
        const roles = this.defaultRoles;
        if (roles === null) {
            return;
        }
        const lines = this.model
            .getSelections()
            .flatMap((selection) => [this.model.positionAt(selection.anchor).line, this.model.positionAt(selection.head).line]);
        for (const range of this.foldRanges) {
            const hidesCaret = lines.some((line) => line > range.startLine && line <= range.endLine);
            if (range.role !== undefined && roles.has(range.role) && !this.settled.has(range.from) && !hidesCaret) {
                this.setCollapsed(range, true);
            }
        }
    }

    /* Folds or opens every range of a role, such as the documentation comments. */
    foldRole(role: FoldRole, collapse: boolean): void {
        for (const range of this.foldRanges) {
            if (range.role === role) {
                this.setCollapsed(range, collapse);
            }
        }
        this.refoldLayout();
    }

    /*
     * Opens every range above a depth and folds the ones at it, which leaves what lies deeper as it was.
     * The outermost ranges are at depth 0, so level 1 shows them open with what they hold folded.
     */
    expandAllToLevel(level: number): void {
        const open: ViewFold[] = [];
        for (const range of this.foldRanges) {
            while (open.length > 0 && !(open.at(-1)!.from <= range.from && range.to <= open.at(-1)!.to)) {
                open.pop();
            }
            if (open.length < level) {
                this.setCollapsed(range, false);
            } else if (open.length === level) {
                this.setCollapsed(range, true);
            }
            open.push(range);
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
                this.settled.add(range.from);
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

    /* The scale a canvas puts on the node the editor is in, which is 1 anywhere else. */
    private screenScale(rect: DOMRect): { x: number; y: number } {
        return {
            x: this.viewport.offsetWidth > 0 ? rect.width / this.viewport.offsetWidth : 1,
            y: this.viewport.offsetHeight > 0 ? rect.height / this.viewport.offsetHeight : 1
        };
    }

    /* The character cell at an offset in the page's pixels, undoing nothing: a popup placed by it is right at any zoom. */
    clientRectOf(offset: number): EditorRect | null {
        const rect = this.viewport.getBoundingClientRect?.();
        if (!rect) {
            return null;
        }
        const scale = this.screenScale(rect);
        const caret = this.layout.caret(offset);
        const left = rect.left + (caret.x + this.gutterWidth - this.viewport.scrollLeft) * scale.x;
        const top = rect.top + (caret.y - this.viewport.scrollTop) * scale.y;
        return { left, top, right: left + this.layout.metrics.charWidth * scale.x, bottom: top + caret.height * scale.y };
    }

    /* The offset of the character under a point of the page, or null over anything that is not text. */
    characterAtPoint(clientX: number, clientY: number, target: EventTarget | null): number | null {
        if ((target as HTMLElement | null)?.closest?.('.se-inlay, .se-block, .se-line-action, .se-gutter, .se-sticky, .se-fold-chip, .se-overview')) {
            return null;
        }
        const point = this.contentPoint(clientX, clientY);
        if (point.y < 0 || point.y > this.layout.height) {
            return null;
        }
        const row = this.layout.rowAt(point.y);
        if (row.kind !== 'text') {
            return null;
        }
        const hit = this.layout.hitTestRow(point.x, point.y);
        const caret = this.layout.caret(hit.offset);
        const line = this.model.getLine(row.line);
        const offset = point.x >= caret.x ? hit.offset : hit.offset - 1;
        // Past the last character of a line the nearest stop is its end, which no character is under.
        if (offset < line.start || offset >= line.end || Math.abs(point.x - caret.x) > this.layout.metrics.charWidth * 1.5) {
            return null;
        }
        return offset;
    }

    /* The visual line an offset is on, where a caret drawn at the end of a wrapped row counts as being on that row. */
    rowOf(offset: number): { start: number; end: number } {
        const { start, end } = this.layout.visualLine(offset === this.rowEndCaret ? offset - 1 : offset);
        return { start, end };
    }

    /* The lines that stand on one row of the screen: a collapsed fold is a row, from its first line to its last. */
    lineSpan(line: number): { first: number; last: number } {
        const row = this.layout.rowForLine(line);
        return row.kind === 'text' ? { first: row.line, last: row.lastLine } : { first: line, last: line };
    }

    /* The folds that were closed before lines moved stay closed on the lines they went to, which the edit that moved them could not carry. */
    refoldMoved(folded: readonly { startLine: number; endLine: number }[], moves: readonly { from: number; to: number }[]): void {
        const moved = new Map(moves.map((move) => [move.from, move.to]));
        this.refreshFolds();
        for (const range of this.foldRanges) {
            if (moved.size > 0 && [...moved.values()].includes(range.startLine)) {
                this.collapsed.delete(range.from);
            }
        }
        for (const fold of folded) {
            const start = moved.get(fold.startLine);
            const target =
                start === undefined
                    ? undefined
                    : this.foldRanges.find((range) => range.startLine === start && range.endLine === start + fold.endLine - fold.startLine);
            if (target !== undefined) {
                this.setCollapsed(target, true);
            }
        }
        this.refoldLayout();
    }

    /* A caret that went to the end of a wrapped row stays drawn there, though its offset is where the next row starts. */
    markRowEnd(offset: number): void {
        const line = this.model.getLine(this.model.positionAt(offset).line);
        if (offset > line.start && offset < line.end && this.layout.visualLine(offset).start === offset) {
            this.rowEndCaret = offset;
            this.requestRender();
        }
    }

    onHover(listener: (offset: number | null) => void): () => void {
        this.hoverListeners.add(listener);
        return () => {
            this.hoverListeners.delete(listener);
        };
    }

    /* The pointer moved over the editor; a drag in progress is not a hover. */
    /*
     * The other places the selected text is, found without a language server: only for one selection that
     * holds no line break and is not blank, and not at all when there are more than a few of them.
     */
    private selectionOccurrences(): readonly { from: number; to: number }[] {
        const selections = this.model.getSelections();
        const only = selections.length === 1 ? selections[0]! : null;
        const from = only === null ? 0 : Math.min(only.anchor, only.head);
        const to = only === null ? 0 : Math.max(only.anchor, only.head);
        const key = `${this.revision}|${from}|${to}`;
        if (this.selectionOccurrenceCache.key === key) {
            return this.selectionOccurrenceCache.ranges;
        }
        let ranges: { from: number; to: number }[] = [];
        const text = to - from > 0 && to - from <= OCCURRENCE_TEXT_LIMIT ? this.model.slice(from, to) : '';
        if (text.trim() !== '' && !/[\r\n]/.test(text) && this.model.getLength() <= FOLD_LIMIT) {
            const found = this.model.find(text, { maxResults: OCCURRENCE_LIMIT + 1 });
            ranges =
                found.length > OCCURRENCE_LIMIT
                    ? []
                    : found.filter((match) => match.from !== from || match.to !== to).map((match) => ({ from: match.from, to: match.to }));
        }
        this.selectionOccurrenceCache = { key, ranges };
        return ranges;
    }

    /* The arrows of the soft wraps in the rows on screen. */
    private wrapSigns(rows: readonly LayoutRow[]): WrapSign[] {
        if (!this.layout.wrapping) {
            return [];
        }
        const lineHeight = this.layout.metrics.lineHeight;
        const signs: WrapSign[] = [];
        for (const row of rows) {
            if (row.kind !== 'text' || row.subRows < 2) {
                continue;
            }
            const geometry = this.layout.geometry(row);
            for (let subRow = 0; subRow < geometry.subRows; subRow++) {
                const y = row.top + subRow * lineHeight;
                if (subRow + 1 < geometry.subRows) {
                    const x = geometry.rowEnds[subRow]!;
                    signs.push({ x, y, width: this.viewportWidth - x });
                }
                if (subRow > 0) {
                    signs.push({ x: 0, y, width: geometry.before[geometry.rowStarts[subRow]!]! });
                }
            }
        }
        return signs.filter((sign) => sign.width >= 3);
    }

    /* The indentation of a line in columns, or null when it is blank. */
    private indentOf(line: number): number | null {
        const text = this.model.getLine(line).text;
        const lead = /^[\t ]*/.exec(text)![0];
        return lead.length === text.length ? null : indentationColumn(lead, this.settings.tabSize);
    }

    /* The indentation a line is read at: a blank one takes the lesser of the lines around it, so a guide runs through it. */
    private effectiveIndent(line: number): number {
        const own = this.indentOf(line);
        if (own !== null) {
            return own;
        }
        const last = this.model.getLineCount() - 1;
        const nearest = (direction: -1 | 1): number => {
            for (let at = line + direction, steps = 0; at >= 0 && at <= last && steps < GUIDE_SCAN_LINES; at += direction, steps++) {
                const indent = this.indentOf(at);
                if (indent !== null) {
                    return indent;
                }
            }
            return 0;
        };
        return Math.min(nearest(-1), nearest(1));
    }

    /* The scope guide of the caret, worked out again only when the text or the caret's line is not the one it was for. */
    private activeGuide(): { column: number; first: number; last: number } | null {
        const line = this.model.positionAt(this.model.getPrimary().head).line;
        const key = `${this.revision}|${line}|${this.settings.tabSize}`;
        if (this.activeGuideCache?.key !== key) {
            this.activeGuideCache = { key, guide: this.scopeGuide(line) };
        }
        return this.activeGuideCache.guide;
    }

    /* The run of lines around a line that the scope guide there goes along, and the column it is at. */
    private scopeGuide(line: number): { column: number; first: number; last: number } | null {
        const size = this.settings.tabSize;
        const indent = this.effectiveIndent(line);
        const count = this.model.getLineCount();
        const deeper = (at: number, column: number): boolean => at >= 0 && at < count && this.effectiveIndent(at) > column;
        const next = (() => {
            for (let at = line + 1; at < count && at < line + GUIDE_SCAN_LINES; at++) {
                if (this.indentOf(at) !== null) {
                    return this.indentOf(at)!;
                }
            }
            return 0;
        })();
        const previous = (() => {
            for (let at = line - 1; at >= 0 && at > line - GUIDE_SCAN_LINES; at--) {
                if (this.indentOf(at) !== null) {
                    return this.indentOf(at)!;
                }
            }
            return 0;
        })();
        // A line that opens a block, or closes one, is at the edge of its guide: the one that sits at its own indentation.
        const opens = indent % size === 0 && (next > indent || previous > indent) && this.indentOf(line) !== null;
        const column = opens ? indent : indent > 0 ? Math.ceil(indent / size - 1) * size : -1;
        if (column < 0) {
            return null;
        }
        const reaches = (from: number, direction: -1 | 1): number => {
            let at = from;
            while (deeper(at + direction, column) && Math.abs(at - line) < GUIDE_RUN_LINES) {
                at += direction;
            }
            return at;
        };
        const inside = deeper(line, column);
        const first = inside ? reaches(line, -1) : next > indent ? line + 1 : reaches(line - 1, -1);
        const last = inside ? reaches(line, 1) : next > indent ? reaches(line + 1, 1) : line - 1;
        return { column, first, last };
    }

    /* A line at each indentation level of the rows on screen, joined where the lines go on, and the one of the scope around the caret apart. */
    private guideRects(rows: readonly LayoutRow[]): { plain: LayoutRect[]; active: LayoutRect[] } {
        const size = this.settings.tabSize;
        const charWidth = this.layout.metrics.charWidth;
        const active = this.activeGuide();
        const plain: LayoutRect[] = [];
        const marked: LayoutRect[] = [];
        interface Open {
            top: number;
            bottom: number;
            first: number;
            last: number;
        }
        const open = new Map<number, Open>();
        const close = (column: number): void => {
            const segment = open.get(column)!;
            open.delete(column);
            const rect = { x: column * charWidth, y: segment.top, width: 1, height: segment.bottom - segment.top };
            (active !== null && active.column === column && segment.last >= active.first && segment.first <= active.last ? marked : plain).push(rect);
        };
        for (const row of rows) {
            if (row.kind !== 'text') {
                for (const segment of open.values()) {
                    segment.bottom = row.top + row.height;
                }
                continue;
            }
            const indent = this.effectiveIndent(row.line);
            for (const column of [...open.keys()]) {
                if (column >= indent) {
                    close(column);
                }
            }
            for (let column = 0; column < indent; column += size) {
                const segment = open.get(column);
                if (segment === undefined) {
                    open.set(column, { top: row.top, bottom: row.top + row.height, first: row.line, last: row.lastLine });
                } else {
                    segment.bottom = row.top + row.height;
                    segment.last = row.lastLine;
                }
            }
        }
        for (const column of [...open.keys()]) {
            close(column);
        }
        return { plain, active: marked };
    }

    /* The selection under a point of the screen, which a press there may drag away. */
    selectionAtPoint(clientX: number, clientY: number): EditorSelection | null {
        const point = this.contentPoint(clientX, clientY);
        const rows = this.layout.visibleRows(this.viewport.scrollTop, this.viewportHeight, 0);
        return (
            this.model.getSelections().find((selection) => {
                const from = Math.min(selection.anchor, selection.head);
                const to = Math.max(selection.anchor, selection.head);
                return (
                    from !== to &&
                    this.layout
                        .rectangles(from, to, rows)
                        .some((rect) => point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height)
                );
            }) ?? null
        );
    }

    setColumnMode(on: boolean): void {
        this.columnMode = on;
        this.root.dataset.column = String(on);
    }

    /* Where text being carried would land, drawn as a caret of its own. */
    setDropCaret(offset: number | null): void {
        this.dropCaret = offset;
        this.render();
    }

    hoverMoved(event: PointerEvent): void {
        this.content.classList.toggle(
            'se-over-selection',
            !this.settings.readOnly && event.buttons === 0 && this.selectionAtPoint(event.clientX, event.clientY) !== null
        );
        this.setHover(event.buttons === 0 ? this.characterAtPoint(event.clientX, event.clientY, event.target) : null);
    }

    setHover(offset: number | null): void {
        if (offset === this.hoverOffset) {
            return;
        }
        this.hoverOffset = offset;
        for (const listener of [...this.hoverListeners]) {
            listener(offset);
        }
    }

    onViewChange(listener: () => void): () => void {
        this.viewListeners.add(listener);
        return () => {
            this.viewListeners.delete(listener);
        };
    }

    private announceView(): void {
        const key = `${this.scrollTop}|${this.scrollLeft}|${this.clientWidth}|${this.clientHeight}|${this.layout.height}`;
        if (key === this.viewKey) {
            return;
        }
        this.viewKey = key;
        for (const listener of [...this.viewListeners]) {
            listener();
        }
    }

    private caretOf(head: number): LayoutRect {
        return this.layout.caret(head, head === this.ghost?.at ? 'before' : 'after', head === this.rowEndCaret);
    }

    /* Where the view is, or where a scroll on its way will leave it, which is what the next scroll goes by. */
    get scrollPlace(): { x: number; y: number } {
        return this.scrollRun?.to ?? { x: this.viewport.scrollLeft, y: this.viewport.scrollTop };
    }

    /* Stops a scroll on its way where it is. */
    cancelScroll(): void {
        if (this.scrollRun !== null) {
            this.document.defaultView?.cancelAnimationFrame?.(this.scrollRun.frame);
            this.scrollRun = null;
        }
    }

    /* Whether a person asked their system for less motion. */
    private reducedMotion(): boolean {
        return this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    }

    /*
     * Takes the view to a place: at once when it is no more than a line away, there is no frame to move it
     * in or motion is reduced, and over a moment otherwise. Another scroll, the wheel or a touch ends it.
     */
    scrollTo(x: number, y: number, animate = true): void {
        this.cancelScroll();
        const view = this.document.defaultView;
        const distance = Math.hypot(x - this.viewport.scrollLeft, y - this.viewport.scrollTop);
        const duration = scrollDuration(distance, this.layout.metrics.lineHeight);
        if (!animate || duration === 0 || view?.requestAnimationFrame === undefined || this.reducedMotion()) {
            this.viewport.scrollTop = y;
            this.viewport.scrollLeft = x;
            return;
        }
        const run = { frame: 0, from: { x: this.viewport.scrollLeft, y: this.viewport.scrollTop }, to: { x, y }, start: null as number | null, duration };
        const step = (time: number): void => {
            if (this.scrollRun !== run || this.disposed) {
                return;
            }
            run.start ??= time;
            const fraction = Math.min(1, (time - run.start) / run.duration);
            const eased = easeOut(fraction);
            this.viewport.scrollTop = Math.round(run.from.y + (run.to.y - run.from.y) * eased);
            this.viewport.scrollLeft = Math.round(run.from.x + (run.to.x - run.from.x) * eased);
            if (fraction >= 1) {
                this.scrollRun = null;
                return;
            }
            run.frame = view.requestAnimationFrame(step);
        };
        this.scrollRun = run;
        run.frame = view.requestAnimationFrame(step);
    }

    /* Scrolls an offset into view the way `kind` asks; the pinned headers at the top count as not being view. */
    revealOffset(offset: number, kind: ScrollKind = 'relative', animate = true): void {
        this.ensureVisible(offset);
        this.syncWrap();
        const caret = this.layout.caret(offset);
        const row = this.layout.rowForLine(this.model.positionAt(offset).line);
        const above = this.layout.rows[Math.max(0, row.index - 1)]!;
        const width = this.viewportWidth;
        this.content.style.height = `${this.layout.height}px`;
        this.content.style.width = `${Math.max(this.layout.width, width)}px`;
        // The headers pinned at the top change with the scroll, so the position is worked out again where it lands.
        const place = this.scrollPlace;
        let cover = this.stickyHeightAt(place.y);
        let position = place;
        for (let attempt = 0; attempt < 3; attempt++) {
            position = scrollPosition(
                {
                    target: { x: caret.x, y: caret.y },
                    view: { x: place.x, y: place.y + cover, width, height: this.viewportHeight - cover },
                    content: { width: Math.max(this.layout.width, width), height: this.layout.height },
                    lineHeight: this.layout.metrics.lineHeight,
                    charWidth: this.layout.metrics.charWidth,
                    topBound: above.top,
                    bottomBound: row.top + row.height + this.layout.metrics.lineHeight,
                    refrain: REFRAIN_FROM_SCROLLING,
                    horizontal: !this.settings.wrap,
                    inset: cover
                },
                kind
            );
            const next = this.stickyHeightAt(position.y);
            if (next === cover) {
                break;
            }
            cover = next;
        }
        this.scrollTo(position.x, position.y, animate);
        this.requestRender();
    }

    revealCaret(kind: ScrollKind = 'relative'): void {
        this.revealOffset(this.model.getPrimary().head, kind);
    }

    /* What a regular expression replacement writes for the match the find is on, drawn under that match; null takes it away. */
    setReplacePreview(replacement: string | null, preserveCase = false): void {
        this.replacePreview = replacement === null ? null : { text: replacement, preserveCase };
        this.paintPreview();
    }

    /* Shown only when it says something the replacement text does not, as a regular expression's does. */
    private paintPreview(): void {
        const mark = this.find.currentMark;
        const query = this.find.activeQuery;
        const wanted = this.replacePreview;
        let shown: string | null = null;
        if (wanted !== null && mark !== null && query?.regex === true) {
            try {
                const match = this.model.find(query.text, {
                    caseSensitive: query.caseSensitive,
                    wholeWord: query.wholeWord,
                    regex: true,
                    from: mark.from,
                    to: mark.to,
                    maxResults: 1
                })[0];
                const text = match === undefined ? wanted.text : replacementText(this.model.getText(), match, wanted.text, false, wanted.preserveCase);
                shown = text === wanted.text ? null : text;
            } catch {
                shown = null;
            }
        }
        this.preview.hidden = shown === null;
        if (shown === null || mark === null) {
            return;
        }
        const start = this.layout.caret(mark.from);
        const end = this.layout.caret(mark.to);
        this.preview.textContent = shown;
        this.preview.style.left = `${(start.x + end.x) / 2}px`;
        this.preview.style.top = `${end.y + end.height}px`;
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
        if (mark) {
            this.revealOffset(mark.from, 'center');
        }
    }

    /* Colors the lines on and just past the screen, a slice at a time so typing never waits on a grammar. */
    colorAhead(immediate = false): void {
        if (this.disposed || !this.tokens.ready) {
            return;
        }
        clearTimeout(this.colorTimer);
        const target = this.layout.rowAt(this.scrollTop + this.viewportHeight).line + COLOR_MARGIN;
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

    /*
     * The viewport scrolled, by the wheel, a scroll bar or the browser. A scroll event comes before the
     * frame's paint, so drawing here puts the rows, the pinned headers and the overlays in the frame the
     * scroll shows in; a render already queued for this frame follows right after.
     */
    scrolled(): void {
        if (this.frame === undefined && (this.viewport.scrollTop !== this.renderedScroll.top || this.viewport.scrollLeft !== this.renderedScroll.left)) {
            this.render();
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
            this.frameGeometry = {
                top: this.viewport.scrollTop,
                left: this.viewport.scrollLeft,
                width: this.viewport.clientWidth,
                height: this.viewport.clientHeight
            };
            let rows = this.layout.visibleRows(this.scrollTop, this.viewportHeight, this.overscan);
            if (this.layout.syncRows(rows)) {
                rows = this.layout.visibleRows(this.scrollTop, this.viewportHeight, this.overscan);
            }
            const lastLine = rows.at(-1)?.line ?? 0;
            const firstRow = this.layout.rowAt(this.scrollTop);
            this.topAnchor = { offset: this.model.getLine(firstRow.line).start, delta: this.scrollTop - firstRow.top };
            if (lastLine - this.tokens.colored <= COLOR_MARGIN * 4) {
                this.tokens.advance(lastLine, FIRST_PAINT_MS);
            }
            const paint = {
                layoutVersion: this.layoutVersion,
                whitespace: this.settings.whitespace,
                tokensOf: (line: number) => this.styledTokensOf(line),
                viewportWidth: this.viewportWidth - RIGHT_PADDING,
                hostLeft: this.scrollLeft - this.gutterWidth,
                hostWidth: this.viewportWidth + this.gutterWidth,
                onUnfold: (line: number) => this.toggleFold(line, false)
            };
            if (this.painter.paint(rows, paint)) {
                rows = this.layout.visibleRows(this.scrollTop, this.viewportHeight, this.overscan);
                this.painter.paint(rows, paint);
            }
            this.content.style.height = `${this.layout.height}px`;
            this.content.style.width = `${Math.max(this.layout.width, this.viewportWidth)}px`;
            this.renderedScroll = { top: this.scrollTop, left: this.scrollLeft };
            this.paintDecorations(rows);
            this.paintPreview();
            this.paintSticky();
            this.paintOverview();
            this.paintRemote();
            this.paintLineActions();
            if (this.attributionPointer !== null) {
                this.refreshAttributionHover();
            }
            this.announceScope();
            this.announceView();
            this.colorAhead();
        } finally {
            this.frameGeometry = null;
            this.rendering = false;
        }
    }

    private paintDecorations(rows: readonly LayoutRow[]): void {
        const selections = this.model.getSelections();
        const primary = this.model.getPrimary();
        const focused = this.focused;
        const foldable = new Map<number, boolean>();
        for (const range of this.foldRanges) {
            foldable.set(range.startLine, (foldable.get(range.startLine) ?? false) || this.collapsed.has(range.from));
        }
        const lastRow = rows.at(-1);
        const firstLine = rows[0]?.line ?? 0;
        const lastLine = lastRow?.kind === 'text' ? lastRow.lastLine : (lastRow?.line ?? 0);
        const highlighted = this.highlightedLines(firstLine, lastLine);
        paintGutter(this.gutterLines, this.layout, rows, {
            changes: this.changedLines(rows),
            attribution: this.attributedLines(firstLine, lastLine),
            highlights: highlighted,
            activeLines: new Set(selections.map((selection) => this.model.positionAt(selection.head).line)),
            foldable,
            action: this.gutterAction,
            markers: this.markersByLine()
        });
        const marks: { className: string; rects: LayoutRect[]; background?: string }[] = this.highlightMarks(rows, highlighted);
        const row = this.layout.rowForLine(this.model.positionAt(primary.head).line);
        const currentLine =
            primary.anchor === primary.head && row.kind === 'text'
                ? { x: 0, y: row.top, width: Math.max(this.layout.width, this.viewportWidth), height: row.height }
                : null;
        for (const kind of ['text', 'read', 'write'] as const) {
            const group = this.occurrences.filter((mark) => (mark.kind ?? 'text') === kind);
            if (group.length > 0) {
                marks.push({
                    className: kind === 'write' ? 'se-occurrence se-occurrence-write' : 'se-occurrence',
                    rects: group.flatMap((mark) => this.layout.rectangles(mark.from, mark.to, rows))
                });
            }
        }
        const marginX = this.settings.rightMargin === null ? null : this.settings.rightMargin * this.layout.metrics.charWidth;
        // A margin past the content would stretch the scroll extent to itself, so it shows only where the text or the view reaches it.
        if (marginX !== null && marginX < Math.max(this.layout.width, this.viewportWidth)) {
            marks.push({ className: 'se-margin', rects: [{ x: marginX, y: 0, width: 1, height: this.layout.height }] });
        }
        if (this.settings.guides) {
            const guides = this.guideRects(rows);
            marks.push({ className: 'se-guide', rects: guides.plain }, { className: 'se-guide se-guide-active', rects: guides.active });
        }
        paintSigns(this.signs, this.wrapSigns(rows), this.layout.metrics.lineHeight);
        const alike = this.selectionOccurrences();
        if (alike.length > 0) {
            marks.push({ className: 'se-occurrence', rects: alike.flatMap((range) => this.layout.rectangles(range.from, range.to, rows)) });
        }
        const faded: LayoutRect[] = [];
        const struck: LayoutRect[] = [];
        for (const marker of this.markers) {
            if (marker.to <= marker.from) {
                continue;
            }
            const rects = this.layout.rectangles(marker.from, marker.to, rows);
            if (marker.severity !== 'hint') {
                marks.push({ className: `se-squiggle se-squiggle-${marker.severity}`, rects });
            }
            if (marker.unnecessary) {
                faded.push(...rects);
            }
            if (marker.deprecated) {
                struck.push(...rects);
            }
        }
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
        paintOver(this.over, [
            { className: 'se-faded', rects: faded },
            { className: 'se-struck', rects: struck },
            { className: 'se-link', rects: this.link === null ? [] : this.layout.rectangles(this.link.from, this.link.to, rows) }
        ]);
        const top = this.scrollTop;
        const caretRects = focused
            ? selections
                  .map((selection) => ({ ...this.caretOf(selection.head), primary: selection === selections.at(-1) }))
                  .filter((rect) => rect.y + rect.height >= top - rect.height && rect.y <= top + this.viewportHeight)
            : [];
        const caretKey = caretRects.map((rect) => `${rect.x},${rect.y}`).join(' ');
        if (caretKey !== this.caretKey) {
            this.caretKey = caretKey;
            this.carets.dataset.moving = 'true';
            clearTimeout(this.caretTimer);
            this.caretTimer = setTimeout(() => delete this.carets.dataset.moving, CARET_SOLID_MS);
        }
        paintCarets(this.carets, [...caretRects, ...(this.dropCaret === null ? [] : [{ ...this.layout.caret(this.dropCaret), primary: false, drop: true }])]);
        const caret = this.caretOf(primary.head);
        this.input.style.left = `${this.gutterWidth + Math.max(0, Math.min(this.viewportWidth - 2, caret.x - this.scrollLeft))}px`;
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

    /* The carets of agents, each at an offset that follows its text through edits until the host sets them again. */
    setRemoteCarets(carets: readonly { id: string; name: string; color: string; at: number }[]): void {
        this.remoteCarets = carets.map((caret) => ({ ...caret }));
        this.remoteKey = null;
        this.render();
    }

    private paintRemote(): void {
        const lineHeight = this.layout.metrics.lineHeight;
        const top = this.scrollTop;
        const cover = this.stickyHeightAt(top);
        const carets: RemoteCaret[] = [];
        for (const remote of this.remoteCarets) {
            const line = this.model.positionAt(remote.at).line;
            const row = this.layout.rowForLine(line);
            if (row.kind !== 'text' || row.line !== line) {
                continue;
            }
            const place = this.layout.caret(remote.at);
            const x = Math.round(place.x);
            const y = Math.round(place.y);
            if (y + lineHeight < top - REMOTE_LABEL_HEIGHT || y > top + this.viewportHeight) {
                continue;
            }
            carets.push({ id: remote.id, name: remote.name, color: remote.color, x, y, height: lineHeight, below: y - top - cover < REMOTE_LABEL_HEIGHT });
        }
        const key = carets.map((caret) => `${caret.id}|${caret.name}|${caret.color}|${caret.x},${caret.y},${caret.below}`).join('\n');
        if (key !== this.remoteKey) {
            this.remoteKey = key;
            paintRemoteCarets(this.remote, carets);
        }
    }

    /* The host's own DOM after the end of a line, which stays on its line through edits until the owner sets its actions again. */
    setLineActions(owner: string, actions: readonly { id: string; at: number; render: (container: HTMLElement) => void }[]): void {
        if (actions.length === 0) {
            if (!this.lineActions.has(owner)) {
                return;
            }
            this.lineActions.delete(owner);
        } else {
            this.lineActions.set(owner, [...actions]);
        }
        const wanted = new Set([...this.lineActions].flatMap(([name, entries]) => entries.map((entry) => `${name}\0${entry.id}`)));
        for (const [key, element] of [...this.actionElements]) {
            if (!wanted.has(key)) {
                element.remove();
                this.actionElements.delete(key);
            }
        }
        this.render();
    }

    private paintLineActions(): void {
        const lineHeight = this.layout.metrics.lineHeight;
        const top = this.scrollTop;
        for (const [owner, entries] of this.lineActions) {
            for (const entry of entries) {
                const key = `${owner}\0${entry.id}`;
                let element = this.actionElements.get(key);
                if (element === undefined) {
                    element = this.document.createElement('div');
                    element.className = 'se-line-action';
                    element.addEventListener('pointerdown', (event) => event.stopPropagation());
                    element.addEventListener('mousedown', (event) => event.stopPropagation());
                    this.actions.append(element);
                    this.actionElements.set(key, element);
                    entry.render(element);
                }
                const line = this.model.positionAt(entry.at).line;
                const row = this.layout.rowForLine(line);
                const place = row.kind === 'text' && row.line === line ? this.layout.caret(this.model.getLine(line).end) : null;
                if (place === null || place.y + lineHeight < top - this.viewportHeight || place.y > top + 2 * this.viewportHeight) {
                    element.hidden = true;
                    continue;
                }
                element.hidden = false;
                element.style.left = `${Math.round(place.x) + LINE_ACTION_GAP}px`;
                element.style.top = `${Math.round(place.y)}px`;
                element.style.height = `${lineHeight}px`;
            }
        }
    }

    /* Bars in the gutter for runs of lines, which follow their text through edits until the host sets them again. */
    setAttributionMarks(marks: readonly { id: string; startLine: number; endLine: number; color: string }[]): void {
        this.attribution.set(marks, this.model.getLineCount(), (line) => this.model.getLine(line));
        this.render();
    }

    /* Lines the host tinted, which follow their text through edits until it sets them again. */
    setLineHighlights(highlights: readonly { startLine: number; endLine: number; color: string; sign?: string; fill?: string }[]): void {
        this.highlights.set(
            highlights.map((highlight) => ({ id: '', ...highlight })),
            this.model.getLineCount(),
            (line) => this.model.getLine(line)
        );
        this.render();
    }

    private highlightedLines(first: number, last: number): Map<number, AttributedLines> {
        return this.highlights.linesIn(
            first,
            last,
            this.model.getLine(first).start,
            this.model.getLine(last).end,
            (offset) => this.model.positionAt(offset).line
        );
    }

    /* One box per row, so a row of the host's between two tinted lines stays clear. */
    private highlightMarks(
        rows: readonly LayoutRow[],
        lines: ReadonlyMap<number, AttributedLines>
    ): { className: string; rects: LayoutRect[]; background: string }[] {
        const byBackground = new Map<string, LayoutRect[]>();
        const width = Math.max(this.layout.width, this.viewportWidth);
        for (const row of rows) {
            const highlight = row.kind === 'text' ? lines.get(row.line) : undefined;
            if (highlight !== undefined) {
                const background = highlight.fill === undefined ? tintValue(highlight.color) : colorValue(highlight.fill);
                const rects = byBackground.get(background) ?? [];
                rects.push({ x: 0, y: row.top, width, height: row.height });
                byBackground.set(background, rects);
            }
        }
        return [...byBackground].map(([background, rects]) => ({ className: 'se-line-highlight', rects, background }));
    }

    /* Code that is not in the document, drawn in the editor's own face and colors. */
    renderCode(container: HTMLElement, text: string, options: EditorCodeBlockOptions): void {
        renderCodeBlock(container, text, this.tokens.tokenizeText(text.split(/\r?\n/)), this.settings.tabSize, options);
    }

    private attributedLines(first: number, last: number): Map<number, AttributedLines> {
        return this.attribution.linesIn(
            first,
            last,
            this.model.getLine(first).start,
            this.model.getLine(last).end,
            (offset) => this.model.positionAt(offset).line
        );
    }

    onAttributionHover(listener: (hover: { id: string; rect: EditorRect } | null) => void): () => void {
        this.attributionListeners.add(listener);
        return () => {
            this.attributionListeners.delete(listener);
        };
    }

    /* The bar is three pixels wide, so the pointer finds it a few pixels to either side. */
    private wireAttribution(): void {
        this.gutter.addEventListener('pointermove', (event) => {
            this.attributionPointer = { x: event.clientX, y: event.clientY };
            this.refreshAttributionHover();
        });
        this.gutter.addEventListener('pointerleave', () => {
            this.attributionPointer = null;
            this.refreshAttributionHover();
        });
    }

    private refreshAttributionHover(): void {
        const next = this.attributionPointer === null ? null : this.attributionUnder(this.attributionPointer.x, this.attributionPointer.y);
        const before = this.attributionHover;
        if (before === next || (before !== null && next !== null && before.id === next.id && sameRect(before.rect, next.rect))) {
            return;
        }
        this.attributionHover = next;
        for (const listener of [...this.attributionListeners]) {
            listener(next);
        }
    }

    private attributionUnder(clientX: number, clientY: number): { id: string; rect: EditorRect } | null {
        if (this.attribution.size === 0) {
            return null;
        }
        const point = this.contentPoint(clientX, clientY);
        const fromEdge = this.gutterWidth - (point.x + this.gutterWidth - this.viewport.scrollLeft);
        if (fromEdge < -ATTRIBUTION_REACH || fromEdge > ATTRIBUTION_REACH + ATTRIBUTION_WIDTH || point.y < 0 || point.y > this.layout.height) {
            return null;
        }
        const row = this.layout.rowAt(point.y);
        if (row.kind !== 'text') {
            return null;
        }
        const bar = this.attributedLines(row.line, row.line).get(row.line);
        if (bar === undefined) {
            return null;
        }
        const origin = this.viewport.getBoundingClientRect?.();
        const scale = origin ? this.screenScale(origin) : { x: 1, y: 1 };
        const right = (origin?.left ?? 0) + this.gutterWidth * scale.x;
        const top = (origin?.top ?? 0) + (row.top - this.viewport.scrollTop) * scale.y;
        return { id: bar.id, rect: { left: right - ATTRIBUTION_WIDTH * scale.x, top, right, bottom: top + row.height * scale.y } };
    }

    /* The first and last line in view, zero-based. */
    visibleLines(): { first: number; last: number } {
        const top = this.scrollTop;
        return { first: this.layout.rowAt(top).line, last: this.layout.rowAt(top + this.viewportHeight).line };
    }

    /* A problem's tick says what the problem is when the pointer rests on it, and a press goes to it. The rest of the track lets the pointer through. */
    private wireOverview(): void {
        const tickOf = (event: Event): HTMLElement | null => (event.target as HTMLElement | null)?.closest?.<HTMLElement>('.se-tick[data-offset]') ?? null;
        this.overview.addEventListener('pointerover', (event) => {
            const tick = tickOf(event);
            const title = tick?.getAttribute('data-title');
            if (tick === null || !title) {
                this.tickTip.hidden = true;
                return;
            }
            this.tickTip.textContent = title;
            this.tickTip.style.top = tick.style.top;
            this.tickTip.hidden = false;
        });
        this.overview.addEventListener('pointerout', () => {
            this.tickTip.hidden = true;
        });
        this.overview.addEventListener('pointerdown', (event) => {
            const tick = tickOf(event);
            if (tick !== null) {
                event.preventDefault();
                this.jumpTo(Number(tick.getAttribute('data-offset')));
            }
        });
    }

    /* Puts the caret on an offset, in the middle of the view, and gives the editor the keyboard. */
    private jumpTo(offset: number): void {
        this.model.setSelections([{ anchor: offset, head: offset }]);
        this.revealOffset(offset, 'center');
        this.focus();
    }

    /* The find matches and the changes as ticks in the scroll track, redrawn when what they stand on changes. */
    private paintOverview(): void {
        const trackHeight = this.viewportHeight;
        const matches = this.find.matches;
        const current = this.find.current;
        const alike = this.selectionOccurrences();
        const key = `${this.revision}|${this.changeVersion}|${this.markerVersion}|${this.layout.height}|${trackHeight}|${matches.length}|${current}|${matches[0]?.from}|${matches.at(-1)?.from}|${this.selectionOccurrenceCache.key}`;
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
        for (const marker of this.markers) {
            if (marker.severity !== 'hint' && marker.to > marker.from) {
                const start = this.model.positionAt(marker.from).line;
                const end = this.model.positionAt(marker.to).line;
                spans.push({
                    kind: marker.severity,
                    top: rowTop(start),
                    bottom: rowBottom(end),
                    offset: marker.from,
                    ...(marker.message === undefined ? {} : { title: marker.message })
                });
            }
        }
        for (const range of alike) {
            const line = this.model.positionAt(range.from).line;
            spans.push({ kind: 'occurrence', top: rowTop(line), bottom: rowBottom(line) });
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
        const line = this.model.positionAt(this.model.getPrimary().head).line;
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
        const placements = this.scrollTop <= 0 ? [] : this.stickyAt(this.scrollTop);
        const entries = placements.map((placement): StickyEntry => {
            const row = this.layout.rowForLine(placement.block.startLine) as TextRow;
            return { line: placement.block.startLine, geometry: this.layout.geometry(row), tokens: this.styledTokensOf(placement.block.startLine) };
        });
        const changed =
            entries.length !== this.stickyEntries.length ||
            entries.some((entry, index) => {
                const before = this.stickyEntries[index]!;
                return entry.line !== before.line || entry.geometry !== before.geometry || entry.tokens !== before.tokens;
            });
        this.sticky.hidden = entries.length === 0;
        this.sticky.style.setProperty('--se-scroll-left', `${this.scrollLeft}px`);
        this.sticky.style.width = `${this.clientWidth}px`;
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

    setGutterAction(action: { line: number; label: string } | null): void {
        if (action?.line === this.gutterAction?.line && action?.label === this.gutterAction?.label) {
            return;
        }
        this.gutterAction = action;
        this.render();
    }

    onGutterAction(listener: (line: number) => void): () => void {
        this.gutterActionListeners.add(listener);
        return () => {
            this.gutterActionListeners.delete(listener);
        };
    }

    setGutterMarkers(owner: string, markers: readonly { id: string; line: number; label: string }[]): void {
        const before = this.gutterMarkers.get(owner) ?? [];
        if (
            before.length === markers.length &&
            before.every((marker, index) => marker.id === markers[index]!.id && marker.line === markers[index]!.line && marker.label === markers[index]!.label)
        ) {
            return;
        }
        if (markers.length === 0) {
            this.gutterMarkers.delete(owner);
        } else {
            this.gutterMarkers.set(owner, markers);
        }
        this.render();
    }

    onGutterMarker(listener: (id: string) => void): () => void {
        this.gutterMarkerListeners.add(listener);
        return () => {
            this.gutterMarkerListeners.delete(listener);
        };
    }

    /* The id of the host's gutter marker when the target is it. */
    gutterMarkerIdOf(target: EventTarget | null): string | null {
        const button = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-gutter-marker]');
        return button?.dataset.gutterMarker ?? null;
    }

    pressGutterMarker(id: string): void {
        for (const listener of [...this.gutterMarkerListeners]) {
            listener(id);
        }
    }

    /* One marker per line: where two owners mark the same line, the owner named first stays. */
    private markersByLine(): ReadonlyMap<number, { id: string; label: string }> {
        const byLine = new Map<number, { id: string; label: string }>();
        for (const owner of [...this.gutterMarkers.keys()].sort()) {
            for (const marker of this.gutterMarkers.get(owner)!) {
                if (!byLine.has(marker.line)) {
                    byLine.set(marker.line, { id: marker.id, label: marker.label });
                }
            }
        }
        return byLine;
    }

    /* The line of the host's gutter button when the target is it. */
    gutterActionLineOf(target: EventTarget | null): number | null {
        const button = (target as HTMLElement | null)?.closest?.('[data-gutter-action]');
        return button ? Number((button as HTMLElement).dataset.gutterAction) : null;
    }

    pressGutterAction(line: number): void {
        for (const listener of [...this.gutterActionListeners]) {
            listener(line);
        }
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
        this.cancelScroll();
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
        this.viewListeners.clear();
        this.hoverListeners.clear();
        this.gutterActionListeners.clear();
        this.gutterMarkerListeners.clear();
        this.gutterMarkers.clear();
        this.tracked.clear();
        this.remoteCarets = [];
        this.lineActions.clear();
        this.actionElements.clear();
        this.attribution.clear();
        this.highlights.clear();
        this.attributionListeners.clear();
        this.painter.clear();
        this.root.remove();
    }
}

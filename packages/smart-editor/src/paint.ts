import { type EditorLayout, type LayoutRect, type LayoutRow, type LineGeometry, scanLine, type TextRow } from './layout.ts';
import type { EditorChangeKind, LineToken } from './types.ts';

const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;
const STRIKETHROUGH = 8;

interface PaintedRow {
    element: HTMLElement;
    text: string;
    tokens: readonly LineToken[] | null;
    layoutVersion: number;
    folded: boolean;
    /* What a collapsed fold keeps drawn after its placeholder, and the colors of the line it is from. */
    tail: string;
    tailTokens: readonly LineToken[] | null;
}

/* The gap around a collapsed fold's placeholder, so it reads as `{…}` and not as three separate things. */
const FOLD_GAP = 4;
const FOLD_CHIP_PADDING = 12;

export interface RowPaint {
    /* Changes whenever the metrics, the wrapping or the inlays do, which moves every character. */
    layoutVersion: number;
    tokensOf(line: number): readonly LineToken[] | null;
    viewportWidth: number;
    /* Where a row of the host's own DOM starts and how wide it is: the whole width of the editor, over the gutter, wherever the text is scrolled to. */
    hostLeft: number;
    hostWidth: number;
    /* A collapsed fold's row draws a chip after its line. */
    onUnfold(line: number): void;
}

function styleSpan(span: HTMLElement, token: LineToken): void {
    if (token.color !== '') {
        span.style.color = token.color;
    }
    if (token.fontStyle & ITALIC) {
        span.style.fontStyle = 'italic';
    }
    if (token.fontStyle & BOLD) {
        span.style.fontWeight = 'bold';
    }
    const decorations = [token.fontStyle & UNDERLINE ? 'underline' : '', token.fontStyle & STRIKETHROUGH ? 'line-through' : ''].filter(Boolean);
    if (decorations.length > 0) {
        span.style.textDecoration = decorations.join(' ');
    }
}

/* The text of one run, split along the colors of the line. `tokensFrom` is the offset the first token starts at, which is the geometry's own start unless it is a slice of a line. */
function fillRun(run: HTMLElement, geometry: LineGeometry, from: number, to: number, tokens: readonly LineToken[] | null, tokensFrom = geometry.start): void {
    if (tokens === null) {
        run.textContent = geometry.text.slice(from - geometry.start, to - geometry.start);
        return;
    }
    let tokenStart = tokensFrom;
    for (const token of tokens) {
        const tokenEnd = tokenStart + token.length;
        const start = Math.max(from, tokenStart);
        const end = Math.min(to, tokenEnd);
        if (start < end) {
            const span = run.ownerDocument.createElement('span');
            span.textContent = geometry.text.slice(start - geometry.start, end - geometry.start);
            styleSpan(span, token);
            run.append(span);
        }
        tokenStart = tokenEnd;
        if (tokenStart >= to) {
            break;
        }
    }
}

/* One line of text as absolutely placed runs and inlays. `firstRowOnly` leaves out what a wrapped line carries onto later visual lines. */
export function lineElement(
    document: Document,
    geometry: LineGeometry,
    tokens: readonly LineToken[] | null,
    lineHeight: number,
    firstRowOnly: boolean
): HTMLElement {
    const element = document.createElement('div');
    element.className = 'se-line';
    element.style.width = `${geometry.width}px`;
    for (const run of geometry.runs) {
        if (firstRowOnly && run.subRow > 0) {
            continue;
        }
        const span = document.createElement('span');
        span.className = 'se-run';
        span.style.left = `${run.x}px`;
        span.style.top = `${run.subRow * lineHeight}px`;
        fillRun(span, geometry, run.from, run.to, tokens);
        element.append(span);
    }
    for (const box of geometry.inlays) {
        if (firstRowOnly && box.subRow > 0) {
            continue;
        }
        const span = document.createElement('span');
        span.className = box.inlay.composition ? 'se-composition' : 'se-inlay';
        span.dataset.inlayId = box.inlay.id;
        span.textContent = box.inlay.text;
        span.style.left = `${box.x}px`;
        span.style.top = `${box.subRow * lineHeight}px`;
        span.style.width = `${box.width}px`;
        element.append(span);
    }
    return element;
}

/*
 * The text layer: one element per visible row, kept while what it shows stays the same. A line is
 * drawn as absolutely placed runs of text, so the layout alone decides where each character is and
 * the browser only has to paint it.
 */
export class RowPainter {
    private readonly rows = new Map<string, PaintedRow>();
    private readonly code: HTMLElement;
    private readonly layout: EditorLayout;
    private readonly observer: ResizeObserver | undefined;

    constructor(code: HTMLElement, layout: EditorLayout, observer: ResizeObserver | undefined) {
        this.code = code;
        this.layout = layout;
        this.observer = observer;
    }

    /* Draws the rows and takes the rest away. Returns whether a widget's height moved the layout. */
    paint(rows: readonly LayoutRow[], paint: RowPaint): boolean {
        const visible = new Set(rows.map((row) => row.key));
        for (const [key, entry] of this.rows) {
            if (!visible.has(key)) {
                this.observer?.unobserve(entry.element);
                entry.element.remove();
                this.rows.delete(key);
            }
        }
        let measured = false;
        for (const row of rows) {
            if (row.kind === 'text') {
                this.paintText(row, paint);
            } else {
                measured = this.paintBlock(row, paint) || measured;
            }
        }
        return measured;
    }

    private paintText(row: TextRow, paint: RowPaint): void {
        const geometry = this.layout.geometry(row);
        const tokens = paint.tokensOf(row.line);
        const folded = row.lastLine > row.line;
        const lastLine = folded && row.tail !== null ? this.layout.document.getLine(row.lastLine) : null;
        const tail = lastLine === null ? '' : lastLine.text.slice(row.tail! - lastLine.start);
        const tailTokens = tail === '' ? null : paint.tokensOf(row.lastLine);
        let entry = this.rows.get(row.key);
        if (
            !entry ||
            entry.text !== geometry.text ||
            entry.tokens !== tokens ||
            entry.layoutVersion !== paint.layoutVersion ||
            entry.folded !== folded ||
            entry.tail !== tail ||
            entry.tailTokens !== tailTokens
        ) {
            const element = this.buildText(row, geometry, tokens, paint, tail, tailTokens);
            if (entry) {
                entry.element.replaceWith(element);
            } else {
                this.code.append(element);
            }
            entry = { element, text: geometry.text, tokens, layoutVersion: paint.layoutVersion, folded, tail, tailTokens };
            this.rows.set(row.key, entry);
        }
        entry.element.style.top = `${row.top}px`;
        entry.element.style.height = `${row.height}px`;
        entry.element.dataset.line = String(row.line);
    }

    private buildText(
        row: TextRow,
        geometry: LineGeometry,
        tokens: readonly LineToken[] | null,
        paint: RowPaint,
        tail: string,
        tailTokens: readonly LineToken[] | null
    ): HTMLElement {
        const document = this.code.ownerDocument;
        const lineHeight = this.layout.metrics.lineHeight;
        const element = lineElement(document, geometry, tokens, lineHeight, false);
        if (row.lastLine > row.line) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'se-fold-chip';
            chip.textContent = '…';
            chip.tabIndex = -1;
            const chipLeft = geometry.rowEnds[geometry.rowEnds.length - 1]! + FOLD_GAP;
            const chipWidth = Math.ceil(this.layout.metrics.charWidth) + FOLD_CHIP_PADDING;
            chip.style.left = `${chipLeft}px`;
            chip.style.top = `${(geometry.subRows - 1) * lineHeight}px`;
            chip.style.width = `${chipWidth}px`;
            chip.addEventListener('pointerdown', (event) => event.stopPropagation());
            chip.addEventListener('click', () => paint.onUnfold(row.line));
            element.append(chip);
            if (tail !== '' && row.tail !== null) {
                this.appendTail(element, row, geometry, tail, tailTokens, chipLeft + chipWidth + FOLD_GAP);
            }
        }
        return element;
    }

    /* The closing delimiter of a collapsed fold, laid out as a line of its own that starts after the placeholder. */
    private appendTail(element: HTMLElement, row: TextRow, header: LineGeometry, tail: string, tokens: readonly LineToken[] | null, left: number): void {
        const document = this.code.ownerDocument;
        const lineStart = this.layout.document.getLine(row.lastLine).start;
        const geometry = scanLine({ start: row.tail!, end: row.tail! + tail.length, text: tail }, this.layout.metrics, null, []);
        for (const run of geometry.runs) {
            const span = document.createElement('span');
            span.className = 'se-run';
            span.style.left = `${left + run.x}px`;
            span.style.top = `${(header.subRows - 1) * this.layout.metrics.lineHeight}px`;
            fillRun(span, geometry, run.from, run.to, tokens, lineStart);
            element.append(span);
        }
    }

    private paintBlock(row: Extract<LayoutRow, { kind: 'block' }>, paint: RowPaint): boolean {
        let entry = this.rows.get(row.key);
        if (!entry) {
            const element = this.code.ownerDocument.createElement('div');
            element.className = 'se-block';
            element.dataset.rowKey = row.key;
            element.dataset.widgetId = row.widget.id;
            if (row.widget.render) {
                row.widget.render(element);
            } else {
                element.textContent = row.widget.text ?? '';
            }
            this.code.append(element);
            this.observer?.observe(element);
            entry = { element, text: '', tokens: null, layoutVersion: 0, folded: false, tail: '', tailTokens: null };
            this.rows.set(row.key, entry);
        }
        entry.element.style.top = `${row.top}px`;
        if (row.widget.render) {
            entry.element.style.left = `${paint.hostLeft}px`;
            entry.element.style.width = `${paint.hostWidth}px`;
        } else {
            entry.element.style.width = `${Math.max(80, paint.viewportWidth)}px`;
        }
        const height = entry.element.getBoundingClientRect?.().height ?? 0;
        return height > 0 && this.layout.setMeasuredHeight(row.key, height);
    }

    clear(): void {
        for (const entry of this.rows.values()) {
            this.observer?.unobserve(entry.element);
            entry.element.remove();
        }
        this.rows.clear();
    }
}

export interface GutterPaint {
    activeLines: ReadonlySet<number>;
    /* How the lines the host marked differ from what it compares against. */
    changes: ReadonlyMap<number, EditorChangeKind>;
    /* Lines a fold can start at, and whether each is collapsed. */
    foldable: ReadonlyMap<number, boolean>;
    /* The line that carries the host's button, and what it is called. */
    action: { line: number; label: string } | null;
}

/* The line numbers of the visible rows, and the fold control of the lines that have one. */
export function paintGutter(container: HTMLElement, layout: EditorLayout, rows: readonly LayoutRow[], paint: GutterPaint): void {
    const document = container.ownerDocument;
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
        if (row.kind !== 'text') {
            continue;
        }
        const item = document.createElement('div');
        item.className = paint.activeLines.has(row.line) ? 'se-line-number se-active-number' : 'se-line-number';
        item.style.top = `${row.top}px`;
        item.style.height = `${layout.metrics.lineHeight}px`;
        const number = document.createElement('span');
        number.textContent = String(row.line + 1);
        item.append(number);
        if (paint.action?.line === row.line) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'se-gutter-action';
            button.dataset.gutterAction = String(row.line);
            button.tabIndex = -1;
            button.setAttribute('aria-label', paint.action.label);
            item.append(button);
        }
        const change = paint.changes.get(row.line);
        if (change) {
            const mark = document.createElement('span');
            mark.className = `se-change se-change-${change}`;
            if (change !== 'deleted') {
                mark.style.height = `${row.height}px`;
            }
            item.append(mark);
        }
        const collapsed = paint.foldable.get(row.line);
        if (collapsed !== undefined) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = collapsed ? 'se-fold-toggle se-folded' : 'se-fold-toggle';
            button.dataset.foldLine = String(row.line);
            button.tabIndex = -1;
            button.setAttribute('aria-label', collapsed ? 'Expand' : 'Collapse');
            item.append(button);
        }
        fragment.append(item);
    }
    container.replaceChildren(fragment);
}

export interface OverlayPaint {
    currentLine: LayoutRect | null;
    selections: readonly LayoutRect[];
    focused: boolean;
    marks: readonly { className: string; rects: readonly LayoutRect[] }[];
}

function box(document: Document, className: string, rect: LayoutRect): HTMLElement {
    const element = document.createElement('div');
    element.className = className;
    element.style.left = `${rect.x}px`;
    element.style.top = `${rect.y}px`;
    element.style.width = `${Math.max(1, rect.width)}px`;
    element.style.height = `${rect.height}px`;
    return element;
}

/* What sits behind the text: the current line, the selections and the marks of find and brackets. */
export function paintOverlays(container: HTMLElement, paint: OverlayPaint): void {
    const document = container.ownerDocument;
    const fragment = document.createDocumentFragment();
    if (paint.currentLine) {
        fragment.append(box(document, 'se-current-line', paint.currentLine));
    }
    for (const mark of paint.marks) {
        for (const rect of mark.rects) {
            fragment.append(box(document, mark.className, rect));
        }
    }
    for (const rect of paint.selections) {
        fragment.append(box(document, paint.focused ? 'se-selection' : 'se-selection se-selection-inactive', rect));
    }
    container.replaceChildren(fragment);
}

/* What is drawn over the text, such as the fading of code nothing uses. */
export function paintOver(container: HTMLElement, layers: readonly { className: string; rects: readonly LayoutRect[] }[]): void {
    const document = container.ownerDocument;
    const fragment = document.createDocumentFragment();
    for (const layer of layers) {
        for (const rect of layer.rects) {
            fragment.append(box(document, layer.className, rect));
        }
    }
    container.replaceChildren(fragment);
}

/* The carets, above the text. */
export function paintCarets(container: HTMLElement, carets: readonly LayoutRect[]): void {
    const document = container.ownerDocument;
    container.replaceChildren(...carets.map((rect, index) => box(document, index === 0 ? 'se-caret se-primary-caret' : 'se-caret', { ...rect, width: 2 })));
}

export interface StickyEntry {
    line: number;
    geometry: LineGeometry;
    tokens: readonly LineToken[] | null;
}

/* The headers pinned at the top: a line number in the gutter's column, then the header's own text. */
export function paintSticky(container: HTMLElement, entries: readonly StickyEntry[], lineHeight: number): void {
    const document = container.ownerDocument;
    container.replaceChildren(
        ...entries.map((entry, depth) => {
            const row = document.createElement('div');
            row.className = 'se-sticky-row';
            row.dataset.line = String(entry.line);
            row.dataset.depth = String(depth);
            const number = document.createElement('span');
            number.className = 'se-sticky-number';
            number.textContent = String(entry.line + 1);
            const code = document.createElement('div');
            code.className = 'se-sticky-code';
            code.append(lineElement(document, entry.geometry, entry.tokens, lineHeight, true));
            row.append(number, code);
            return row;
        })
    );
}

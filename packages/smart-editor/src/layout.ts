import type { Position } from '@ruimte/smart-editor-core';

export type Affinity = 'before' | 'after';

export interface LayoutDocument {
    getLineCount(): number;
    getLine(line: number): { start: number; end: number; next: number; text: string };
    positionAt(offset: number): Position;
}

export interface LayoutMetrics {
    lineHeight: number;
    charWidth: number;
    tabSize: number;
    measureText(text: string): number;
    measureInlay(text: string): number;
}

/* Text drawn between two characters of a line, without being part of the document. */
export interface Inlay {
    id: string;
    at: number;
    text: string;
    tooltip?: string;
}

/* A row of the host's own DOM above or below a line, as tall as the host makes it. */
export interface BlockWidget {
    id: string;
    at: number;
    placement: 'above' | 'below';
    text?: string;
    render?: (container: HTMLElement) => void;
    height?: number;
}

/* Collapsed, it hides the lines after `startLine` through `endLine`. */
export interface FoldState {
    startLine: number;
    endLine: number;
    collapsed: boolean;
}

interface RowBase {
    key: string;
    index: number;
    /* The first document line the row stands for. */
    line: number;
    top: number;
    height: number;
}

export interface TextRow extends RowBase {
    kind: 'text';
    /* The last document line the row covers: more than `line` when a fold hides the lines after it. */
    lastLine: number;
    /* Visual lines, which is more than one for a wrapped line. */
    subRows: number;
}

export interface BlockRow extends RowBase {
    kind: 'block';
    widget: BlockWidget;
}

export type LayoutRow = TextRow | BlockRow;

export interface TextRun {
    from: number;
    to: number;
    x: number;
    /* The visual line of the document line the run is on. */
    subRow: number;
    text: string;
}

export interface InlineBox {
    inlay: Inlay;
    x: number;
    width: number;
    subRow: number;
}

/* Where every character of one document line is, relative to the line's own origin. */
export interface LineGeometry {
    start: number;
    end: number;
    text: string;
    /* UTF-16 offsets into the line at which a character begins, then the line's length. */
    offsets: number[];
    /* The x of each stop before and after the inlays that sit on it. */
    before: number[];
    after: number[];
    /* The visual line each stop is on. */
    rowOf: number[];
    /* The stop each visual line starts at. */
    rowStarts: number[];
    /* The x each visual line ends at. */
    rowEnds: number[];
    runs: TextRun[];
    inlays: InlineBox[];
    subRows: number;
    width: number;
}

export interface LayoutRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export const TEXT_PADDING = 0;
export const BOTTOM_PADDING = 8;
export const RIGHT_PADDING = 16;
const DEFAULT_BLOCK_HEIGHT = 40;
const GEOMETRY_CACHE_SIZE = 400;
const PLAIN = /^[\x20-\x7e\t]*$/;
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function lowerBound(values: readonly number[], value: number): number {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (values[middle]! < value) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

/* Where each character starts, with the length last. A line that long is cut by code unit, since splitting it by grapheme would cost more than it shows. */
function characterOffsets(text: string): number[] {
    const offsets: number[] = [];
    if (text.length > 20000 || PLAIN.test(text)) {
        for (let i = 0; i < text.length; i++) {
            offsets.push(i);
        }
    } else {
        for (const part of SEGMENTER.segment(text)) {
            offsets.push(part.index);
        }
    }
    offsets.push(text.length);
    return offsets;
}

function isSpace(character: string | undefined): boolean {
    return character === ' ' || character === '\t';
}

function characterWidth(metrics: LayoutMetrics, text: string, x: number): number {
    if (text === '\t') {
        const tab = metrics.tabSize * metrics.charWidth;
        return (Math.floor(x / tab) + 1) * tab - x;
    }
    return text.length === 1 && text >= ' ' && text <= '~' ? metrics.charWidth : metrics.measureText(text);
}

/*
 * The stops at which a wrapped line starts a new visual line, after the space a word ends in when
 * there is one on the visual line and in the middle of a word when there is not.
 */
export function wrapStops(text: string, offsets: readonly number[], metrics: LayoutMetrics, limit: number): number[] {
    const breaks: number[] = [];
    const count = offsets.length - 1;
    let rowStart = 0;
    let opportunity = -1;
    let x = 0;
    let index = 0;
    while (index < count) {
        const character = text.slice(offsets[index]!, offsets[index + 1]!);
        const width = characterWidth(metrics, character, x);
        if (index > rowStart && x + width > limit && !isSpace(character)) {
            const target = opportunity > rowStart ? opportunity : index;
            breaks.push(target);
            rowStart = target;
            opportunity = -1;
            x = 0;
            index = target;
            continue;
        }
        x += width;
        if (isSpace(character) && index + 1 < count && !isSpace(text[offsets[index + 1]!])) {
            opportunity = index + 1;
        }
        index++;
    }
    return breaks;
}

/* A line of text laid out against its metrics; wrapped at `limit` pixels unless that is null. */
export function scanLine(
    line: { start: number; end: number; text: string },
    metrics: LayoutMetrics,
    limit: number | null,
    lineInlays: readonly Inlay[]
): LineGeometry {
    const text = line.text;
    const offsets = characterOffsets(text);
    const breakStops = limit === null ? [] : wrapStops(text, offsets, metrics, limit);
    const geometry: LineGeometry = {
        start: line.start,
        end: line.end,
        text,
        offsets,
        before: [],
        after: [],
        rowOf: [],
        rowStarts: [0],
        rowEnds: [],
        runs: [],
        inlays: [],
        subRows: breakStops.length + 1,
        width: 0
    };
    let x = 0;
    let row = 0;
    let nextBreak = 0;
    let nextInlay = 0;
    let runStart = -1;
    let runX = 0;
    const flushRun = (end: number): void => {
        if (runStart >= 0 && end > runStart) {
            geometry.runs.push({ from: line.start + runStart, to: line.start + end, x: runX, subRow: row, text: text.slice(runStart, end) });
        }
        runStart = -1;
    };
    for (let stop = 0; stop < offsets.length; stop++) {
        const offset = offsets[stop]!;
        if (nextBreak < breakStops.length && breakStops[nextBreak] === stop) {
            flushRun(offset);
            geometry.rowEnds.push(x);
            geometry.rowStarts.push(stop);
            nextBreak++;
            row++;
            x = 0;
        }
        geometry.before.push(x);
        geometry.rowOf.push(row);
        while (nextInlay < lineInlays.length && lineInlays[nextInlay]!.at - line.start <= offset) {
            flushRun(offset);
            const inlay = lineInlays[nextInlay++]!;
            const width = Math.max(8, metrics.measureInlay(inlay.text) + 12);
            geometry.inlays.push({ inlay, x, width, subRow: row });
            x += width;
        }
        geometry.after.push(x);
        if (stop === offsets.length - 1) {
            break;
        }
        const character = text.slice(offset, offsets[stop + 1]!);
        const width = characterWidth(metrics, character, x);
        if (character === '\t') {
            flushRun(offset);
        } else if (runStart < 0) {
            runStart = offset;
            runX = x;
        }
        x += width;
    }
    flushRun(text.length);
    geometry.rowEnds.push(x);
    geometry.width = Math.max(...geometry.rowEnds);
    return geometry;
}

export interface LayoutConfig {
    /* The text changed, so nothing remembered about a line number holds any more. */
    textChanged?: boolean;
    metrics?: LayoutMetrics;
    /* The pixels a visual line may take before it wraps; null for no wrapping. */
    wrapWidth?: number | null;
    inlays?: readonly Inlay[];
    blocks?: readonly BlockWidget[];
    folds?: readonly FoldState[];
}

/*
 * The rows of the document as they are drawn: one per line, taller for a wrapped line, one for a
 * widget, none for a line a fold hides. Only the rows that are on screen are ever measured; the
 * others stand on an estimate that the first draw of a row corrects.
 */
export class EditorLayout {
    rows: LayoutRow[] = [];
    height = 0;
    /* The widest line drawn so far, which is what a horizontal scroll bar needs. */
    width = 0;
    private lineRows: number[] = [];
    private geometryCache = new Map<number, LineGeometry>();
    private measuredRows = new Map<number, number>();
    private measuredHeights = new Map<string, number>();
    private inlaysByLine = new Map<number, Inlay[]>();
    private inlays: readonly Inlay[] = [];
    private blocks: readonly BlockWidget[] = [];
    private folds: readonly FoldState[] = [];
    private wrapWidth: number | null = null;

    readonly document: LayoutDocument;
    metrics: LayoutMetrics;

    constructor(document: LayoutDocument, metrics: LayoutMetrics) {
        this.document = document;
        this.metrics = metrics;
        this.rebuild();
    }

    get wrapping(): boolean {
        return this.wrapWidth !== null;
    }

    configure(config: LayoutConfig): void {
        let measureAgain = false;
        if (config.metrics) {
            this.metrics = config.metrics;
            this.measuredHeights.clear();
            measureAgain = true;
        }
        if (config.wrapWidth !== undefined && config.wrapWidth !== this.wrapWidth) {
            this.wrapWidth = config.wrapWidth;
            measureAgain = true;
        }
        if (config.inlays) {
            this.inlays = config.inlays;
            measureAgain = true;
        }
        if (config.blocks) {
            this.blocks = config.blocks;
        }
        if (config.folds) {
            this.folds = config.folds;
        }
        if (measureAgain || config.textChanged) {
            this.geometryCache.clear();
            this.measuredRows.clear();
            this.width = 0;
        }
        this.rebuild();
    }

    private rowCountOf(line: number, length: number): number {
        const limit = this.wrapWidth;
        if (limit === null) {
            return 1;
        }
        const measured = this.measuredRows.get(line);
        if (measured !== undefined) {
            return measured;
        }
        return Math.max(1, Math.ceil((length * this.metrics.charWidth) / Math.max(limit, this.metrics.charWidth)));
    }

    private rebuild(): void {
        this.inlaysByLine.clear();
        for (const inlay of this.inlays) {
            const line = this.document.positionAt(inlay.at).line;
            const list = this.inlaysByLine.get(line) ?? [];
            list.push(inlay);
            this.inlaysByLine.set(line, list);
        }
        for (const list of this.inlaysByLine.values()) {
            list.sort((left, right) => left.at - right.at);
        }
        const above = new Map<number, BlockWidget[]>();
        const below = new Map<number, BlockWidget[]>();
        for (const block of this.blocks) {
            const line = this.document.positionAt(block.at).line;
            const target = block.placement === 'above' ? above : below;
            target.set(line, [...(target.get(line) ?? []), block]);
        }
        const folds = new Map<number, number>();
        for (const fold of this.folds) {
            if (fold.collapsed) {
                folds.set(fold.startLine, Math.max(folds.get(fold.startLine) ?? 0, fold.endLine));
            }
        }
        const count = this.document.getLineCount();
        this.rows = [];
        this.lineRows = new Array<number>(count);
        const addBlock = (widget: BlockWidget, line: number): void => {
            const key = `block:${widget.id}`;
            this.rows.push({
                key,
                kind: 'block',
                index: this.rows.length,
                line,
                widget,
                top: 0,
                height: this.measuredHeights.get(key) ?? widget.height ?? DEFAULT_BLOCK_HEIGHT
            });
        };
        for (let line = 0; line < count; line++) {
            for (const block of above.get(line) ?? []) {
                addBlock(block, line);
            }
            const last = Math.max(line, Math.min(count - 1, folds.get(line) ?? line));
            const index = this.rows.length;
            const bounds = this.wrapWidth === null ? null : this.document.getLine(line);
            const subRows = this.rowCountOf(line, bounds === null ? 0 : bounds.end - bounds.start);
            this.rows.push({ key: `line:${line}`, kind: 'text', index, line, lastLine: last, subRows, top: 0, height: subRows * this.metrics.lineHeight });
            for (let covered = line; covered <= last; covered++) {
                this.lineRows[covered] = index;
            }
            for (const block of below.get(line) ?? []) {
                addBlock(block, line);
            }
            line = last;
        }
        this.reflow();
    }

    private reflow(): void {
        let top = 0;
        for (const row of this.rows) {
            row.top = top;
            top += row.height;
        }
        this.height = top + BOTTOM_PADDING;
    }

    /* A widget's measured height. Returns whether it moved anything. */
    setMeasuredHeight(key: string, height: number): boolean {
        const row = this.rows.find((candidate) => candidate.key === key);
        const next = Math.max(1, Math.round(height));
        if (!row || !Number.isFinite(next) || row.height === next) {
            return false;
        }
        this.measuredHeights.set(key, next);
        row.height = next;
        this.reflow();
        return true;
    }

    /* The visual lines a drawn row really has, which its estimate may have missed. Returns whether any row changed. */
    syncRows(rows: readonly LayoutRow[]): boolean {
        let changed = false;
        for (const row of rows) {
            if (row.kind !== 'text') {
                continue;
            }
            const subRows = this.geometry(row).subRows;
            if (subRows !== row.subRows) {
                this.measuredRows.set(row.line, subRows);
                row.subRows = subRows;
                row.height = subRows * this.metrics.lineHeight;
                changed = true;
            }
        }
        if (changed) {
            this.reflow();
        }
        return changed;
    }

    rowAt(y: number): LayoutRow {
        let low = 0;
        let high = this.rows.length - 1;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (this.rows[middle]!.top <= y) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        return this.rows[low]!;
    }

    rowForLine(line: number): LayoutRow {
        return this.rows[this.lineRows[Math.max(0, Math.min(this.lineRows.length - 1, line))]!]!;
    }

    /* Whether a fold hides the line. */
    isHidden(line: number): boolean {
        const row = this.rowForLine(line);
        return row.kind === 'text' && line > row.line && line <= row.lastLine;
    }

    visibleRows(top: number, height: number, overscan = 120): LayoutRow[] {
        const result: LayoutRow[] = [];
        for (let index = this.rowAt(top - overscan).index; index < this.rows.length && this.rows[index]!.top < top + height + overscan; index++) {
            result.push(this.rows[index]!);
        }
        return result;
    }

    geometry(row: TextRow): LineGeometry {
        const cached = this.geometryCache.get(row.line);
        if (cached) {
            return cached;
        }
        const result = scanLine(this.document.getLine(row.line), this.metrics, this.wrapWidth, this.inlaysByLine.get(row.line) ?? []);
        if (this.wrapWidth === null) {
            this.width = Math.max(this.width, result.width + RIGHT_PADDING);
        }
        if (this.geometryCache.size >= GEOMETRY_CACHE_SIZE) {
            this.geometryCache.delete(this.geometryCache.keys().next().value!);
        }
        this.geometryCache.set(row.line, result);
        return result;
    }

    private stopOf(geometry: LineGeometry, offset: number): number {
        return Math.min(geometry.offsets.length - 1, lowerBound(geometry.offsets, Math.max(0, offset - geometry.start)));
    }

    xAt(geometry: LineGeometry, offset: number, affinity: Affinity = 'after'): number {
        return TEXT_PADDING + geometry[affinity][this.stopOf(geometry, offset)]!;
    }

    /* The offset nearest an x on one visual line of a laid out line. */
    offsetAtX(geometry: LineGeometry, subRow: number, x: number): number {
        const local = x - TEXT_PADDING;
        for (const box of geometry.inlays) {
            if (box.subRow === subRow && local >= box.x && local <= box.x + box.width) {
                return box.inlay.at;
            }
        }
        const first = geometry.rowStarts[subRow] ?? 0;
        const last = subRow + 1 < geometry.rowStarts.length ? geometry.rowStarts[subRow + 1]! : geometry.offsets.length - 1;
        let best = geometry.offsets[first]!;
        let distance = Math.abs(local - geometry.before[first]!);
        // The stop that starts the next visual line stands in for the end of this one.
        for (let stop = first + 1; stop <= last; stop++) {
            const edge = stop === last && subRow + 1 < geometry.rowStarts.length ? geometry.rowEnds[subRow]! : geometry.before[stop]!;
            const candidate = Math.abs(local - edge);
            if (candidate < distance) {
                distance = candidate;
                best = geometry.offsets[stop]!;
            }
        }
        return geometry.start + best;
    }

    caret(offset: number, affinity: Affinity = 'after'): LayoutRect {
        const position = this.document.positionAt(offset);
        const row = this.rowForLine(position.line);
        if (row.kind !== 'text') {
            return { x: TEXT_PADDING, y: row.top, width: 1, height: Math.min(row.height, this.metrics.lineHeight) };
        }
        const geometry = this.geometry(row);
        const stop = this.stopOf(geometry, offset);
        return {
            x: TEXT_PADDING + geometry[affinity][stop]!,
            y: row.top + geometry.rowOf[stop]! * this.metrics.lineHeight,
            width: 1,
            height: this.metrics.lineHeight
        };
    }

    hitTest(x: number, y: number): number {
        const row = this.rowAt(y);
        if (row.kind === 'block') {
            return row.widget.at;
        }
        const geometry = this.geometry(row);
        const subRow = Math.max(0, Math.min(geometry.subRows - 1, Math.floor((y - row.top) / this.metrics.lineHeight)));
        return this.offsetAtX(geometry, subRow, x);
    }

    /* The boxes a range is drawn in, one per visual line it touches, among the rows given. */
    rectangles(from: number, to: number, rows: readonly LayoutRow[]): LayoutRect[] {
        const result: LayoutRect[] = [];
        const lineHeight = this.metrics.lineHeight;
        for (const row of rows) {
            if (row.kind !== 'text') {
                continue;
            }
            const geometry = this.geometry(row);
            if (from === to || from > geometry.end || to <= geometry.start) {
                continue;
            }
            const lastStop = geometry.offsets.length - 1;
            const fromStop = this.stopOf(geometry, Math.max(from, geometry.start));
            const toStop = this.stopOf(geometry, Math.min(to, geometry.end));
            for (let subRow = 0; subRow < geometry.subRows; subRow++) {
                const last = subRow + 1 === geometry.subRows;
                const rowFirst = geometry.rowStarts[subRow]!;
                const rowEnd = last ? lastStop : geometry.rowStarts[subRow + 1]!;
                const first = Math.max(fromStop, rowFirst);
                const stop = Math.min(toStop, rowEnd);
                const newline = last && to > geometry.end;
                if (first >= stop && !newline) {
                    continue;
                }
                const startX = first === fromStop ? geometry.after[first]! : geometry.before[first]!;
                const endX = stop < rowEnd || last ? geometry.before[stop]! : geometry.rowEnds[subRow]!;
                result.push({
                    x: TEXT_PADDING + startX,
                    y: row.top + subRow * lineHeight,
                    width: Math.max(1, endX - startX + (newline ? this.metrics.charWidth : 0)),
                    height: lineHeight
                });
            }
        }
        return result;
    }

    /*
     * The offset a visual line above or below, `distance` pixels away, at an x. Widgets are walked
     * over, and the document's ends stop the caret on the first or the last offset.
     */
    verticalOffset(offset: number, direction: -1 | 1, x: number, distance = this.metrics.lineHeight): number {
        const caret = this.caret(offset);
        let y = caret.y + direction * distance;
        if (y < 0) {
            return 0;
        }
        let row = this.rowAt(y);
        while (row.kind === 'block') {
            const next = this.rows[row.index + direction];
            if (!next) {
                return offset;
            }
            row = next;
            y = direction < 0 ? row.top + row.height - 1 : row.top;
        }
        if (y >= this.height - BOTTOM_PADDING) {
            return this.document.getLine(this.document.getLineCount() - 1).end;
        }
        return this.hitTest(x, y);
    }

    /* One character left or right, over the end of a line onto the next visible one. */
    horizontalOffset(offset: number, direction: -1 | 1): number {
        const row = this.rowForLine(this.document.positionAt(offset).line);
        if (row.kind === 'text') {
            const geometry = this.geometry(row);
            const stop = this.stopOf(geometry, offset);
            const next = stop + direction;
            if (next >= 0 && next < geometry.offsets.length && offset >= geometry.start && offset <= geometry.end) {
                return geometry.start + geometry.offsets[next]!;
            }
        }
        for (let index = row.index + direction; index >= 0 && index < this.rows.length; index += direction) {
            const next = this.rows[index]!;
            if (next.kind !== 'text') {
                continue;
            }
            const line = this.document.getLine(next.line);
            return direction < 0 ? line.end : line.start;
        }
        return offset;
    }
}

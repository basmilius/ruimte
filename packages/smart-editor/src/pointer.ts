import type { DocumentModel, Selection } from '@ruimte/smart-editor-core';
import type { ContentPoint } from './column-selection.ts';

/* A visual line as the layout knows it: a wrapped line is as many as it has rows and a collapsed fold is one. */
export interface VisualLine {
    start: number;
    end: number;
    next: number;
    y: number;
}

export interface PointerHost {
    readonly model: DocumentModel;
    readonly viewport: HTMLElement;
    offsetAt(clientX: number, clientY: number): number;
    contentPoint(clientX: number, clientY: number): ContentPoint;
    /* The box between two points, or null while they are in the same cell, so a press with alt is still a click. */
    columnSelections(from: ContentPoint, to: ContentPoint): Selection[] | null;
    visualLine(offset: number): VisualLine;
    /* The lines a triple click or a press on a line number selects, whole: wrapped rows and a collapsed fold are one line. */
    lineAt(offset: number): { from: number; to: number };
    /* Whether a double click selects a camel hump and not the whole name. */
    camelHumps(): boolean;
    /* Whether a drag selects a box of columns without alt held. */
    columnMode(): boolean;
    /* The selection a point of the screen is on, for a press that may begin dragging it; null on anything else or when the text cannot be edited. */
    selectionAt(clientX: number, clientY: number): Selection | null;
    /* The place a drop would land, drawn as a caret; null takes it away. */
    setDropCaret(offset: number | null): void;
    /* Moves `[from, to)` to `offset`, or copies it there. */
    drop(from: number, to: number, offset: number, copy: boolean): void;
    /* Whether the key that turns a move into a copy is down. */
    copyHeld(event: PointerEvent): boolean;
    focus(): void;
    /* The view scrolled by itself while the pointer was held at an edge. */
    scrolled(): void;
}

/* What a drag selects by: characters, or the words or lines the press started on. `drop` is no selection at all: the press was on a selection, and a drag carries its text. */
type DragUnit = 'character' | 'word' | 'line' | 'drop';

/* A press on a selection: it waits for the pointer to move this far before it carries the text, and without that it is a click. */
interface Carry {
    from: number;
    to: number;
    pressOffset: number;
    startX: number;
    startY: number;
    active: boolean;
    /* Where it would land, or null over the text itself. */
    target: number | null;
}

interface Drag {
    id: number;
    anchor: number;
    selections: readonly Selection[];
    add: boolean;
    unit: DragUnit;
    /* The word or the lines the press selected, which a drag never gives back. */
    saved: { from: number; to: number };
    carry?: Carry;
    /* With shift and alt a dragged box is added to the carets that are there, not put in their place. */
    keep: boolean;
    /* Whether a drag so far makes a box of columns. */
    box: boolean;
    /* Where the press landed in the content, which a scroll leaves in place. */
    anchorPoint: ContentPoint;
    x: number;
    y: number;
}

const SCROLL_STEP = 40;
/* A press this soon after the last one, this close to it, is the next click of a double or triple click. */
const MULTI_CLICK_MS = 500;
const MULTI_CLICK_DISTANCE = 4;
/* How far the pointer goes, in pixels, before a press on a selection starts carrying it. */
const CARRY_THRESHOLD = 5;

/* The selection a mouse makes: a click, a drag, shift to extend, alt to add a caret or, dragged, a column, a double click for a word and a triple for a line, which a drag then grows by words and lines. */
export class PointerSelection {
    private drag: Drag | undefined;
    private frame: number | undefined;
    private lastPress: { time: number; x: number; y: number; count: number } | undefined;
    private readonly host: PointerHost;

    constructor(host: PointerHost) {
        this.host = host;
    }

    get dragging(): boolean {
        return this.drag !== undefined;
    }

    /* A press in the text, or on a line number, which selects the line and drags by lines. */
    start(event: PointerEvent, area: 'text' | 'gutter' = 'text'): void {
        const { model, viewport } = this.host;
        const count = area === 'gutter' ? 1 : this.countClick(event);
        const head = this.host.offsetAt(event.clientX, event.clientY);
        const selections = model.getSelections();
        const base = event.altKey && area === 'text' ? selections : [];
        this.drag = {
            id: event.pointerId,
            anchor: event.shiftKey && !event.altKey ? model.getPrimary().anchor : head,
            selections,
            add: event.altKey && area === 'text',
            unit: 'character',
            keep: event.altKey && event.shiftKey,
            box: area === 'text' && (event.altKey || this.host.columnMode()),
            saved: { from: head, to: head },
            anchorPoint: this.host.contentPoint(event.clientX, event.clientY),
            x: event.clientX,
            y: event.clientY
        };
        this.host.focus();
        viewport.setPointerCapture?.(event.pointerId);
        // Alt on a caret that is there takes it away; there is no selection to drag after that.
        if (area === 'text' && event.altKey && count === 1 && selections.length > 1 && selections.some((selection) => selection.head === head)) {
            model.setSelections(selections.filter((selection) => selection.head !== head));
            this.drag = undefined;
            return;
        }
        const selected = count === 1 && area === 'text' && !event.shiftKey && !event.altKey ? this.host.selectionAt(event.clientX, event.clientY) : null;
        if (selected !== null) {
            this.drag.unit = 'drop';
            this.drag.carry = {
                from: Math.min(selected.anchor, selected.head),
                to: Math.max(selected.anchor, selected.head),
                pressOffset: head,
                startX: event.clientX,
                startY: event.clientY,
                active: false,
                target: null
            };
        } else if (area === 'gutter') {
            this.pressLineNumber(event, head);
        } else if (count >= 3) {
            this.selectUnit('line', this.host.lineAt(head), base);
        } else if (count === 2) {
            const word = model.wordSelectionAt(head, this.host.camelHumps());
            if (word === null) {
                this.update();
            } else {
                this.selectUnit('word', word, base);
            }
        } else {
            this.update();
        }
        if (this.drag && this.frame === undefined) {
            this.frame = viewport.ownerDocument.defaultView?.requestAnimationFrame?.(() => this.autoScroll());
        }
    }

    /* A line number selects its line, and with shift grows or shrinks the selection by lines. */
    private pressLineNumber(event: PointerEvent, offset: number): void {
        const { model } = this.host;
        const primary = model.getPrimary();
        if (event.shiftKey && primary.anchor !== primary.head) {
            model.setSelections([this.tweakedByLines(primary, offset)]);
            this.drag = undefined;
            return;
        }
        this.selectUnit('line', this.host.lineAt(offset), []);
    }

    private selectUnit(unit: DragUnit, saved: { from: number; to: number }, base: readonly Selection[]): void {
        if (this.drag === undefined) {
            return;
        }
        this.drag.unit = unit;
        this.drag.saved = saved;
        this.drag.selections = base;
        this.host.model.setSelections([...base, { anchor: saved.from, head: saved.to }]);
    }

    /* The selection after a shift press on a line number: the clicked line comes in, or goes out when it is inside. */
    private tweakedByLines(selection: Selection, offset: number): Selection {
        const { host } = this;
        const from = Math.min(selection.anchor, selection.head);
        const to = Math.max(selection.anchor, selection.head);
        const first = host.visualLine(from);
        const last = host.visualLine(to - 1);
        const clicked = host.visualLine(offset);
        if (clicked.y < first.y) {
            return { anchor: to, head: clicked.start };
        }
        if (clicked.y > last.y) {
            return { anchor: from, head: clicked.end };
        }
        if (first.y === last.y) {
            return { anchor: selection.head, head: selection.head };
        }
        if (selection.anchor === to) {
            const line = clicked.y === first.y ? host.visualLine(first.next) : clicked;
            return { anchor: to, head: line.start };
        }
        const line = clicked.y === last.y ? host.visualLine(last.start - 1) : clicked;
        return { anchor: from, head: line.end };
    }

    /* Pointer events carry no click count, so the presses are counted here. */
    private countClick(event: PointerEvent): number {
        const last = this.lastPress;
        const repeated =
            last !== undefined &&
            event.timeStamp - last.time <= MULTI_CLICK_MS &&
            Math.abs(event.clientX - last.x) <= MULTI_CLICK_DISTANCE &&
            Math.abs(event.clientY - last.y) <= MULTI_CLICK_DISTANCE;
        const count = repeated ? Math.min(3, last.count + 1) : 1;
        this.lastPress = { time: event.timeStamp, x: event.clientX, y: event.clientY, count };
        return count;
    }

    move(event: PointerEvent): void {
        if (!this.drag || event.pointerId !== this.drag.id) {
            return;
        }
        this.drag.x = event.clientX;
        this.drag.y = event.clientY;
        this.update();
    }

    /* The pointer went up, or was taken away: a selection that was carried lands, and one that was only pressed gives way to a caret. */
    end(event?: PointerEvent): void {
        const { viewport } = this.host;
        const carry = this.drag?.carry;
        if (this.drag) {
            viewport.releasePointerCapture?.(this.drag.id);
        }
        this.drag = undefined;
        this.cancelFrame();
        if (carry === undefined) {
            return;
        }
        this.host.setDropCaret(null);
        if (event?.type === 'pointercancel') {
            return;
        }
        if (!carry.active) {
            this.host.model.setSelections([{ anchor: carry.pressOffset, head: carry.pressOffset }]);
        } else if (carry.target !== null && event !== undefined) {
            this.host.drop(carry.from, carry.to, carry.target, this.host.copyHeld(event));
        }
    }

    /* Where the carried text would land at the pointer, once the pointer has moved far enough to carry it. */
    private updateCarry(drag: Drag, carry: Carry): void {
        if (!carry.active) {
            if (Math.abs(drag.x - carry.startX) < CARRY_THRESHOLD && Math.abs(drag.y - carry.startY) < CARRY_THRESHOLD) {
                return;
            }
            carry.active = true;
        }
        const offset = this.host.offsetAt(drag.x, drag.y);
        carry.target = offset >= carry.from && offset <= carry.to ? null : offset;
        this.host.setDropCaret(carry.target);
    }

    dispose(): void {
        this.drag = undefined;
        this.cancelFrame();
    }

    private cancelFrame(): void {
        if (this.frame !== undefined) {
            this.host.viewport.ownerDocument.defaultView?.cancelAnimationFrame?.(this.frame);
        }
        this.frame = undefined;
    }

    private update(): void {
        if (!this.drag) {
            return;
        }
        if (this.drag.carry !== undefined) {
            this.updateCarry(this.drag, this.drag.carry);
            return;
        }
        if (this.drag.box && this.drag.unit === 'character') {
            const box = this.host.columnSelections(this.drag.anchorPoint, this.host.contentPoint(this.drag.x, this.drag.y));
            if (box) {
                this.host.model.setSelections(this.drag.keep ? [...this.drag.selections, ...box] : box);
                return;
            }
        }
        const head = this.host.offsetAt(this.drag.x, this.drag.y);
        const { anchor, target } = this.reach(this.drag, head);
        this.host.model.setSelections([...(this.drag.add ? this.drag.selections : []), { anchor, head: target }]);
    }

    /* Where a drag that has got to `head` selects from and to, by the unit the press began with. */
    private reach(drag: Drag, head: number): { anchor: number; target: number } {
        const { model } = this.host;
        const backwards = head < drag.saved.from;
        if (drag.unit === 'word') {
            const camel = this.host.camelHumps();
            return backwards
                ? { anchor: drag.saved.to, target: model.wordStartBefore(head, camel) }
                : { anchor: drag.saved.from, target: model.wordEndAfter(head, camel) };
        }
        if (drag.unit === 'line') {
            const line = this.host.visualLine(head);
            return backwards ? { anchor: drag.saved.to, target: line.start } : { anchor: drag.saved.from, target: line.next };
        }
        return { anchor: drag.anchor, target: head };
    }

    /* Holding the pointer past an edge of the view keeps scrolling that way. */
    private autoScroll(): void {
        const { viewport } = this.host;
        if (!this.drag) {
            this.frame = undefined;
            return;
        }
        const rect = viewport.getBoundingClientRect();
        const dy = this.drag.y < rect.top ? this.drag.y - rect.top : this.drag.y > rect.bottom ? this.drag.y - rect.bottom : 0;
        const dx = this.drag.x < rect.left ? this.drag.x - rect.left : this.drag.x > rect.right ? this.drag.x - rect.right : 0;
        if (dy || dx) {
            viewport.scrollTop += Math.max(-SCROLL_STEP, Math.min(SCROLL_STEP, dy));
            viewport.scrollLeft += Math.max(-SCROLL_STEP, Math.min(SCROLL_STEP, dx));
            this.host.scrolled();
            this.update();
        }
        this.frame = viewport.ownerDocument.defaultView?.requestAnimationFrame?.(() => this.autoScroll());
    }
}

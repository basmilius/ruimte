import type { DocumentModel, Selection } from '@ruimte/smart-editor-core';

export interface PointerHost {
    readonly model: DocumentModel;
    readonly viewport: HTMLElement;
    offsetAt(clientX: number, clientY: number): number;
    focus(): void;
    /* The view scrolled by itself while the pointer was held at an edge. */
    scrolled(): void;
}

interface Drag {
    id: number;
    anchor: number;
    selections: readonly Selection[];
    add: boolean;
    x: number;
    y: number;
}

const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' });
const SCROLL_STEP = 40;
/* A press this soon after the last one, this close to it, is the next click of a double or triple click. */
const MULTI_CLICK_MS = 500;
const MULTI_CLICK_DISTANCE = 4;

/* The selection a mouse makes: a click, a drag, shift to extend, alt to add a caret, a double click for a word and a triple for a line. */
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

    start(event: PointerEvent): void {
        const { model, viewport } = this.host;
        const count = this.countClick(event);
        const head = this.host.offsetAt(event.clientX, event.clientY);
        const selections = model.getSelections();
        this.drag = {
            id: event.pointerId,
            anchor: event.shiftKey ? selections[0]!.anchor : head,
            selections,
            add: event.altKey,
            x: event.clientX,
            y: event.clientY
        };
        this.host.focus();
        this.update();
        viewport.setPointerCapture?.(event.pointerId);
        if (count >= 3) {
            const line = model.getLine(model.positionAt(head).line);
            model.setSelections([{ anchor: line.start, head: line.next }]);
            this.drag = undefined;
        } else if (count === 2) {
            const line = model.getLine(model.positionAt(head).line);
            const offset = head - line.start;
            const word = [...WORDS.segment(line.text)].find((part) => part.index <= offset && part.index + part.segment.length > offset);
            if (word) {
                model.setSelections([{ anchor: line.start + word.index, head: line.start + word.index + word.segment.length }]);
            }
            this.drag = undefined;
        }
        if (this.drag && this.frame === undefined) {
            this.frame = viewport.ownerDocument.defaultView?.requestAnimationFrame?.(() => this.autoScroll());
        }
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

    end(): void {
        const { viewport } = this.host;
        if (this.drag) {
            viewport.releasePointerCapture?.(this.drag.id);
        }
        this.drag = undefined;
        this.cancelFrame();
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
        const head = this.host.offsetAt(this.drag.x, this.drag.y);
        this.host.model.setSelections([...(this.drag.add ? this.drag.selections : []), { anchor: this.drag.anchor, head }]);
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

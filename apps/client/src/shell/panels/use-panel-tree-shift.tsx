import { useEffect, useState, type ReactElement } from 'react';
import type { FileTree } from '@pierre/trees';
import { clampShift, maxShift, SHIFT_PROPERTY, shiftNeed, shiftThumb, sidewaysDelta } from '@/shell/panels/panel-tree-shift';

/* The rows the tree draws; a parked row is a copy of the focused one, kept out of sight. */
const ROWS = '[data-type="item"]:not([data-item-parked="true"])';

/* How long the indicator stays after the last sideways step. */
const HIDE_AFTER = 900;

/* How close to the bottom the pointer brings the indicator up. */
const NEAR_BOTTOM = 16;

/* An element `display: contents` puts in its parent's place draws no box of its own. */
function boxesOf(element: Element): Element[] {
    return element.getClientRects().length > 0 ? [element] : [...element.children].flatMap((child) => boxesOf(child));
}

/*
 * Where a row's name may end: before the first thing that sits after the name, or the end of the
 * row. An empty part that grows is only filler, which gives way to the name.
 */
function limitOf(row: HTMLElement, content: Element, gap: number): number {
    const start = content.getBoundingClientRect().left;
    let limit = Number.POSITIVE_INFINITY;
    for (const part of [...row.children].filter((child) => child !== content).flatMap((child) => boxesOf(child))) {
        const rect = part.getBoundingClientRect();
        if (rect.width === 0 || rect.left < start) {
            continue;
        }
        if (part.childNodes.length === 0 && Number.parseFloat(getComputedStyle(part).flexGrow) > 0) {
            continue;
        }
        limit = Math.min(limit, rect.left - gap);
    }
    if (limit !== Number.POSITIVE_INFINITY) {
        return limit;
    }
    return row.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(row).paddingInlineEnd);
}

/* What one drawn row asks for at the shift it was drawn at, or null for a row that is not drawn. */
function needOf(row: HTMLElement, shift: number, gap: number, range: Range): number | null {
    const content = row.querySelector(':scope > [data-item-section="content"]');
    if (content === null || row.getBoundingClientRect().width === 0) {
        return null;
    }
    range.selectNodeContents(content);
    return shiftNeed(range.getBoundingClientRect().right, limitOf(row, content, gap), shift);
}

/*
 * Lets a person slide the rows of a panel tree sideways, with a sideways swipe or Shift and the
 * wheel, to read a name the panel cuts off. The shift lives on the frame around the tree and is
 * read by `PANEL_TREE_CSS`; it goes no further than the widest drawn row needs, and back to 0 when
 * `resetKey` changes. `attach` is the ref of the element around the tree, and `bar` goes inside
 * that element after the tree.
 */
export function usePanelTreeShift(model: FileTree, resetKey?: string): { attach(node: HTMLElement | null): void; bar: ReactElement } {
    const [frame, setFrame] = useState<HTMLElement | null>(null);
    const [track, setTrack] = useState<HTMLDivElement | null>(null);
    const [thumb, setThumb] = useState<HTMLDivElement | null>(null);

    useEffect(() => {
        if (frame === null || track === null || thumb === null) {
            return;
        }
        const range = document.createRange();
        let root: ShadowRoot | null = null;
        let exact = 0;
        let drawn = 0;
        let max = 0;
        let pending = 0;
        let hideTimer = 0;
        let scrolling = false;
        let near = false;

        const draw = (): void => {
            const shift = Math.round(exact);
            if (shift !== drawn) {
                drawn = shift;
                frame.style.setProperty(SHIFT_PROPERTY, `${shift}px`);
            }
            const { left, width } = shiftThumb(shift, max, track.clientWidth, frame.clientWidth);
            thumb.style.left = `${left}px`;
            thumb.style.width = `${width}px`;
            track.toggleAttribute('data-visible', max > 0 && (scrolling || near));
        };

        const measure = (): void => {
            pending = 0;
            if (root === null) {
                root = model.getFileTreeContainer()?.shadowRoot ?? null;
                if (root === null) {
                    // The tree draws its rows a render after the frame mounts.
                    schedule();
                    return;
                }
                rows.observe(root, { childList: true, subtree: true, characterData: true });
            }
            const drawnRows = [...root.querySelectorAll<HTMLElement>(ROWS)];
            const gap = drawnRows.length === 0 ? 0 : Number.parseFloat(getComputedStyle(drawnRows[0]!).columnGap) || 0;
            max = maxShift(drawnRows.map((row) => needOf(row, drawn, gap, range)).filter((need) => need !== null));
            exact = clampShift(exact, max);
            draw();
        };

        const schedule = (): void => {
            if (pending === 0) {
                pending = requestAnimationFrame(measure);
            }
        };

        const rows = new MutationObserver(schedule);
        const sizes = new ResizeObserver(schedule);
        sizes.observe(frame);

        const onWheel = (event: WheelEvent): void => {
            const delta = sidewaysDelta(event, frame.clientWidth);
            if (delta === 0 || max === 0) {
                return;
            }
            scrolling = true;
            window.clearTimeout(hideTimer);
            hideTimer = window.setTimeout(() => {
                scrolling = false;
                draw();
            }, HIDE_AFTER);
            const next = clampShift(exact + delta, max);
            if (next !== exact) {
                event.preventDefault();
                exact = next;
            }
            draw();
        };

        const onPointerMove = (event: PointerEvent): void => {
            const bottom = track.getBoundingClientRect().bottom;
            const isNear = event.clientY >= bottom - NEAR_BOTTOM;
            if (isNear !== near) {
                near = isNear;
                draw();
            }
        };

        const onPointerLeave = (): void => {
            if (near) {
                near = false;
                draw();
            }
        };

        frame.addEventListener('wheel', onWheel, { passive: false });
        frame.addEventListener('pointermove', onPointerMove);
        frame.addEventListener('pointerleave', onPointerLeave);
        schedule();

        return () => {
            frame.removeEventListener('wheel', onWheel);
            frame.removeEventListener('pointermove', onPointerMove);
            frame.removeEventListener('pointerleave', onPointerLeave);
            rows.disconnect();
            sizes.disconnect();
            cancelAnimationFrame(pending);
            window.clearTimeout(hideTimer);
            frame.style.removeProperty(SHIFT_PROPERTY);
            track.removeAttribute('data-visible');
        };
    }, [frame, track, thumb, model, resetKey]);

    /* Sticky, so a tree that is as tall as its rows and scrolls in a frame further out keeps the bar
       at the bottom of what shows of it. */
    const bar = (
        <div aria-hidden className="pointer-events-none sticky bottom-0 h-0">
            <div
                ref={setTrack}
                className="absolute inset-x-2 bottom-0.5 h-1.5 opacity-0 transition-opacity duration-300 data-visible:opacity-100 motion-reduce:transition-none"
            >
                <div ref={setThumb} className="absolute inset-y-0 rounded-full bg-text-faint" />
            </div>
        </div>
    );

    return { attach: setFrame, bar };
}

import type { ScreenPoint } from './tab-drag';

/* The part of a window a view drag moves, fades and closes. */
export interface ViewDragWindow {
    setPosition(x: number, y: number): void;
    setOpacity(opacity: number): void;
    setIgnoreMouseEvents(ignore: boolean): void;
    getSize(): number[];
    close(): void;
    focus(): void;
    isDestroyed(): boolean;
}

interface ViewDragDeps<Window extends ViewDragWindow> {
    /* Opens the auxiliary window for a key, without the focus. Null when it cannot. */
    open(key: string, at: ScreenPoint): Window | null;
    windowAt(point: ScreenPoint, except: Window): Window | null;
    /* Whether a window may take the dragged view: the window the drag left, or another window of the same project. */
    takes(window: Window, key: string): boolean;
    cursor(): ScreenPoint;
    every(tick: () => void): () => void;
}

interface Drag<Window> {
    key: string;
    dragged: Window;
    stop: () => void;
}

/* Half the height of the band at the top of an auxiliary window, which is where the pointer holds it. */
export const HELD_BELOW_TOP = 23;

/* The width a new auxiliary window opens at most, for where it goes before its size can be asked. */
const OPENING_WIDTH = 960;

function cornerFor(point: ScreenPoint, width: number): ScreenPoint {
    return { x: Math.round(point.x - width / 2), y: Math.round(point.y - HELD_BELOW_TOP) };
}

/*
 * A view dragged out of its window. The auxiliary window it would become opens at once and follows
 * the pointer, held by the middle of its top band. The system holds the pointer during the drag, so
 * the window lets every pointer event through and the drag reaches what lies under it. Over a
 * window that may take the view it turns invisible, since the drop would go into that window's grid.
 * The page that started the drag says how it ended: the window stays, or closes when something else
 * took the view.
 */
export function createViewDrag<Window extends ViewDragWindow>(deps: ViewDragDeps<Window>) {
    let drag: Drag<Window> | null = null;

    const end = (keep: boolean): void => {
        const current = drag;
        drag = null;

        if (current === null) {
            return;
        }

        current.stop();

        if (current.dragged.isDestroyed()) {
            return;
        }

        if (!keep) {
            current.dragged.close();

            return;
        }

        current.dragged.setIgnoreMouseEvents(false);
        current.dragged.setOpacity(1);
        current.dragged.focus();
    };

    const tick = (): void => {
        const current = drag;

        if (current === null) {
            return;
        }

        if (current.dragged.isDestroyed()) {
            end(false);

            return;
        }

        const point = deps.cursor();
        const over = deps.windowAt(point, current.dragged);
        const corner = cornerFor(point, current.dragged.getSize()[0] ?? OPENING_WIDTH);
        current.dragged.setOpacity(over !== null && deps.takes(over, current.key) ? 0 : 1);
        current.dragged.setPosition(corner.x, corner.y);
    };

    return {
        /* False when the window could not open. A drag that was still under way ends without its window. */
        start(key: string): boolean {
            end(false);

            const dragged = deps.open(key, cornerFor(deps.cursor(), OPENING_WIDTH));

            if (dragged === null) {
                return false;
            }

            dragged.setIgnoreMouseEvents(true);
            drag = { key, dragged, stop: deps.every(tick) };

            return true;
        },
        end,
        dragging(): boolean {
            return drag !== null;
        }
    };
}

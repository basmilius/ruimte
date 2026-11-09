/* The part of a window a tab drag moves, fades, closes and tells about a project it takes. */
export interface DragWindow {
    setPosition(x: number, y: number): void;
    setOpacity(opacity: number): void;
    close(): void;
    focus(): void;
    isDestroyed(): boolean;
    webContents: { send(channel: string, ...args: unknown[]): void };
}

export interface ScreenPoint {
    x: number;
    y: number;
}

interface TabDragDeps<Window extends DragWindow> {
    detach(window: Window, key: string, at: ScreenPoint): Window | null;
    transfer(key: string, window: Window): boolean;
    windowAt(point: ScreenPoint, except: Window): Window | null;
    /* Where along the tab strip of a window a point on the screen lies, in that page's coordinates; null off its strip. */
    stripX(window: Window, point: ScreenPoint): number | null;
    /* Where a window's page draws its tab strip, in its own coordinates, once it said so. */
    stripOf(window: Window): { x: number; y: number; height: number } | null;
    cursor(): ScreenPoint;
    /* Runs `tick` on a steady beat until the answer is called. */
    every(tick: () => void): () => void;
    /* Calls back when a window comes to the front, until the answer is called. */
    onFront(window: Window, listener: () => void): () => void;
}

interface Drag<Window> {
    key: string;
    /* The window that follows the pointer: the one the tab tore off into, or its own window for its only tab. */
    dragged: Window;
    /* The point of the dragged window under the pointer: the middle of its tab, as soon as its strip is known. */
    grab: ScreenPoint;
    /* Half the width of the tab, for a torn off window whose only tab is the first of its strip; null when the window itself moves. */
    halfTab: number | null;
    /* The window whose strip the tab sits in while the pointer is over it, where its page shows it. */
    docked: Window | null;
    stop: () => void;
}

/*
 * A tab dragged out of a window. The window it tears off into opens at once and follows the pointer
 * until the page that holds the press lets go; a window whose only tab it is moves itself instead.
 * Over the tab strip of another window the tab goes into that strip at once and that window shows it,
 * while the dragged window turns invisible; out of the strip again it floats in its own window. The
 * dragged window keeps its page and only fades, since the press lives in the page that began it.
 */
export function createTabDrag<Window extends DragWindow>(deps: TabDragDeps<Window>) {
    let drag: Drag<Window> | null = null;

    const dock = (current: Drag<Window>, target: Window, x: number): void => {
        if (!deps.transfer(current.key, target)) {
            return;
        }
        current.docked = target;
        current.dragged.setOpacity(0);
        target.webContents.send('window:take-project', current.key, x);
    };

    const undock = (current: Drag<Window>, docked: Window): void => {
        current.docked = null;
        deps.transfer(current.key, current.dragged);
        docked.webContents.send('window:release-project', current.key);
        current.dragged.setOpacity(1);
    };

    const tick = (): void => {
        const current = drag;
        if (current === null || current.dragged.isDestroyed()) {
            return;
        }
        if (current.halfTab !== null) {
            const strip = deps.stripOf(current.dragged);
            if (strip !== null) {
                current.grab = { x: strip.x + current.halfTab, y: strip.y + strip.height / 2 };
            }
        }
        const point = deps.cursor();
        const target = deps.windowAt(point, current.dragged);
        const x = target === null ? null : deps.stripX(target, point);
        const docked = current.docked;
        if (docked !== null && (docked.isDestroyed() || target !== docked || x === null)) {
            undock(current, docked);
        }
        if (current.docked === null && target !== null && x !== null) {
            dock(current, target, x);
        } else if (current.docked !== null && x !== null) {
            current.docked.webContents.send('window:tab-drag-over', current.key, x);
        }
        if (current.docked === null) {
            current.dragged.setPosition(Math.round(point.x - current.grab.x), Math.round(point.y - current.grab.y));
        }
    };

    const end = (): void => {
        const current = drag;
        drag = null;
        if (current === null) {
            return;
        }
        current.stop();
        const { dragged, docked } = current;
        if (dragged.isDestroyed()) {
            return;
        }
        // Only a strip takes a tab; let go anywhere else, over another window as well, it stays a window of its own.
        if (docked === null) {
            dragged.focus();
            return;
        }
        docked.focus();
        dragged.close();
    };

    return {
        /*
         * Starts a drag of `key` out of `source`, where `grab` is the point of the window the pointer
         * holds it by. `whole` moves `source` itself, for a window with that one tab. `tabWidth` is how
         * wide the tab is, so a window it tears off into opens with the pointer in the middle of it.
         * False when the window does not have the key.
         */
        start(source: Window, key: string, grab: ScreenPoint, whole: boolean, tabWidth: number | null = null): boolean {
            end();
            const point = deps.cursor();
            const dragged = whole ? source : deps.detach(source, key, { x: point.x - grab.x, y: point.y - grab.y });
            if (dragged === null) {
                return false;
            }
            const stopTicking = deps.every(tick);
            // A torn off window opens without the focus, so a click on it means the press that dragged it is gone.
            const offFront = whole ? () => undefined : deps.onFront(dragged, () => end());
            drag = {
                key,
                dragged,
                grab,
                halfTab: whole || tabWidth === null ? null : tabWidth / 2,
                docked: null,
                stop: () => {
                    stopTicking();
                    offFront();
                }
            };
            return true;
        },
        end,
        dragging(): boolean {
            return drag !== null;
        }
    };
}

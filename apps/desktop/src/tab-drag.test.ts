import { describe, expect, test } from 'bun:test';
import { createTabDrag, type DragWindow, type ScreenPoint } from './tab-drag';

interface FakeWindow extends DragWindow {
    name: string;
    positions: ScreenPoint[];
    opacity: number;
    sent: unknown[][];
    closed: boolean;
    focused: number;
}

function fakeWindow(name: string): FakeWindow {
    const window: FakeWindow = {
        name,
        positions: [],
        opacity: 1,
        sent: [],
        closed: false,
        focused: 0,
        setPosition: (x, y) => void window.positions.push({ x, y }),
        setOpacity: (opacity) => {
            window.opacity = opacity;
        },
        close: () => {
            window.closed = true;
        },
        focus: () => {
            window.focused++;
        },
        isDestroyed: () => window.closed,
        webContents: { send: (...args) => void window.sent.push(args) }
    };
    return window;
}

/* `under` is the window under the pointer; its strip runs along the top 40 pixels of the screen. */
function setup(under: FakeWindow | null = null) {
    let cursor = { x: 500, y: 300 };
    let tick: (() => void) | null = null;
    let front: (() => void) | null = null;
    const torn = fakeWindow('torn');
    const transfers: [string, string][] = [];
    const strips = new Map<string, { x: number; y: number; height: number }>();
    const drag = createTabDrag<FakeWindow>({
        detach: (_window, _key, at) => {
            torn.positions.push(at);
            return torn;
        },
        transfer: (key, window) => {
            transfers.push([key, window.name]);
            return true;
        },
        windowAt: () => under,
        stripX: (_window, point) => (point.y < 40 ? point.x - 100 : null),
        stripOf: (window) => strips.get(window.name) ?? null,
        cursor: () => cursor,
        every: (next) => {
            tick = next;
            return () => {
                tick = null;
            };
        },
        onFront: (_window, listener) => {
            front = listener;
            return () => {
                front = null;
            };
        }
    });
    return {
        drag,
        torn,
        transfers,
        strips,
        move: (point: ScreenPoint) => {
            cursor = point;
            tick?.();
        },
        ticking: () => tick !== null,
        click: () => front?.()
    };
}

describe('dragging a tab out of a window', () => {
    test('opens its window under the pointer and moves it along until the press lets go', () => {
        const { drag, torn, move, ticking } = setup();
        expect(drag.start(fakeWindow('source'), 'local:a', { x: 40, y: 10 }, false)).toBe(true);
        expect(torn.positions).toEqual([{ x: 460, y: 290 }]);
        move({ x: 600, y: 400 });
        expect(torn.positions.at(-1)).toEqual({ x: 560, y: 390 });
        drag.end();
        expect(ticking()).toBe(false);
        expect(torn.closed).toBe(false);
        expect(torn.focused).toBe(1);
    });

    test('over the strip of another window the tab goes in at once, and comes out again as it leaves', () => {
        const other = fakeWindow('other');
        const { drag, torn, transfers, move } = setup(other);
        drag.start(fakeWindow('source'), 'local:a', { x: 0, y: 0 }, false);
        move({ x: 300, y: 20 });
        expect(transfers).toEqual([['local:a', 'other']]);
        expect(other.sent).toEqual([['window:take-project', 'local:a', 200]]);
        expect(torn.opacity).toBe(0);
        move({ x: 350, y: 20 });
        expect(other.sent.at(-1)).toEqual(['window:tab-drag-over', 'local:a', 250]);
        move({ x: 350, y: 200 });
        expect(transfers.at(-1)).toEqual(['local:a', 'torn']);
        expect(other.sent.at(-1)).toEqual(['window:release-project', 'local:a']);
        expect(torn.opacity).toBe(1);
    });

    test('let go in the strip of another window leaves it there and closes the dragged one', () => {
        const other = fakeWindow('other');
        const { drag, torn, move } = setup(other);
        drag.start(fakeWindow('source'), 'local:a', { x: 0, y: 0 }, false);
        move({ x: 300, y: 20 });
        drag.end();
        expect(torn.closed).toBe(true);
        expect(other.focused).toBe(1);
    });

    test('let go over the body of another window, off its strip, it stays a window of its own', () => {
        const other = fakeWindow('other');
        const { drag, torn, transfers } = setup(other);
        drag.start(fakeWindow('source'), 'local:a', { x: 0, y: 0 }, false);
        drag.end();
        expect(transfers).toEqual([]);
        expect(torn.closed).toBe(false);
        expect(torn.focused).toBe(1);
    });

    test('the torn off window holds the middle of its tab under the pointer once its strip is known', () => {
        const { drag, torn, strips, move } = setup();
        drag.start(fakeWindow('source'), 'local:a', { x: 40, y: 10 }, false, 120);
        strips.set('torn', { x: 260, y: 8, height: 32 });
        move({ x: 600, y: 400 });
        expect(torn.positions.at(-1)).toEqual({ x: 280, y: 376 });
    });

    test('a click on the torn off window ends a drag whose press got lost', () => {
        const { drag, click, ticking } = setup();
        drag.start(fakeWindow('source'), 'local:a', { x: 0, y: 0 }, false);
        click();
        expect(ticking()).toBe(false);
        expect(drag.dragging()).toBe(false);
    });

    test('a window that closed with the tab in its strip gives it back to a window of its own', () => {
        const other = fakeWindow('other');
        const { drag, torn, transfers, move } = setup(other);
        drag.start(fakeWindow('source'), 'local:a', { x: 0, y: 0 }, false);
        move({ x: 300, y: 20 });
        other.close();
        const sent = other.sent.length;
        drag.end();
        expect(other.sent).toHaveLength(sent);
        expect(transfers.at(-1)).toEqual(['local:a', 'torn']);
        expect(torn.opacity).toBe(1);
        expect(torn.closed).toBe(false);
        expect(torn.focused).toBe(1);
    });

    test('a drag ends when the window that holds the press closes', () => {
        const source = fakeWindow('source');
        const { drag, torn, move, ticking } = setup();
        drag.start(source, 'local:a', { x: 0, y: 0 }, false);
        source.close();
        move({ x: 600, y: 400 });
        expect(ticking()).toBe(false);
        expect(drag.dragging()).toBe(false);
        expect(torn.focused).toBe(1);
    });

    test('the only tab of a window moves that window itself', () => {
        const other = fakeWindow('other');
        const source = fakeWindow('source');
        const { drag, torn, move } = setup(other);
        drag.start(source, 'local:a', { x: 10, y: 10 }, true);
        move({ x: 100, y: 100 });
        expect(source.positions).toEqual([{ x: 90, y: 90 }]);
        expect(torn.positions).toEqual([]);
        move({ x: 300, y: 20 });
        expect(source.opacity).toBe(0);
        drag.end();
        expect(source.closed).toBe(true);
    });
});

import { describe, expect, test } from 'bun:test';
import type { ScreenPoint } from './tab-drag';
import { HELD_BELOW_TOP, createViewDrag, type ViewDragWindow } from './view-drag';

interface FakeWindow extends ViewDragWindow {
    positions: ScreenPoint[];
    opacity: number;
    ignores: boolean;
    closed: boolean;
    focused: number;
}

function fakeWindow(): FakeWindow {
    const window: FakeWindow = {
        positions: [],
        opacity: 1,
        ignores: false,
        closed: false,
        focused: 0,
        setPosition: (x, y) => void window.positions.push({ x, y }),
        setOpacity: (opacity) => {
            window.opacity = opacity;
        },
        setIgnoreMouseEvents: (ignore) => {
            window.ignores = ignore;
        },
        getSize: () => [800, 600],
        close: () => {
            window.closed = true;
        },
        focus: () => {
            window.focused += 1;
        },
        isDestroyed: () => window.closed
    };

    return window;
}

/* `under` is the window under the pointer, and `takes` whether it may take the dragged view. */
function setup(opens = true) {
    const scene = { cursor: { x: 500, y: 300 }, under: null as FakeWindow | null, takes: false, ticking: false };
    const dragged = fakeWindow();
    let tick: () => void = () => undefined;

    const drag = createViewDrag<FakeWindow>({
        open: (_key, at) => {
            if (!opens) {
                return null;
            }

            dragged.positions.push(at);

            return dragged;
        },
        windowAt: () => scene.under,
        takes: () => scene.takes,
        cursor: () => scene.cursor,
        every: (run) => {
            tick = run;
            scene.ticking = true;

            return () => {
                scene.ticking = false;
            };
        }
    });

    return { drag, dragged, scene, tick: () => tick() };
}

describe('a view dragged out of its window', () => {
    test('opens its window under the pointer, where it lets the drag through to what lies under it', () => {
        const { drag, dragged } = setup();

        expect(drag.start('local:p1\u001fw1')).toBe(true);
        expect(dragged.positions).toEqual([{ x: 500 - 480, y: 300 - HELD_BELOW_TOP }]);
        expect(dragged.ignores).toBe(true);
    });

    test('follows the pointer by the middle of its top band', () => {
        const { drag, dragged, scene, tick } = setup();
        drag.start('local:p1\u001fw1');
        scene.cursor = { x: 640, y: 420 };
        tick();

        expect(dragged.positions.at(-1)).toEqual({ x: 640 - 400, y: 420 - HELD_BELOW_TOP });
        expect(dragged.opacity).toBe(1);
    });

    test('turns invisible over a window that may take the view, and shows again past it', () => {
        const { drag, dragged, scene, tick } = setup();
        drag.start('local:p1\u001fw1');
        scene.under = fakeWindow();
        scene.takes = true;
        tick();

        expect(dragged.opacity).toBe(0);

        scene.takes = false;
        tick();

        expect(dragged.opacity).toBe(1);
    });

    test('stays as a window that takes the pointer and the focus when nothing took the view', () => {
        const { drag, dragged, scene, tick } = setup();
        drag.start('local:p1\u001fw1');
        scene.under = fakeWindow();
        scene.takes = true;
        tick();
        drag.end(true);

        expect(dragged.closed).toBe(false);
        expect(dragged.ignores).toBe(false);
        expect(dragged.opacity).toBe(1);
        expect(dragged.focused).toBe(1);
        expect(scene.ticking).toBe(false);
        expect(drag.dragging()).toBe(false);
    });

    test('closes when something else took the view', () => {
        const { drag, dragged } = setup();
        drag.start('local:p1\u001fw1');
        drag.end(false);

        expect(dragged.closed).toBe(true);
        expect(dragged.focused).toBe(0);
    });

    test('ends when its window went, and starts nothing without a window', () => {
        const gone = setup();
        gone.drag.start('local:p1\u001fw1');
        gone.dragged.closed = true;
        gone.tick();

        expect(gone.drag.dragging()).toBe(false);
        expect(gone.scene.ticking).toBe(false);
        expect(setup(false).drag.start('local:p1\u001fw1')).toBe(false);
    });
});

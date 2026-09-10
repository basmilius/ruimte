import { describe, expect, test } from 'bun:test';
import { menuPointFor } from '@/browser/menu-point';

// A sidebar 320px wide, and a frame header plus a browser toolbar over the page.
const HOST = { left: 320, top: 84 };

describe('menuPointFor', () => {
    test('a node on the canvas at zoom 1 opens the menu where the shell reported it', () => {
        const point = menuPointFor({ x: 520, y: 284 }, HOST, 1);
        expect(point.window).toEqual({ x: 520, y: 284 });
        expect(point.guest).toEqual({ x: 200, y: 200 });
    });

    test('the same node at zoom 0.5 keeps the window point and halves the page point', () => {
        const point = menuPointFor({ x: 420, y: 134 }, HOST, 0.5);
        expect(point.window).toEqual({ x: 420, y: 134 });
        expect(point.guest).toEqual({ x: 200, y: 100 });
    });

    test('a full-column browser view is drawn one to one', () => {
        const point = menuPointFor({ x: 900, y: 500 }, HOST, 1);
        expect(point.window).toEqual({ x: 900, y: 500 });
        expect(point.guest).toEqual({ x: 580, y: 416 });
    });

    test('a collapsed sidebar leaves the two points the same', () => {
        const point = menuPointFor({ x: 640, y: 300 }, { left: 0, top: 0 }, 1);
        expect(point.window).toEqual({ x: 640, y: 300 });
        expect(point.guest).toEqual({ x: 640, y: 300 });
    });

    test('a host that has no width yet counts as unscaled', () => {
        expect(menuPointFor({ x: 420, y: 134 }, HOST, 0).guest).toEqual({ x: 100, y: 50 });
    });
});

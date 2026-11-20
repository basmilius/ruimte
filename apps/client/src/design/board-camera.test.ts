import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { FrameClock } from '@/surface/canvas/pan-batch';
import { wheelZooms } from '@/surface/canvas/use-wheel-camera';
import { createBoardCamera, type BoardCamera } from './board-camera';

const WHEEL = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, timeStamp: 0 };

let frames: (() => void)[];
let board: BoardCamera;

const clock: FrameClock = {
    request: (callback) => frames.push(callback),
    cancel: () => undefined
};

function nextFrame(): void {
    const waiting = frames;

    frames = [];
    for (const callback of waiting) {
        callback();
    }
}

beforeEach(() => {
    jest.useFakeTimers();
    frames = [];
    board = createBoardCamera(clock);
    board.store.getState().setCamera({ x: 48, y: 48, zoom: 1 });
});

afterEach(() => {
    board.dispose();
    jest.useRealTimers();
});

describe('the camera of a design board', () => {
    test('pans with two fingers by what they moved, once per frame', () => {
        board.wheel({ ...WHEEL, deltaX: 10, deltaY: 30 }, { x: 0, y: 0 });
        board.wheel({ ...WHEEL, deltaX: 5, deltaY: 0 }, { x: 0, y: 0 });
        nextFrame();

        expect(board.store.getState().camera).toEqual({ x: 33, y: 18, zoom: 1 });
    });

    test('zooms a pinch around the point under the fingers, and settles on a whole percent', () => {
        board.wheel({ ...WHEEL, deltaY: -10, ctrlKey: true }, { x: 248, y: 148 });

        const pinched = board.store.getState().camera;

        expect(pinched.zoom).toBeGreaterThan(1);
        expect(pinched.x).toBeCloseTo(248 - 200 * pinched.zoom);

        jest.advanceTimersByTime(200);

        expect(board.store.getState().camera.zoom).toBe(1.11);
    });

    test('glides a notch of a mouse wheel with the modifier to a step of the canvas', () => {
        board.wheel({ ...WHEEL, deltaY: -100, ctrlKey: true }, { x: 48, y: 48 });
        for (let i = 0; i < 40; i++) {
            nextFrame();
        }

        expect(board.store.getState().camera.zoom).toBe(1.1);
    });

    test('keeps to the zoom limits of the canvas', () => {
        board.store.getState().zoomTo(40);

        expect(board.store.getState().camera.zoom).toBe(4);
    });

    test('pans a drag by what it moved, after a wheel pan still waiting for its frame', () => {
        board.wheel({ ...WHEEL, deltaY: 20 }, { x: 0, y: 0 });
        board.pan(12, -4);

        expect(board.store.getState().camera).toEqual({ x: 60, y: 24, zoom: 1 });
    });
});

describe('a wheel that zooms', () => {
    test('holds Ctrl on every platform, as a pinch does, and Cmd only on macOS', () => {
        expect(wheelZooms({ ctrlKey: true, metaKey: false }, false)).toBe(true);
        expect(wheelZooms({ ctrlKey: true, metaKey: false }, true)).toBe(true);
        expect(wheelZooms({ ctrlKey: false, metaKey: true }, true)).toBe(true);
        expect(wheelZooms({ ctrlKey: false, metaKey: true }, false)).toBe(false);
        expect(wheelZooms({ ctrlKey: false, metaKey: false }, true)).toBe(false);
    });
});

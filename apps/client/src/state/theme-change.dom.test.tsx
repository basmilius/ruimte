import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { withoutTransitions } from '@/state/theme-change';

const realRequest = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;
let frames: Map<number, FrameRequestCallback>;

function nextFrame(): void {
    const due = [...frames];

    frames.clear();

    for (const [, callback] of due) {
        callback(0);
    }
}

beforeEach(() => {
    let id = 0;

    frames = new Map();
    globalThis.requestAnimationFrame = (callback) => {
        frames.set(++id, callback);

        return id;
    };
    globalThis.cancelAnimationFrame = (handle) => {
        frames.delete(handle);
    };
});

afterEach(() => {
    globalThis.requestAnimationFrame = realRequest;
    globalThis.cancelAnimationFrame = realCancel;
    document.documentElement.removeAttribute('data-theme-changing');
});

describe('a change of theme', () => {
    test('holds every transition until the new colors were painted', () => {
        const root = document.documentElement;
        let seen = false;

        withoutTransitions(() => {
            seen = root.hasAttribute('data-theme-changing');
        });

        expect(seen).toBe(true);
        nextFrame();
        expect(root.hasAttribute('data-theme-changing')).toBe(true);
        nextFrame();
        expect(root.hasAttribute('data-theme-changing')).toBe(false);
    });

    test('that follows another keeps holding them for its own two frames', () => {
        const root = document.documentElement;

        withoutTransitions(() => undefined);
        nextFrame();
        withoutTransitions(() => undefined);
        nextFrame();
        expect(root.hasAttribute('data-theme-changing')).toBe(true);
        nextFrame();
        expect(root.hasAttribute('data-theme-changing')).toBe(false);
    });
});

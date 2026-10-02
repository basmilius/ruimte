import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { followSpaceRelease, holdSpace, isSpaceDown, releaseSpace, spaceWorksTarget } from '@/canvas/space-pan';

/* Just enough of an element for `closest`: the simple selectors it answers to, and its parent. */
class FakeElement {
    readonly selectors: readonly string[];
    readonly parent: FakeElement | null;

    constructor(selectors: readonly string[], parent: FakeElement | null = null) {
        this.selectors = selectors;
        this.parent = parent;
    }

    closest(selector: string): FakeElement | null {
        const parts = selector.split(',').map((part) => part.trim());
        return this.selectors.some((own) => parts.includes(own)) ? this : (this.parent?.closest(selector) ?? null);
    }
}

const globals = globalThis as { Element?: unknown };
const realElement = globals.Element;

beforeAll(() => {
    globals.Element = FakeElement;
});

afterAll(() => {
    globals.Element = realElement;
});

afterEach(() => {
    releaseSpace();
});

describe('space as a pan', () => {
    test('a space held while the window loses the focus is let go', () => {
        const windowTarget = new EventTarget();
        const documentTarget = new EventTarget();
        const stop = followSpaceRelease(windowTarget, documentTarget);
        holdSpace();
        windowTarget.dispatchEvent(new Event('blur'));
        expect(isSpaceDown()).toBe(false);

        holdSpace();
        documentTarget.dispatchEvent(new Event('visibilitychange'));
        expect(isSpaceDown()).toBe(false);
        stop();

        holdSpace();
        windowTarget.dispatchEvent(new Event('blur'));
        expect(isSpaceDown()).toBe(true);
    });

    test('a switch, a checkbox and a button work a space themselves', () => {
        expect(spaceWorksTarget(new FakeElement(['button', '[role="switch"]']) as unknown as EventTarget)).toBe(true);
        expect(spaceWorksTarget(new FakeElement(['button', '[role="checkbox"]']) as unknown as EventTarget)).toBe(true);
        expect(spaceWorksTarget(new FakeElement(['button']) as unknown as EventTarget)).toBe(true);
        expect(spaceWorksTarget(new FakeElement(['span'], new FakeElement(['button'])) as unknown as EventTarget)).toBe(true);
    });

    test('a space in a popup or a dialog is theirs', () => {
        const dialog = new FakeElement(['[data-base-ui-portal]']);
        expect(spaceWorksTarget(new FakeElement(['div'], dialog) as unknown as EventTarget)).toBe(true);
    });

    test('the canvas and the body of the page leave it to the pan', () => {
        expect(spaceWorksTarget(new FakeElement(['div'], new FakeElement(['body'])) as unknown as EventTarget)).toBe(false);
        expect(spaceWorksTarget(null)).toBe(false);
        expect(spaceWorksTarget(new EventTarget())).toBe(false);
    });
});

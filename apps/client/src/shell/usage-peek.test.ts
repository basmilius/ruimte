import { describe, expect, test } from 'bun:test';
import { createUsagePeek, PEEK_DELAY_MS } from './usage-peek';

function setup() {
    const shown: boolean[] = [];
    let due: (() => void) | null = null;
    let delay = 0;

    const peek = createUsagePeek((value) => shown.push(value), {
        set: (run, ms) => {
            due = run;
            delay = ms;

            return 1;
        },
        clear: () => {
            due = null;
        }
    });

    const elapse = (): void => {
        const run = due;
        due = null;
        run?.();
    };

    return { peek, shown, elapse, delay: () => delay };
}

function key(name: string, patch: Partial<{ repeat: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) {
    return { key: name, repeat: false, metaKey: false, ctrlKey: false, shiftKey: false, ...patch };
}

describe('Option held on its own', () => {
    test('shows the usage card after the delay and hides it on release', () => {
        const { peek, shown, elapse, delay } = setup();

        peek.keyDown(key('Alt'));
        expect(shown).toEqual([]);

        elapse();
        peek.keyUp(key('Alt'));

        expect(delay()).toBe(PEEK_DELAY_MS);
        expect(shown).toEqual([true, false]);
    });

    test('a released Option before the delay shows nothing', () => {
        const { peek, shown, elapse } = setup();

        peek.keyDown(key('Alt'));
        peek.keyUp(key('Alt'));
        elapse();

        expect(shown).toEqual([]);
    });

    test('another key cancels it, so typed characters and chords show nothing', () => {
        const { peek, shown, elapse } = setup();

        peek.keyDown(key('Alt'));
        peek.keyDown(key('é'));
        elapse();

        expect(shown).toEqual([]);
    });

    test('another key hides a card that was already shown', () => {
        const { peek, shown, elapse } = setup();

        peek.keyDown(key('Alt'));
        elapse();
        peek.keyDown(key('ArrowLeft'));

        expect(shown).toEqual([true, false]);
    });

    test('Option as part of a chord or during a drag shows nothing', () => {
        const { peek, shown, elapse } = setup();

        peek.keyDown(key('Alt', { metaKey: true }));
        elapse();
        peek.pointerDown();
        peek.keyDown(key('Alt'));
        elapse();

        expect(shown).toEqual([]);
    });

    test('a click in the shown card keeps it open', () => {
        const { peek, shown, elapse } = setup();

        peek.keyDown(key('Alt'));
        elapse();
        peek.pointerDown();
        peek.pointerUp();

        expect(shown).toEqual([true]);
    });

    test('leaving the window hides it', () => {
        const { peek, shown, elapse } = setup();

        peek.keyDown(key('Alt'));
        elapse();
        peek.blur();

        expect(shown).toEqual([true, false]);
    });
});

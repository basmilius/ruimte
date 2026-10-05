import { afterEach, describe, expect, test } from 'bun:test';
import { DocumentModel } from '@ruimte/smart-editor-core';
import { easeOut, scrollDuration } from './scroll-animation.ts';
import { DEFAULT_SMART_KEYS } from './smart-keys.ts';
import { createPage } from './testing.ts';
import { EditorView, type ViewSettings } from './view.ts';

describe('how long a scroll takes', () => {
    test('nothing for a line or less, and up to a tenth of a second from eleven lines', () => {
        expect(scrollDuration(20, 20)).toBe(0);
        expect(scrollDuration(60, 20)).toBe(20);
        expect(scrollDuration(220, 20)).toBe(100);
        expect(scrollDuration(20000, 20)).toBe(100);
    });

    test('starts fast and eases out to the end', () => {
        expect(easeOut(0)).toBe(0);
        expect(easeOut(1)).toBe(1);
        expect(easeOut(0.5)).toBeGreaterThan(0.5);
        expect(easeOut(0.25)).toBeLessThan(easeOut(0.5));
        expect(easeOut(0.9)).toBeLessThan(1);
    });
});

describe('scrolling the view', () => {
    const SETTINGS: ViewSettings = {
        language: 'typescript',
        tabSize: 4,
        insertSpaces: true,
        readOnly: false,
        readOnlyReason: undefined,
        wrap: false,
        smartKeys: DEFAULT_SMART_KEYS,
        messages: {},
        guides: true,
        whitespace: false,
        rightMargin: null,
        foldOutline: 'hover'
    };
    const text = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');

    // The test page is one window for every test file of the run, so what is put on it is taken off again.
    const touched: Record<string, unknown> = {};
    afterEach(() => {
        const target = createPage().window as unknown as Record<string, unknown>;
        for (const [name, value] of Object.entries(touched)) {
            if (value === undefined) {
                delete target[name];
            } else {
                target[name] = value;
            }
        }
    });

    function mount(options: { reducedMotion?: boolean } = {}) {
        const page = createPage();
        const frames: ((time: number) => void)[] = [];
        const target = page.window as unknown as Record<string, unknown>;
        for (const name of ['requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia']) {
            if (!(name in touched)) {
                touched[name] = target[name];
            }
        }
        target.requestAnimationFrame = (callback: (time: number) => void): number => frames.push(callback);
        target.cancelAnimationFrame = (): void => undefined;
        if (options.reducedMotion) {
            target.matchMedia = () => ({ matches: true });
        }
        const model = new DocumentModel(text);
        const view = new EditorView(page.host, model, SETTINGS);
        const run = (time: number): void => {
            const due = frames.splice(0);
            for (const frame of due) {
                frame(time);
            }
        };
        run(0);
        return { view, model, run, frames };
    }

    test('goes there over a few frames, to the place a jump asked for', () => {
        const { view, model, run } = mount();
        view.revealOffset(model.getLine(200).start, 'center');
        expect(view.viewport.scrollTop).toBe(0);
        expect(view.scrollPlace.y).toBe(200 * 20 - 133);
        run(1000);
        const first = view.viewport.scrollTop;
        expect(first).toBe(0);
        run(1050);
        expect(view.viewport.scrollTop).toBeGreaterThan(0);
        expect(view.viewport.scrollTop).toBeLessThan(200 * 20 - 133);
        run(1100);
        expect(view.viewport.scrollTop).toBe(200 * 20 - 133);
    });

    test('is interrupted by the next scroll, which starts from where the view is', () => {
        const { view, model, run } = mount();
        view.revealOffset(model.getLine(200).start, 'center');
        run(1000);
        run(1040);
        const middle = view.viewport.scrollTop;
        view.revealOffset(model.getLine(10).start, 'center');
        expect(view.viewport.scrollTop).toBe(middle);
        view.cancelScroll();
        run(1200);
        expect(view.viewport.scrollTop).toBe(middle);
    });

    test('moves a line at once, and everything at once when motion is reduced', () => {
        const near = mount();
        near.view.revealOffset(near.model.getLine(19).start);
        expect(near.view.viewport.scrollTop).toBe(20);
        const reduced = mount({ reducedMotion: true });
        reduced.view.revealOffset(reduced.model.getLine(200).start, 'center');
        expect(reduced.view.viewport.scrollTop).toBe(200 * 20 - 133);
    });
});

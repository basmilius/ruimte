import { describe, expect, test } from 'bun:test';
import { isPageReady, trackPageReady, type FindablePage } from './use-preview-find';

function page(): FindablePage {
    return new EventTarget() as unknown as FindablePage;
}

describe('isPageReady', () => {
    test('holds a page back until its guest fired dom-ready', () => {
        const element = page();
        trackPageReady(element);

        expect(isPageReady(element)).toBe(false);

        element.dispatchEvent(new Event('dom-ready'));

        expect(isPageReady(element)).toBe(true);
    });

    test('never counts a page it does not track', () => {
        const element = page();
        element.dispatchEvent(new Event('dom-ready'));

        expect(isPageReady(element)).toBe(false);
    });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { createMetrics, readEditorFont } from './metrics.ts';
import { createPage } from './testing.ts';

/* linkedom shares one window between pages, so the style it answers with is put back after each test. */
const restores: (() => void)[] = [];

afterEach(() => {
    for (const restore of restores.splice(0)) {
        restore();
    }
});

function elementWith(style: Partial<CSSStyleDeclaration>): HTMLElement {
    const { document, window } = createPage();
    const original = Object.getOwnPropertyDescriptor(window, 'getComputedStyle');
    Object.defineProperty(window, 'getComputedStyle', { value: () => style, configurable: true, writable: true });
    restores.push(() => {
        if (original) {
            Object.defineProperty(window, 'getComputedStyle', original);
        } else {
            delete (window as unknown as Record<string, unknown>).getComputedStyle;
        }
    });
    return document.createElement('div');
}

describe('readEditorFont', () => {
    test('reads the face the page sets, in whole pixels', () => {
        const element = elementWith({ fontFamily: 'Menlo', fontSize: '13px', lineHeight: '19.5px' });
        expect(readEditorFont(element)).toEqual({ family: 'Menlo', size: 13, lineHeight: 20 });
    });

    test('takes one and a half lines for a line height the page leaves at normal', () => {
        const element = elementWith({ fontFamily: 'Menlo', fontSize: '14px', lineHeight: 'normal' });
        expect(readEditorFont(element).lineHeight).toBe(21);
    });

    test('falls back to a face of its own on a page without styles', () => {
        const { document } = createPage();
        expect(readEditorFont(document.createElement('div'))).toEqual({ family: 'monospace', size: 13, lineHeight: 20 });
    });
});

describe('createMetrics', () => {
    test('sets a character at 0.6 of the size without a canvas and counts a wide one as one character', () => {
        const { document } = createPage();
        const metrics = createMetrics({ family: 'monospace', size: 10, lineHeight: 16 }, 2, document);
        expect(metrics.lineHeight).toBe(16);
        expect(metrics.charWidth).toBe(6);
        expect(metrics.tabSize).toBe(2);
        expect(metrics.measureText('あ')).toBe(6);
    });
});

import { describe, expect, test } from 'bun:test';
import { injectVisualBootstrap } from '@ruimte/contracts';
import { PAGE_URL, PageSource } from './page-source.ts';

const PAGE = ['<!doctype html>', '<html>', '<head>', '<title>Bars</title>', '</head>', '<body>', '<script>', 'boom();', '</script>', '</body>', '</html>'].join(
    '\n'
);

/* The 1-based line and column of `needle` in `text`. */
function placeOf(text: string, needle: string): { line: number; column: number } {
    const offset = text.indexOf(needle);
    const before = text.slice(0, offset);
    const line = before.split('\n').length;
    return { line, column: offset - before.lastIndexOf('\n') };
}

describe('PageSource', () => {
    test('serves the page with the bootstrap in front of it', () => {
        expect(new PageSource(PAGE).served).toBe(injectVisualBootstrap(PAGE));
    });

    test('maps a place after the bootstrap back to the line the agent wrote', () => {
        const source = new PageSource(PAGE);
        const served = placeOf(source.served, 'boom();');
        expect(served.line).toBeGreaterThan(8);
        expect(source.position(served.line, served.column)).toEqual({ line: 8, column: 1 });
    });

    test('keeps a place before the bootstrap where it is, and has none inside it', () => {
        const source = new PageSource(PAGE);
        expect(source.position(1, 3)).toEqual({ line: 1, column: 3 });
        const inside = placeOf(source.served, 'data-visual-theme');
        expect(source.position(inside.line, inside.column)).toBeNull();
        expect(source.position(10_000, 1)).toBeNull();
    });

    test('maps a column on a line the bootstrap went into the middle of', () => {
        const page = '<html><head><title>x</title></head><body><script>boom();</script></body></html>';
        const source = new PageSource(page);
        const served = placeOf(source.served, 'boom();');
        expect(source.position(served.line, served.column)).toEqual({ line: 1, column: page.indexOf('boom();') + 1 });
    });

    test('names the page page.html with the place the agent wrote, and other files on its origin by their path', () => {
        const source = new PageSource(PAGE);
        const served = placeOf(source.served, 'boom();');
        const stack = `ReferenceError: boom is not defined\n    at ${PAGE_URL}:${served.line}:${served.column}`;
        expect(source.describe(stack)).toBe('ReferenceError: boom is not defined\n    at page.html:8:1');
        expect(source.describe(`at ${PAGE_URL}#visual-theme=x:${served.line}:${served.column}`)).toBe('at page.html:8:1');
        expect(source.describe(`Failed to load resource (${PAGE_URL})`)).toBe('Failed to load resource (page.html)');
        expect(source.describe('Failed to load resource (https://visual.invalid/img/logo.png)')).toBe('Failed to load resource (img/logo.png)');
        expect(source.describe('https://cdn.example.com/lib.js')).toBe('https://cdn.example.com/lib.js');
    });
});

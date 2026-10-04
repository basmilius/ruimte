import { describe, expect, test } from 'bun:test';
import { lineTextOf, peekFilesOf, snippetOf } from './peek-model';

const at = (line: number, character: number) => ({ line, character });
const place = (uri: string, line: number) => ({ uri, range: { start: at(line, 2), end: at(line, 6) } });

describe('the places of a peek', () => {
    test('groups by file with the open file first, the others in the order given, and each file by line', () => {
        const texts: Record<string, string> = { 'file:///a.ts': 'one\n  two\nthree', 'file:///b.ts': 'x\n\ty\nz' };
        const files = peekFilesOf([place('file:///b.ts', 1), place('file:///a.ts', 2), place('file:///a.ts', 1)], 'file:///a.ts', (uri) => texts[uri] ?? null);
        expect(files.map((file) => file.uri)).toEqual(['file:///a.ts', 'file:///b.ts']);
        expect(files[0]!.places.map((entry) => [entry.id, entry.line, entry.text])).toEqual([
            ['0:0', 1, 'two'],
            ['0:1', 2, 'three']
        ]);
        expect(files[1]!.places[0]).toMatchObject({ id: '1:0', text: 'y' });
    });

    test('has no line for a file whose text is not at hand', () => {
        expect(peekFilesOf([place('file:///a.ts', 1)], 'file:///x.ts', () => null)[0]!.places[0]!.text).toBe('');
        expect(lineTextOf('a', 9)).toBe('');
    });

    test('takes a few lines around the reference for the preview', () => {
        const text = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n');
        const snippet = snippetOf(text, 15);
        expect(snippet.startLine).toBe(10);
        expect(snippet.text.split('\n')).toHaveLength(14);
        expect(snippet.text.split('\n')[snippet.active]).toBe('line 15');
        expect(snippetOf(text, 1)).toMatchObject({ startLine: 0, active: 1 });
        expect(snippetOf('a\nb', 1).text).toBe('a\nb');
    });
});

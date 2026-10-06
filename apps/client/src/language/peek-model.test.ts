import { describe, expect, test } from 'bun:test';
import { definitionSnippetOf, peekFilesOf, snippetOf, visualColumnOf } from '@adecore/editor-react/models';

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
    });

    test('finds the name in the trimmed line of a place', () => {
        const files = peekFilesOf([place('file:///a.ts', 1), place('file:///a.ts', 2)], 'file:///a.ts', () => 'one\n  two\nxx');
        expect(files[0]!.places.map((entry) => entry.name)).toEqual([{ start: 0, end: 3 }, null]);
        expect(peekFilesOf([place('file:///a.ts', 1)], 'file:///a.ts', () => null)[0]!.places[0]!.name).toBeNull();
    });

    test('takes a few lines around the reference for the preview', () => {
        const text = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n');
        const snippet = snippetOf(text, 15, place('', 15).range);
        expect(snippet.startLine).toBe(12);
        expect(snippet.text.split('\n')).toHaveLength(12);
        expect(snippet.text.split('\n')[snippet.active]).toBe('line 15');
        expect(snippet.name).toEqual({ start: 2, end: 6 });
        expect(snippetOf(text, 1, place('', 1).range)).toMatchObject({ startLine: 0, active: 1 });
        expect(snippetOf('a\nb', 1, place('', 1).range).text).toBe('a\nb');
    });

    test('counts a tab as the stop it reaches', () => {
        expect(visualColumnOf('\t\tfoo', 2, 4)).toBe(8);
        expect(visualColumnOf('a\tb', 2, 4)).toBe(4);
        expect(visualColumnOf('abc', 9, 4)).toBe(3);
    });
});

describe('definitionSnippetOf', () => {
    const text = Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n');
    const at = (line: number) => ({ line, character: 0 });
    const range = { start: at(0), end: at(0) };

    test('takes the lines of the declaration, and a screenful of a long one', () => {
        expect(definitionSnippetOf(text, 5, { start: at(4), end: at(8) }, range)).toMatchObject({
            startLine: 4,
            active: 1,
            text: 'line 4\nline 5\nline 6\nline 7\nline 8'
        });
        const long = definitionSnippetOf(text, 5, { start: at(4), end: at(50) }, range);
        expect(long.text.split('\n')).toHaveLength(25);
    });

    test('starts a little above the name when the server gave no declaration', () => {
        expect(definitionSnippetOf(text, 10, null, range)).toMatchObject({ startLine: 8, active: 2 });
        expect(definitionSnippetOf(text, 0, null, range).startLine).toBe(0);
    });
});

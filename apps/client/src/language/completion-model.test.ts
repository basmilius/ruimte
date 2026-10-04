import { describe, expect, test } from 'bun:test';
import type { CompletionItem } from '@ruimte/smart-editor-lsp';
import { identifierPrefix, insertionOf, itemsOf, matchScore, prefixFor, rankCompletions, snippetToText } from './completion-model';

const at = (line: number, character: number) => ({ line, character });
const item = (label: string, extra: Partial<CompletionItem> = {}): CompletionItem => ({ label, ...extra });

describe('identifierPrefix', () => {
    test('is the word at the end of the text, and empty after a dot or a space', () => {
        expect(identifierPrefix('  .map(c => c.fil')).toBe('fil');
        expect(identifierPrefix('foo.')).toBe('');
        expect(identifierPrefix('let $naïve_1')).toBe('$naïve_1');
    });
});

describe('matchScore', () => {
    test('ranks a prefix before a prefix that ignores case, a hump, initials and a scatter', () => {
        const scores = [
            matchScore('filter', 'fil'),
            matchScore('Filter', 'fil'),
            matchScore('getFilter', 'fil'),
            matchScore('findLastIndex', 'fli'),
            matchScore('filesystem', 'fsm')
        ];
        expect(scores[0]).toBe(0);
        expect(scores[1]).toBe(1);
        expect(scores[2]).toBeGreaterThanOrEqual(2);
        expect(scores[2]).toBeLessThan(3);
        expect(scores[3]).toBe(3);
        expect(scores[4]).toBeGreaterThan(3);
    });

    test('rejects what does not fit, and a scatter of one letter', () => {
        expect(matchScore('filter', 'xyz')).toBeUndefined();
        expect(matchScore('filter', 'x')).toBeUndefined();
        expect(matchScore('filter', '')).toBe(0);
    });

    test('matches the camel humps of a name', () => {
        expect(matchScore('getElementById', 'gebi')).toBe(3);
        expect(matchScore('getElementById', 'ById')).toBeGreaterThanOrEqual(2);
    });
});

describe('rankCompletions', () => {
    test('orders by fit, then preselect, then the server sort text', () => {
        const items = [
            item('findLast', { sortText: '2' }),
            item('fill', { sortText: '1' }),
            item('Filter', { sortText: '0' }),
            item('filter', { sortText: '3' }),
            item('floor', { preselect: true })
        ];
        const ranked = rankCompletions(items, () => 'fil').map((entry) => entry.item.label);
        expect(ranked).toEqual(['fill', 'filter', 'Filter', 'findLast']);
    });
});

describe('prefixFor', () => {
    const text = (range: { start: { line: number; character: number }; end: { line: number; character: number } }) =>
        'thisArg.fil'.slice(range.start.character, range.end.character);

    test("uses the start of the item's own range when the caret is in it", () => {
        const withRange = item('filter', { textEdit: { range: { start: at(0, 8), end: at(0, 11) }, newText: 'filter' } });
        expect(prefixFor(withRange, at(0, 11), 'thisArg.fil', text)).toBe('fil');
        expect(prefixFor(item('filter'), at(0, 11), 'thisArg.fil', text)).toBe('fil');
    });
});

describe('insertionOf', () => {
    test("replaces the word typed so far, and takes the item's text", () => {
        expect(insertionOf(item('filter'), at(0, 11), 'thisArg.fil', false)).toEqual({ range: { start: at(0, 8), end: at(0, 11) }, text: 'filter', stops: [] });
    });

    test('takes the insert range for Enter and the replace range for Tab', () => {
        const both = item('filter', {
            textEdit: { newText: 'filter', insert: { start: at(0, 8), end: at(0, 11) }, replace: { start: at(0, 8), end: at(0, 14) } }
        });
        expect(insertionOf(both, at(0, 11), 'thisArg.fil', false).range.end).toEqual(at(0, 11));
        expect(insertionOf(both, at(0, 11), 'thisArg.fil', true).range.end).toEqual(at(0, 14));
    });

    test('takes what was typed since the answer came into the range it replaces', () => {
        const stale = item('filter', { textEdit: { range: { start: at(0, 8), end: at(0, 10) }, newText: 'filter' } });
        expect(insertionOf(stale, at(0, 12), 'thisArg.fill', false).range).toEqual({ start: at(0, 8), end: at(0, 12) });
    });

    test('inserts a snippet as its text, with the stops Tab goes through', () => {
        const insertion = insertionOf(item('log', { insertText: 'console.log(${1:value})$0', insertTextFormat: 2 }), at(0, 3), 'log', false);
        expect(insertion.text).toBe('console.log(value)');
        expect(insertion.stops).toEqual([
            { index: 1, start: 12, end: 17 },
            { index: 0, start: 18, end: 18 }
        ]);
    });

    test('leaves the call off a function that already has its parentheses', () => {
        const call = item('log', { kind: 3, insertText: 'log(${1:value})$0', insertTextFormat: 2 });
        expect(insertionOf(call, at(0, 3), 'log', false, '(1)').text).toBe('log');
        expect(insertionOf(call, at(0, 3), 'log', false, ' + 1').text).toBe('log(value)');
        const variable = item('log', { kind: 6, insertText: 'log(${1:value})$0', insertTextFormat: 2 });
        expect(insertionOf(variable, at(0, 3), 'log', false, '(1)').text).toBe('log(value)');
    });

    test('looks for the parenthesis past the range a Tab replaces', () => {
        const call = item('log', {
            kind: 2,
            textEdit: { newText: 'log(${1:a})$0', insert: { start: at(0, 0), end: at(0, 2) }, replace: { start: at(0, 0), end: at(0, 3) } },
            insertTextFormat: 2
        });
        expect(insertionOf(call, at(0, 2), 'lo', true, 'g(x)').text).toBe('log');
        expect(insertionOf(call, at(0, 2), 'lo', false, 'g(x)').text).toBe('log(a)');
    });
});

describe('snippetToText', () => {
    test('drops tab stops, keeps placeholders and choices, and undoes escapes', () => {
        expect(snippetToText('for (const ${1:item} of ${2|items,list|}) {\n\t$0\n}')).toBe('for (const item of items) {\n\t\n}');
        expect(snippetToText('cost: \\$5 \\} $TM_FILENAME ${name}')).toBe('cost: $5 }  ');
    });
});

describe('itemsOf', () => {
    test("gives each item the list's default edit range, and says when the list is incomplete", () => {
        const result = itemsOf({
            isIncomplete: true,
            itemDefaults: { editRange: { start: at(1, 2), end: at(1, 4) }, insertTextFormat: 2 },
            items: [item('a', { textEditText: 'aa' })]
        });
        expect(result.incomplete).toBe(true);
        expect(result.items[0]).toMatchObject({ textEdit: { newText: 'aa', range: { start: at(1, 2), end: at(1, 4) } }, insertTextFormat: 2 });
        expect(itemsOf(null)).toEqual({ items: [], incomplete: false });
    });
});

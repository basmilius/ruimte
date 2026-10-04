import { describe, expect, test } from 'bun:test';
import type { CompletionItem } from '@ruimte/smart-editor-lsp';
import {
    completionDocsOf,
    identifierPrefix,
    insertionOf,
    itemsOf,
    matchDetail,
    matchedCharacters,
    matchScore,
    mirroredInsertions,
    prefixFor,
    qualifierOf,
    qualifiersOf,
    rankCompletions,
    snippetToText
} from './completion-model';

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

describe('matched characters', () => {
    test('names the characters of the label a prefix matched, whichever way it matched', () => {
        expect(matchedCharacters('filterAll', 'fil')).toEqual([0, 1, 2]);
        expect(matchedCharacters('filterAll', 'FIL')).toEqual([0, 1, 2]);
        expect(matchedCharacters('getElementById', 'ById')).toEqual([10, 11, 12, 13]);
        expect(matchedCharacters('getElementById', 'gebi')).toEqual([0, 3, 10, 12]);
        expect(matchedCharacters('filterAll', 'flr')).toEqual([0, 2, 5]);
        expect(matchedCharacters('filterAll', 'zz')).toEqual([]);
        expect(matchedCharacters('filterAll', '')).toEqual([]);
        expect(matchDetail('filterAll', 'fil')?.score).toBe(matchScore('filterAll', 'fil'));
    });
});

/* As intelephense answers `#[P`, with the namespace in `labelDetails.description` and the import as `detail`. */
const PHP_PROPERTY_ORM = item('Property', {
    kind: 4,
    detail: 'use Raxos\\Database\\Orm\\Property',
    labelDetails: { description: 'Raxos\\Database\\Orm' }
});
const PHP_PROPERTY_OPENAPI = item('Property', {
    kind: 4,
    detail: 'use Raxos\\OpenApi\\Attribute\\Property',
    labelDetails: { description: 'Raxos\\OpenApi\\Attribute' }
});

describe('qualifiers', () => {
    test('shows the namespace of a PHP class, the module of an auto import and the type of the rest', () => {
        expect(qualifierOf(PHP_PROPERTY_ORM)).toBe('Raxos\\Database\\Orm');
        expect(qualifierOf(item('parseFoo', { kind: 3, detail: 'void', labelDetails: { detail: '($a, $b)', description: 'Raxos\\Database\\Orm' } }))).toBe(
            'Raxos\\Database\\Orm'
        );
        expect(qualifierOf(item('parseFoo', { kind: 3, detail: './lib' }))).toBe('./lib');
        expect(qualifierOf(item('map', { kind: 2 }))).toBe('');
    });

    test('reads the namespace off a `use` detail when a server sends no description', () => {
        expect(qualifierOf(item('Property', { detail: 'use Raxos\\OpenApi\\Attribute\\Property' }))).toBe('Raxos\\OpenApi\\Attribute');
    });

    test('tells two items of one label apart', () => {
        expect(qualifiersOf([PHP_PROPERTY_ORM, item('Parameter', { kind: 4 }), PHP_PROPERTY_OPENAPI])).toEqual([
            'Raxos\\Database\\Orm',
            '',
            'Raxos\\OpenApi\\Attribute'
        ]);
        const sameNamespace = [
            item('Property', { detail: 'use A\\B\\Property', labelDetails: { description: 'A\\B' } }),
            item('Property', { detail: 'use A\\B\\Other\\Property', labelDetails: { description: 'A\\B' } })
        ];
        expect(qualifiersOf(sameNamespace)).toEqual(['A\\B', 'A\\B\\Other']);
        expect(qualifiersOf([item('Property'), item('Property')])).toEqual(['#1', '#2']);
    });
});

describe('ranking by choice', () => {
    test('puts the item chosen lately first among equal matches, and never above a better match', () => {
        const items = [item('fill', { sortText: '0' }), item('filter', { sortText: '1' }), item('Fillet', { sortText: '2' })];
        const recent = (chosen: string) => (candidate: CompletionItem) => (candidate.label === chosen ? 1 : 0);
        expect(rankCompletions(items, () => 'fil', recent('filter')).map((entry) => entry.item.label)).toEqual(['filter', 'fill', 'Fillet']);
        expect(rankCompletions(items, () => 'fil', recent('Fillet')).map((entry) => entry.item.label)).toEqual(['fill', 'filter', 'Fillet']);
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

describe('mirroredInsertions', () => {
    const lines = ['fo + 1', 'xfo + 2', 'fo;', 'fo + fo'];
    const text = (range: { start: { line: number; character: number }; end: { line: number; character: number } }): string =>
        lines[range.start.line]!.slice(range.start.character, range.end.line === range.start.line ? range.end.character : undefined);
    const caret = (line: number, character: number) => ({ start: at(line, character), end: at(line, character) });
    const insertion = { range: { start: at(0, 0), end: at(0, 2) }, text: 'foo()', stops: [] };

    test('inserts the same text at each other caret that has the same word before it', () => {
        const edits = mirroredInsertions([caret(2, 2), caret(3, 2), caret(0, 2)], caret(0, 2), at(0, 2), text, insertion);
        expect(edits).toEqual([
            { range: { start: at(2, 0), end: at(2, 2) }, text: 'foo()' },
            { range: { start: at(3, 0), end: at(3, 2) }, text: 'foo()' }
        ]);
    });

    test('leaves a caret with another word before it, a selection and the primary caret alone', () => {
        const other = { start: at(1, 1), end: at(1, 3) };
        expect(mirroredInsertions([caret(1, 3), other, caret(0, 2)], caret(0, 2), at(0, 2), text, insertion)).toEqual([]);
    });

    test('takes what the primary replaces after its caret along, where the other has the same', () => {
        const replacing = { range: { start: at(0, 0), end: at(0, 5) }, text: 'foo', stops: [] };
        const rows = ['fo + 1', 'fo + 2', 'fo;'];
        const read = (range: { start: { line: number; character: number }; end: { line: number; character: number } }): string =>
            rows[range.start.line]!.slice(range.start.character, range.end.character);
        const edits = mirroredInsertions([caret(1, 2), caret(2, 2), caret(0, 2)], caret(0, 2), at(0, 2), read, replacing);
        expect(edits).toEqual([{ range: { start: at(1, 0), end: at(1, 5) }, text: 'foo' }]);
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

describe('completionDocsOf', () => {
    const phpDoc = [
        '__Raxos\\\\Database\\\\Orm\\\\Attribute\\\\PrimaryKey__',
        '',
        'Marks the primary key of a model.',
        '',
        '```php',
        '<?php',
        'final class PrimaryKey { }',
        '```',
        '',
        '<code>#[PrimaryKey] public int $id;</code>',
        '',
        '_@see_ `Raxos\\Database\\Orm\\Attribute\\Property`',
        '',
        '_@since_ 1.0'
    ].join('\n');

    test('keeps the `use` line of a PHP class apart and hands the documentation over as a hover would have it', () => {
        const docs = completionDocsOf(
            item('PrimaryKey', { detail: 'use Raxos\\Database\\Orm\\Attribute\\PrimaryKey', documentation: { kind: 'markdown', value: phpDoc } }),
            'php'
        );
        expect(docs?.source).toBe('use Raxos\\Database\\Orm\\Attribute\\PrimaryKey');
        expect(docs?.text.signatures).toEqual([]);
        expect(docs?.text.markdown).toContain('Marks the primary key');
    });

    test('splits the auto import line of a TypeScript item from the signature that follows', () => {
        const docs = completionDocsOf(item('parseFoo', { detail: "Auto import from './lib'\nfunction parseFoo(a: number): void" }), 'typescript');
        expect(docs).toEqual({
            source: "Auto import from './lib'",
            text: { signatures: [{ language: 'typescript', code: 'function parseFoo(a: number): void' }], markdown: '' }
        });
    });

    test('takes a plain detail as the signature, and says nothing when there is nothing to say', () => {
        expect(completionDocsOf(item('map', { detail: 'map(): void' }), 'typescript')?.text.signatures).toEqual([
            { language: 'typescript', code: 'map(): void' }
        ]);
        expect(completionDocsOf(item('map'), 'typescript')).toBeNull();
    });
});

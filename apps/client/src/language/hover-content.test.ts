import { describe, expect, test } from 'bun:test';
import { hoverSectionsOf, hoverTextOf, isEmptyHover, locationsOf, splitDocTags, splitSignatures } from './hover-content';

describe('splitSignatures', () => {
    test('takes the leading code as the signature and the prose after the rule as the documentation', () => {
        const text = splitSignatures(
            '```typescript\nfunction skillOverlap(have: string[]): number\n```\n---\nShare of required skills.\n\n```ts\nexample()\n```'
        );
        expect(text.signatures).toEqual([{ language: 'typescript', code: 'function skillOverlap(have: string[]): number' }]);
        expect(text.markdown).toBe('Share of required skills.\n\n```ts\nexample()\n```');
    });

    test('takes several leading blocks, and text without any as prose', () => {
        expect(splitSignatures('```ts\na\n```\n```ts\nb\n```').signatures.map((block) => block.code)).toEqual(['a', 'b']);
        expect(splitSignatures('Just words.')).toEqual({ signatures: [], markdown: 'Just words.' });
    });
});

describe('hoverTextOf', () => {
    test('reads markup content, a marked string and a list of them', () => {
        expect(hoverTextOf({ contents: { kind: 'markdown', value: '```ts\nlet a: number\n```' } }).signatures).toHaveLength(1);
        expect(hoverTextOf({ contents: { language: 'ts', value: 'let a' } }).signatures).toEqual([{ language: 'ts', code: 'let a' }]);
        const list = hoverTextOf({ contents: [{ language: 'php', value: 'function f()' }, 'Does a thing.'] });
        expect(list.signatures).toHaveLength(1);
        expect(list.markdown).toBe('Does a thing.');
    });

    test('escapes plain text, so its characters are not read as markdown', () => {
        expect(hoverTextOf({ contents: { kind: 'plaintext', value: 'a_b *c*' } }).markdown).toBe('a\\_b \\*c\\*');
    });

    test('knows an empty hover', () => {
        expect(isEmptyHover(hoverTextOf({ contents: '' }))).toBe(true);
    });
});

describe('locationsOf', () => {
    test('lands links on the name of the symbol', () => {
        const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };
        expect(locationsOf([{ targetUri: 'file:///a.ts', targetRange: range, targetSelectionRange: range }])).toEqual([{ uri: 'file:///a.ts', range }]);
        expect(locationsOf(null)).toEqual([]);
        expect(locationsOf({ uri: 'file:///b.ts', range })).toEqual([{ uri: 'file:///b.ts', range }]);
    });
});

describe('splitDocTags', () => {
    test('takes the tags of the PHP server, a paragraph each', () => {
        const split = splitDocTags('Returns the cost.\n\n_@since_ 04-08-2024\n\n_@author_ Bas Milius <bas@mili.us>\n\n_@package_ Passly\\Data\\Dto');
        expect(split.markdown).toBe('Returns the cost.');
        expect(split.tags).toEqual([
            { name: 'author', markdown: 'Bas Milius <bas@mili.us>' },
            { name: 'package', markdown: 'Passly\\Data\\Dto' },
            { name: 'since', markdown: '04-08-2024' }
        ]);
    });

    test('drops the dashes the TypeScript server puts between a tag, its parameter and its text', () => {
        const split = splitDocTags('Share.\n\n*@returns* — a fraction\n\n*@param* `have` — the skills\n\n*@param* `need` — the required');
        expect(split.tags).toEqual([
            { name: 'param', markdown: '`have` the skills' },
            { name: 'param', markdown: '`need` the required' },
            { name: 'returns', markdown: 'a fraction' }
        ]);
    });

    test('leaves prose that mentions an @ and an example as they are', () => {
        const text = 'Mail @bas about it.\n\n*@example*\n```ts\nshare()\n```';
        expect(splitDocTags(text)).toEqual({ markdown: text, tags: [] });
    });
});

describe('hoverSectionsOf', () => {
    const php =
        '__Passly\\Message\\IssueTicketsMessage__\n\nClass IssueTicketsMessage\n\n```php\n<?php\nfinal class IssueTicketsMessage {\n```\n\n---\n\n' +
        '__Passly\\\\Message\\\\IssueTicketsMessage::\\_\\_construct__\n\nIssueTicketsMessage constructor.\n\n```php\n<?php\npublic function __construct(string $id) {\n```\n\n_@param_ `string $id`\n\n---\n\n' +
        '__Passly\\Message\\IssueTicketsMessage::__construct__\n\nIssueTicketsMessage constructor.\n\n```php\n<?php\npublic function __construct(string $id) {\n```\n\n_@param_ `string $id`';

    test("splits the PHP server's symbols at its rules, with the snippet as the signature and the tags apart", () => {
        const sections = hoverSectionsOf(hoverTextOf({ contents: { kind: 'markdown', value: php } }));
        expect(sections).toHaveLength(2);
        expect(sections[0]).toEqual({
            title: 'Passly\\Message\\IssueTicketsMessage',
            signatures: [{ language: 'php', code: 'final class IssueTicketsMessage {' }],
            markdown: 'Class IssueTicketsMessage',
            tags: []
        });
        expect(sections[1]!.title).toBe('Passly\\Message\\IssueTicketsMessage::__construct');
        expect(sections[1]!.tags).toEqual([{ name: 'param', markdown: '`string $id`' }]);
    });

    test("keeps the TypeScript server's leading signature with the prose after its rule", () => {
        const sections = hoverSectionsOf(splitSignatures('```ts\nfunction share(): number\n```\n---\nShare.\n\n*@returns* — a fraction'));
        expect(sections).toEqual([
            {
                title: null,
                signatures: [{ language: 'ts', code: 'function share(): number' }],
                markdown: 'Share.',
                tags: [{ name: 'returns', markdown: 'a fraction' }]
            }
        ]);
    });
});

import { describe, expect, test } from 'bun:test';
import { hoverTextOf, isEmptyHover, locationsOf, splitSignatures } from './hover-content';

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

import { describe, expect, test } from 'bun:test';
import { STASH_LIMIT, parseStash, stashedFrom, withStashed, type StashedPrompt } from './stash.ts';
import { EMPTY_DRAFT } from './drafts.ts';

const prompt = (id: string): StashedPrompt => ({ id, text: id, mentions: [], skills: [], attachments: [], createdAt: 1 });

describe('parseStash', () => {
    test('reads what it knows and drops the rest', () => {
        const raw = JSON.stringify([
            { id: 'a', text: 'hello', mentions: ['src/a.ts', 7], skills: ['unslop'], attachments: [{ name: 'a.png', mime: 'image/png', size: 12 }], extra: 1 },
            { id: 'b' },
            'nope'
        ]);
        expect(parseStash(raw)).toEqual([
            {
                id: 'a',
                text: 'hello',
                mentions: ['src/a.ts'],
                skills: ['unslop'],
                attachments: [{ name: 'a.png', mime: 'image/png', size: 12 }],
                createdAt: 0
            }
        ]);
    });

    test('an empty, a broken or a non-list value is no stash at all', () => {
        expect(parseStash(null)).toEqual([]);
        expect(parseStash('{')).toEqual([]);
        expect(parseStash('{"id":"a"}')).toEqual([]);
    });
});

describe('withStashed', () => {
    test('puts the newest first and drops the oldest past the limit', () => {
        const full = Array.from({ length: STASH_LIMIT }, (_unused, index) => prompt(`p${index}`));
        const next = withStashed(full, prompt('fresh'));
        expect(next).toHaveLength(STASH_LIMIT);
        expect(next[0]?.id).toBe('fresh');
        expect(next.at(-1)?.id).toBe(`p${STASH_LIMIT - 2}`);
    });
});

describe('stashedFrom', () => {
    test('keeps the text, the mentions, the skills and what the files were', () => {
        const draft = {
            text: 'look at @src/a.ts',
            mentions: ['src/a.ts'],
            skills: ['unslop'],
            attachments: [{ name: 'shot.png', mime: 'image/png', data: 'AAAA' }],
            quote: ''
        };
        expect(stashedFrom(draft, 'id-1', 5)).toEqual({
            id: 'id-1',
            text: 'look at @src/a.ts',
            mentions: ['src/a.ts'],
            skills: ['unslop'],
            attachments: [{ name: 'shot.png', mime: 'image/png', size: 3 }],
            createdAt: 5
        });
    });

    test('keeps a quote as the blockquote it would have been sent as', () => {
        expect(stashedFrom({ ...EMPTY_DRAFT, text: 'Why?', quote: 'One.' }, 'id-1', 5)?.text).toBe('> One.\n\nWhy?');
    });

    test('a draft with nothing in it is not worth a slot', () => {
        expect(stashedFrom(EMPTY_DRAFT, 'id-1', 5)).toBeNull();
        expect(stashedFrom({ ...EMPTY_DRAFT, text: '   ' }, 'id-1', 5)).toBeNull();
    });
});

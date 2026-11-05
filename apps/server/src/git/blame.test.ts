import { describe, expect, test } from 'bun:test';
import { parseBlame } from './blame.ts';

const FIRST = 'a'.repeat(40);
const SECOND = 'b'.repeat(40);

describe('parsing', () => {
    test('reads the fields of a commit once and its lines as often as they come', () => {
        const output = [
            `${FIRST} 1 1 2`,
            'author Ada Lovelace',
            'author-mail <ada@example.com>',
            'author-time 1700000000',
            'author-tz +0100',
            'summary Add the engine',
            'filename a.ts',
            '\tfirst line',
            `${FIRST} 2 2`,
            '\tauthor Mallory (a line that looks like a field)',
            `${SECOND} 1 3 1`,
            'author Grace Hopper',
            'author-mail <grace@example.com>',
            'author-time 1700000100',
            'summary Fix the engine',
            'boundary',
            'filename a.ts',
            '\tthird line',
            ''
        ].join('\n');
        expect(parseBlame(output)).toEqual({
            commits: [
                { hash: FIRST, shortHash: 'aaaaaaa', author: 'Ada Lovelace', email: 'ada@example.com', at: 1700000000, summary: 'Add the engine' },
                { hash: SECOND, shortHash: 'bbbbbbb', author: 'Grace Hopper', email: 'grace@example.com', at: 1700000100, summary: 'Fix the engine' }
            ],
            lines: [0, 0, 1]
        });
    });

    test('gives a line no commit holds yet no commit at all', () => {
        const output = [
            `${'0'.repeat(40)} 1 1 1`,
            'author Not Committed Yet',
            'author-mail <not.committed.yet>',
            'summary Version of a.ts from a.ts',
            'filename a.ts',
            '\ttyped',
            ''
        ].join('\n');
        expect(parseBlame(output)).toEqual({ commits: [], lines: [-1] });
    });
});

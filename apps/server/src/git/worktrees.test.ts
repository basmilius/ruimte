import { describe, expect, test } from 'bun:test';
import { countStatus } from './worktrees.ts';

describe('countStatus', () => {
    test('a rename is one change and its old path is not read as an entry of its own', () => {
        const output = [
            '1 .M N... 100644 100644 100644 a b README.md',
            '2 R. N... 100644 100644 100644 a b R100 new.md',
            '? looks-untracked.md',
            '? notes.md',
            'u UU N... 1 2 3 4 a b c x.md',
            '! build/out.js',
            ''
        ].join('\0');
        expect(countStatus(output)).toEqual({ changed: 3, untracked: 1 });
    });
});

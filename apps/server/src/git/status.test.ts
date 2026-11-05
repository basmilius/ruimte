import { describe, expect, test } from 'bun:test';
import { parsePorcelain } from './status.ts';

describe('parsePorcelain', () => {
    test('keeps all path whitespace after the fixed metadata fields', () => {
        const path = ' leading  path/é\nname ';
        const output = `1 .M N... 100644 100644 100644 a b ${path}\0`;
        expect(parsePorcelain(output).entries[0]).toEqual({ path, index: '.', worktree: 'M', unmerged: false, untracked: false });
    });

    test('reads the branch, the upstream and both counts out of the header', () => {
        const output = ['# branch.oid abc', '# branch.head feature/x', '# branch.upstream origin/feature/x', '# branch.ab +2 -3'].join('\0') + '\0';
        expect(parsePorcelain(output)).toMatchObject({ branch: 'feature/x', detached: false, upstream: 'origin/feature/x', ahead: 2, behind: 3 });
    });

    test('a detached HEAD has no branch of its own', () => {
        expect(parsePorcelain('# branch.head (detached)\0')).toMatchObject({ branch: null, detached: true });
    });

    test('a rename carries the path it came from, which is the record right after it', () => {
        const output = ['2 R. N... 100644 100644 100644 abc def R100 new.txt', 'old.txt', '1 .M N... 100644 100644 100644 abc def other.txt'].join('\0') + '\0';
        const parsed = parsePorcelain(output);
        expect(parsed.entries).toEqual([
            { path: 'new.txt', oldPath: 'old.txt', index: 'R', worktree: '.', unmerged: false, untracked: false },
            { path: 'other.txt', index: '.', worktree: 'M', unmerged: false, untracked: false }
        ]);
    });

    test('an unmerged file and an untracked one are told apart from an ordinary change', () => {
        const output = ['u UU N... 100644 100644 100644 100644 a b c both.txt', '? new.txt'].join('\0') + '\0';
        expect(parsePorcelain(output).entries).toEqual([
            { path: 'both.txt', index: 'U', worktree: 'U', unmerged: true, untracked: false },
            { path: 'new.txt', index: '?', worktree: '?', unmerged: false, untracked: true }
        ]);
    });
});

import { describe, expect, test } from 'bun:test';
import { fullFileDiff } from './full-diff';

const lines = (count: number): string => Array.from({ length: count }, (_, i) => `line ${i + 1}\n`).join('');

const OLD = lines(40);
const NEW = OLD.replace('line 5\n', 'LINE 5\n').replace('line 35\n', 'LINE 35\n');

const PATCH = [
    'diff --git a/x.txt b/x.txt',
    'index 1111111..2222222 100644',
    '--- a/x.txt',
    '+++ b/x.txt',
    '@@ -2,7 +2,7 @@',
    ' line 2',
    ' line 3',
    ' line 4',
    '-line 5',
    '+LINE 5',
    ' line 6',
    ' line 7',
    ' line 8',
    '@@ -32,7 +32,7 @@',
    ' line 32',
    ' line 33',
    ' line 34',
    '-line 35',
    '+LINE 35',
    ' line 36',
    ' line 37',
    ' line 38',
    ''
].join('\n');

describe('fullFileDiff', () => {
    test('lays the hunks of a patch over both whole texts', () => {
        const diff = fullFileDiff(PATCH, 'x.txt', { old: OLD, new: NEW });
        expect(diff?.isPartial).toBe(false);
        expect(diff?.hunks.map((hunk) => [hunk.additionStart, hunk.collapsedBefore])).toEqual([
            [2, 1],
            [32, 23]
        ]);
        expect(diff?.additionLines).toHaveLength(40);
        expect(diff?.deletionLines).toHaveLength(40);
    });

    test('a new file has an empty old side', () => {
        const patch = ['diff --git a/x.txt b/x.txt', 'new file mode 100644', '--- /dev/null', '+++ b/x.txt', '@@ -0,0 +1,2 @@', '+a', '+b', ''].join('\n');
        const diff = fullFileDiff(patch, 'x.txt', { old: '', new: 'a\nb\n' });
        expect(diff?.isPartial).toBe(false);
        expect(diff?.deletionLines).toHaveLength(0);
    });

    test('a patch that is no patch leaves the texts unused', () => {
        expect(fullFileDiff('not a patch', 'x.txt', { old: OLD, new: NEW })).toBeNull();
    });
});

import { describe, expect, test } from 'bun:test';
import type { GitDiffFile } from '@ruimte/contracts';
import { diffFileParts, diffKindOf, firstFile, folderParts, pickedFile } from './commit-tree.ts';
import type { GitTreeRow } from './git-tree.ts';

function file(path: string, extra: Partial<GitDiffFile> = {}): GitDiffFile {
    return { path, diff: '', added: 0, deleted: 0, binary: false, ...extra };
}

function patch(header: string): string {
    return `diff --git a/x b/x\n${header}\n@@ -1 +1 @@\n-old\n+new\n`;
}

describe('what a file of a commit went through', () => {
    test('the daemon says so', () => {
        expect(diffKindOf(file('a.ts', { kind: 'delete', omitted: 'binary' }))).toBe('delete');
    });

    test('a daemon from before it leaves the patch header to say so', () => {
        expect(diffKindOf(file('a.ts', { diff: patch('new file mode 100644\n--- /dev/null\n+++ b/x') }))).toBe('add');
        expect(diffKindOf(file('a.ts', { diff: patch('deleted file mode 100644\n--- a/x\n+++ /dev/null') }))).toBe('delete');
        expect(diffKindOf(file('a.ts', { diff: patch('--- a/x\n+++ b/x') }))).toBe('update');
    });

    test('a line of the file that looks like a header changes nothing', () => {
        expect(diffKindOf(file('a.ts', { diff: `--- a/x\n+++ b/x\n@@ -1 +1 @@\n-x\n+new file mode 100644\n` }))).toBe('update');
    });

    test('a file left out of the answer of such a daemon has no letter', () => {
        expect(diffKindOf(file('a.png', { omitted: 'binary' }))).toBeNull();
        expect(diffFileParts(file('a.png', { omitted: 'binary', added: 2 })).map((part) => part.text)).toEqual(['+2']);
    });
});

describe('the rows of the tree', () => {
    test('a file reads its counts and its letter, the way a change of the git panel does', () => {
        expect(diffFileParts(file('a.ts', { kind: 'update', added: 3, deleted: 1 })).map((part) => part.text)).toEqual(['+3', '-1', 'M']);
        expect(diffFileParts(file('b.ts', { kind: 'add', added: 4 })).map((part) => part.text)).toEqual(['+4', 'A']);
    });

    test('a folder counts the files under it, however deep', () => {
        const files = [file('src/a.ts'), file('src/deep/b.ts'), file('srcs/c.ts')];
        expect(folderParts(files, 'src')).toEqual([{ text: '2' }]);
        expect(folderParts(files, 'other')).toBeNull();
    });
});

describe('the file a tab shows', () => {
    const files = [file('b.ts'), file('src/a.ts')];
    const rows: GitTreeRow[] = [
        { path: 'src/', kind: 'directory', isExpanded: true },
        { path: 'src/a.ts', kind: 'file', isExpanded: false },
        { path: 'b.ts', kind: 'file', isExpanded: false }
    ];

    test('the picked file, while the answer holds it', () => {
        expect(pickedFile(files, 'b.ts')?.path).toBe('b.ts');
        expect(pickedFile(files, 'gone.ts')).toBeNull();
        expect(pickedFile(files, undefined)).toBeNull();
    });

    test('a tab opens on the top file of the tree, not the first one of the answer', () => {
        expect(firstFile(rows, files)).toBe('src/a.ts');
    });

    test('with every folder folded it opens on the first file of the answer', () => {
        expect(firstFile([{ path: 'src/', kind: 'directory', isExpanded: false }], [file('src/a.ts')])).toBe('src/a.ts');
        expect(firstFile([], [])).toBeNull();
    });
});

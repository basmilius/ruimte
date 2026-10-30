import { describe, expect, test } from 'bun:test';
import { patchLayoutOf } from '@adecore/editor-react/models';
import { hasInconsistentHunk, patchSectionParts, sectionAt, sectionsOf, showsTree } from './patch-tree.ts';

const TWO_FILES = [
    'diff --git a/one.ts b/one.ts',
    '--- a/one.ts',
    '+++ b/one.ts',
    '@@ -1,2 +1,2 @@',
    ' keep',
    '-old',
    '+new',
    'diff --git a/two.ts b/two.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/two.ts',
    '@@ -0,0 +1 @@',
    '+fresh',
    ''
].join('\n');

describe('the sections of a patch as tree rows', () => {
    test('each file section becomes a row with its counts and the lines it spans', () => {
        const sections = sectionsOf(patchLayoutOf(TWO_FILES));
        expect(sections.map((section) => [section.path, section.file.added, section.file.deleted, section.firstLine, section.status])).toEqual([
            ['one.ts', 1, 1, 0, 'modified'],
            ['two.ts', 1, 0, 7, 'added']
        ]);
        expect(sections.map((section) => section.file.kind)).toEqual(['update', 'add']);
    });

    test('a file that appears twice keeps both rows', () => {
        const twice = `${TWO_FILES}${TWO_FILES.split('\n').slice(0, 7).join('\n')}\n`;
        expect(sectionsOf(patchLayoutOf(twice)).map((section) => section.path)).toEqual(['one.ts', 'two.ts', 'one.ts (2)']);
    });

    test('a deleted file is named by the path it had', () => {
        const patch = 'diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n';
        const [section] = sectionsOf(patchLayoutOf(patch));
        expect([section?.path, section?.file.kind]).toEqual(['gone.ts', 'delete']);
    });
});

describe('when a tree is shown', () => {
    test('only for more than one file section', () => {
        expect(showsTree(sectionsOf(patchLayoutOf(TWO_FILES)))).toBe(true);
        expect(showsTree(sectionsOf(patchLayoutOf(TWO_FILES.split('\n').slice(0, 7).join('\n'))))).toBe(false);
        expect(showsTree(sectionsOf(patchLayoutOf('')))).toBe(false);
        expect(showsTree(sectionsOf(patchLayoutOf('just some text\nnot a patch')))).toBe(false);
    });
});

describe('the section under the caret', () => {
    const sections = sectionsOf(patchLayoutOf(TWO_FILES));

    test('a line in a section selects it', () => {
        expect(sectionAt(sections, 0)?.path).toBe('one.ts');
        expect(sectionAt(sections, 6)?.path).toBe('one.ts');
        expect(sectionAt(sections, 7)?.path).toBe('two.ts');
        expect(sectionAt(sections, 12)?.path).toBe('two.ts');
    });

    test('a line before every section selects none', () => {
        const mail = sectionsOf(patchLayoutOf(`From: someone\n\n${TWO_FILES}`));
        expect(sectionAt(mail, 0)).toBeNull();
        expect(sectionAt(mail, 2)?.path).toBe('one.ts');
    });
});

describe('the states of the bar', () => {
    test('a hunk that no longer adds up is noticed', () => {
        expect(hasInconsistentHunk(patchLayoutOf(TWO_FILES))).toBe(false);
        expect(hasInconsistentHunk(patchLayoutOf(TWO_FILES.replace('+new', '+new\n+extra\n+more')))).toBe(true);
    });

    test('a binary section is named in its row', () => {
        const patch = 'diff --git a/logo.png b/logo.png\nindex 1..2 100644\nBinary files a/logo.png and b/logo.png differ\n';
        const [section] = sectionsOf(patchLayoutOf(patch));
        expect(section?.file.binary).toBe(true);
        expect(patchSectionParts(section!, 'binary')[0]?.text).toBe('binary');
    });
});

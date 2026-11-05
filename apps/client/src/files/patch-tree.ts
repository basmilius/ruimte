import type { PatchFileLayout, PatchLayout } from '@adecore/editor-react/models';
import type { GitDiffFile } from '@ruimte/contracts';
import { changeParts, type DecorationPart } from '@/files/git-tree';

/* One file section of a patch as a row of the commit tree; `firstLine` and `lastLine` are zero-based. */
export interface PatchSection {
    readonly path: string;
    readonly file: GitDiffFile;
    readonly firstLine: number;
    readonly lastLine: number;
    readonly status: PatchFileLayout['status'];
}

const STATUS_LETTERS: Record<PatchFileLayout['status'], string | null> = {
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    modified: 'M',
    binary: null
};

const STATUS_KINDS = { added: 'add', deleted: 'delete' } as const;

/* The name a section has in the tree: where the file ends up, or where it was when it is gone. */
function nameOf(file: PatchFileLayout, index: number): string {
    return file.newPath ?? file.oldPath ?? `patch-${index + 1}`;
}

/*
 * The sections of a patch as tree rows. A file that appears twice (a patch of two commits touching it)
 * keeps both rows by numbering the later ones, since the tree names a row by its path.
 */
export function sectionsOf(layout: PatchLayout): PatchSection[] {
    const seen = new Map<string, number>();
    return layout.files.map((file, index) => {
        const name = nameOf(file, index);
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        const path = count === 1 ? name : `${name} (${count})`;
        const kind = file.status === 'added' || file.status === 'deleted' ? STATUS_KINDS[file.status] : 'update';
        return {
            path,
            status: file.status,
            firstLine: file.firstLine,
            lastLine: file.lastLine,
            file: {
                path,
                diff: '',
                added: file.added,
                deleted: file.removed,
                binary: file.status === 'binary',
                kind,
                ...(file.status === 'binary' ? { omitted: 'binary' as const } : {})
            }
        };
    });
}

/* A tree is for a patch that has more than one file to choose from. */
export function showsTree(sections: readonly PatchSection[]): boolean {
    return sections.length > 1;
}

/* The section a zero-based line is in; the lines before the first section and after a cut-off belong to none. */
export function sectionAt(sections: readonly PatchSection[], line: number): PatchSection | null {
    return sections.find((section) => line >= section.firstLine && line <= section.lastLine) ?? null;
}

/* The row's decoration: the counts and the status letter, and a word for a file that has no lines to count. */
export function patchSectionParts(section: PatchSection, binaryLabel: string): DecorationPart[] {
    const letter = STATUS_LETTERS[section.status];
    const parts = changeParts(section.file.added, section.file.deleted, letter);
    return section.status === 'binary' ? [{ text: binaryLabel }, ...parts] : parts;
}

/* Whether any hunk no longer adds up to its header, as after an edit. */
export function hasInconsistentHunk(layout: PatchLayout): boolean {
    return layout.files.some((file) => file.hunks.some((hunk) => !hunk.consistent));
}

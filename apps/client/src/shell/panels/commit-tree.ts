import type { GitDiffFile } from '@ruimte/contracts';
import { changeParts, entriesUnder, type DecorationPart, type GitTreeRow } from '@/shell/panels/git-tree';

type DiffKind = NonNullable<GitDiffFile['kind']>;

const KIND_LETTERS: Record<DiffKind, string> = { add: 'A', update: 'M', delete: 'D' };

/*
 * What a file of a commit went through. A daemon from before `kind` leaves it to the patch, whose
 * header says so above the first hunk; a file it left the patch out of says nothing then.
 */
export const diffKindOf = (file: GitDiffFile): DiffKind | null => {
    if (file.kind !== undefined) {
        return file.kind;
    }
    if (file.diff === '') {
        return null;
    }
    const start = file.diff.search(/^@@/m);
    const header = start === -1 ? file.diff : file.diff.slice(0, start);
    if (/^new file mode /m.test(header) || /^--- \/dev\/null$/m.test(header)) {
        return 'add';
    }
    if (/^deleted file mode /m.test(header) || /^\+\+\+ \/dev\/null$/m.test(header)) {
        return 'delete';
    }
    return 'update';
};

/* A file's row after its name, the way a row of the git panel's changes reads. */
export const diffFileParts = (file: GitDiffFile): DecorationPart[] => {
    const kind = diffKindOf(file);
    return changeParts(file.added, file.deleted, kind === null ? null : KIND_LETTERS[kind]);
};

/* A folder's row after its name: how many files of the commit it holds, however deep. */
export const folderParts = (files: readonly GitDiffFile[], dir: string): DecorationPart[] | null => {
    const count = entriesUnder(files, dir).length;
    return count === 0 ? null : [{ text: String(count) }];
};

/* The file a tab shows: the one picked, as long as the answer still holds it. */
export const pickedFile = (files: readonly GitDiffFile[], picked: string | undefined): GitDiffFile | null =>
    picked === undefined ? null : (files.find((file) => file.path === picked) ?? null);

/* What a tab opens on: the top file of the tree, or the first one of the answer when every folder stands folded. */
export const firstFile = (rows: readonly GitTreeRow[], files: readonly GitDiffFile[]): string | null =>
    rows.find((row) => row.kind === 'file')?.path ?? files[0]?.path ?? null;

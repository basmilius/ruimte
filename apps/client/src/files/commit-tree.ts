import type { GitDiffFile } from '@ruimte/contracts';
import { changeParts, entriesUnder, type DecorationPart, type GitTreeRow } from '@/files/git-tree';

const KIND_LETTERS: Record<NonNullable<GitDiffFile['kind']>, string> = { add: 'A', update: 'M', delete: 'D' };

/* A file's row after its name, the way a row of the git panel's changes reads; a file whose answer carries no kind has no letter. */
export function diffFileParts(file: GitDiffFile): DecorationPart[] {
    return changeParts(file.added, file.deleted, file.kind === undefined ? null : KIND_LETTERS[file.kind]);
}

/* A folder's row after its name: how many files of the commit it holds, however deep. */
export function folderParts(files: readonly GitDiffFile[], dir: string): DecorationPart[] | null {
    const count = entriesUnder(files, dir).length;
    return count === 0 ? null : [{ text: String(count) }];
}

/* The file a tab shows: the one picked, as long as the answer still holds it. */
export function pickedFile(files: readonly GitDiffFile[], picked: string | undefined): GitDiffFile | null {
    return picked === undefined ? null : (files.find((file) => file.path === picked) ?? null);
}

/* What a tab opens on: the top file of the tree, or the first one of the answer when every folder stands folded. */
export function firstFile(rows: readonly GitTreeRow[], files: readonly GitDiffFile[]): string | null {
    return rows.find((row) => row.kind === 'file')?.path ?? files[0]?.path ?? null;
}

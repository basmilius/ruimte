import { splitLines } from '@ruimte/merge';
import { git, runGit } from '../git/run.ts';

/* Past this a file is not read for its lines, here or in the editor. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/* The lines of a file as a version held it; a file that was not there has none, and null is a version this could not read. */
export type VersionLines = string[] | null;

/* The repository a file is in, by the path git reports; null for a file in none. */
export async function repositoryOf(directory: string): Promise<string | null> {
    return (await git(['rev-parse', '--show-toplevel'], directory))?.trim() || null;
}

async function blobLines(top: string, sha: string): Promise<VersionLines> {
    const size = await git(['cat-file', '-s', sha], top);
    if (size === null || Number(size.trim()) > MAX_TEXT_BYTES) {
        return null;
    }
    const content = await git(['cat-file', 'blob', sha], top);
    return content === null || content.includes('\0') ? null : splitLines(content);
}

/* The file as a git tree held it, for the tree a turn started from; `path` is relative to the repository. */
export async function linesInTree(top: string, tree: string, path: string): Promise<VersionLines> {
    const listed = await runGit(['ls-tree', '-z', tree, '--', path], top);
    if (listed.code !== 0) {
        return null;
    }
    if (listed.stdout === '') {
        return [];
    }
    const sha = /^\d+ blob ([0-9a-f]+)\t/.exec(listed.stdout)?.[1];
    return sha === undefined ? null : blobLines(top, sha);
}

/* The file at the head of its checkout: null when git does not hold it (untracked, or no commit yet). */
export async function linesAtHead(top: string, path: string): Promise<VersionLines> {
    const listed = await runGit(['ls-tree', '-z', 'HEAD', '--', path], top);
    if (listed.code !== 0 || listed.stdout === '') {
        return null;
    }
    const sha = /^\d+ blob ([0-9a-f]+)\t/.exec(listed.stdout)?.[1];
    return sha === undefined ? null : blobLines(top, sha);
}

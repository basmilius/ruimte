import { splitLines } from '@adecore/merge';
import { nativePath } from '../git/native-path.ts';
import { git, runGit } from '../git/run.ts';

/* Past this a file is not read for its lines, here or in the editor. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/* The lines of a file as a version held it; a file that was not there has none, and null is a version this could not read. */
type VersionLines = string[] | null;

export async function repositoryOf(directory: string): Promise<string | null> {
    const top = (await git(['rev-parse', '--show-toplevel'], directory))?.trim();
    return top ? nativePath(top) : null;
}

async function blobLines(top: string, sha: string): Promise<VersionLines> {
    const size = await git(['cat-file', '-s', sha], top);
    if (size === null || Number(size.trim()) > MAX_TEXT_BYTES) {
        return null;
    }
    const content = await git(['cat-file', 'blob', sha], top);
    return content === null || content.includes('\0') ? null : splitLines(content);
}

/* The blob a tree holds at `path`: its sha, '' when the tree has no such file, null when git cannot tell. */
async function blobIn(top: string, tree: string, path: string): Promise<string | null> {
    const listed = await runGit(['ls-tree', '-z', tree, '--', path], top);
    if (listed.code !== 0) {
        return null;
    }
    return listed.stdout === '' ? '' : (/^\d+ blob ([0-9a-f]+)\t/.exec(listed.stdout)?.[1] ?? null);
}

/* The file as a git tree held it, for the tree a turn started from; `path` is relative to the repository. */
export async function linesInTree(top: string, tree: string, path: string): Promise<VersionLines> {
    const sha = await blobIn(top, tree, path);
    return sha === '' ? [] : sha === null ? null : blobLines(top, sha);
}

/* The file at the head of its checkout: null when git does not hold it (untracked, or no commit yet). */
export async function linesAtHead(top: string, path: string): Promise<VersionLines> {
    const sha = await blobIn(top, 'HEAD', path);
    return sha ? blobLines(top, sha) : null;
}

/*
 * The files a move of HEAD touched, relative to the repository. Null when either commit is gone
 * (a rebase or a reset can leave the old one to garbage collection), since then nothing can be told apart.
 */
export async function filesBetweenCommits(top: string, before: string, after: string): Promise<Set<string> | null> {
    for (const commit of [before, after]) {
        if ((await runGit(['cat-file', '-e', `${commit}^{commit}`], top)).code !== 0) {
            return null;
        }
    }
    const listed = await runGit(['diff', '--name-only', '-z', before, after], top);
    return listed.code === 0 ? new Set(listed.stdout.split('\0').filter((path) => path !== '')) : null;
}

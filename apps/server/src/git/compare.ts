import { basename } from 'node:path';
import { GIT_BLOB_MAX_BYTES, type GitBlobResult, type GitCompareMode, type GitComparePage, type GitCompareResult } from '@ruimte/contracts';
import { languageOf } from '../fs/read.ts';
import { diffCommits } from './diff.ts';
import { readRangeLog } from './log.ts';
import { GitError, LEAVE_NOTHING_OUT, git, runGit, runGitBytes, toplevel, verifyRev, type GitResult, type LeftOut } from './run.ts';

const KEEP_BOM = new TextDecoder('utf-8', { ignoreBOM: true });
// The first page of each side that `git.compare` answers with.
const PAGE_SIZE = 30;

/* The commit a ref, tag or commit id names, or an error that says which name failed. */
async function pinCommit(top: string, ref: string): Promise<string> {
    const commit = await verifyRev(`${ref}^{commit}`, top);

    if (commit === null) {
        throw new GitError('ref-not-found', `${ref} does not name a commit in this repository.`);
    }

    return commit;
}

async function mergeBaseOf(top: string, fromCommit: string, toCommit: string): Promise<string> {
    return mergeBaseFrom(await runGit(['merge-base', '--all', fromCommit, toCommit], top));
}

/* `git merge-base` exits 1 with no output for unrelated histories; every other failure is a read that did not happen. */
export function mergeBaseFrom({ code, stdout }: Pick<GitResult, 'code' | 'stdout'>): string {
    if (code !== 0 && !(code === 1 && stdout.trim() === '')) {
        throw new GitError('git-failed', 'Could not read the merge base.');
    }

    const bases = stdout.trim().split(/\s+/).filter(Boolean);

    if (bases.length === 0) {
        throw new GitError('git-failed', 'These branches have no common ancestor. Compare their tips instead.');
    }

    if (bases.length > 1) {
        throw new GitError('git-failed', 'These branches have more than one merge base. Compare their tips instead.');
    }

    return bases[0]!;
}

/*
 * Two refs of one repository as the files that differ and the commits only each side has. Both refs
 * are resolved first and everything after reads those commits, so a branch that moves meanwhile
 * changes nothing until the person asks again. The checkout, its index and its HEAD are never touched.
 */
export async function compareBranches(
    cwd: string,
    from: string,
    to: string,
    mode: GitCompareMode,
    leftOut: LeftOut = LEAVE_NOTHING_OUT
): Promise<GitCompareResult> {
    const top = await toplevel(cwd);
    const [fromCommit, toCommit] = await Promise.all([pinCommit(top, from), pinCommit(top, to)]);
    const baseCommit = mode === 'merge-base' ? await mergeBaseOf(top, fromCommit, toCommit) : fromCommit;
    const [diff, left, right] = await Promise.all([
        diffCommits(top, baseCommit, toCommit, leftOut),
        readRangeLog(top, toCommit, fromCommit, 0, PAGE_SIZE),
        readRangeLog(top, fromCommit, toCommit, 0, PAGE_SIZE)
    ]);

    return { from, to, fromCommit, toCommit, baseCommit, mode, diff, left, right };
}

/* A later page of the commits only one side has, between commits `compareBranches` pinned. */
export async function compareCommits(
    cwd: string,
    fromCommit: string,
    toCommit: string,
    side: 'left' | 'right',
    skip: number,
    limit: number
): Promise<GitComparePage> {
    const top = await toplevel(cwd);
    const [from, to] = await Promise.all([pinCommit(top, fromCommit), pinCommit(top, toCommit)]);

    return side === 'left' ? readRangeLog(top, to, from, skip, limit) : readRangeLog(top, from, to, skip, limit);
}

function insideTree(path: string): boolean {
    return !path.startsWith('/') && !path.includes('\0') && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/*
 * One file as a commit holds it. The entry is read from the tree before its content, so a folder, a
 * submodule and a missing path each get their own answer. A symlink is its target's name as text and
 * is never followed on disk.
 */
export async function readSnapshot(cwd: string, commitId: string, path: string): Promise<GitBlobResult> {
    if (!insideTree(path)) {
        throw new GitError('outside-checkout', 'A snapshot path has to stay inside the commit.');
    }

    const top = await toplevel(cwd);
    const commit = await pinCommit(top, commitId);
    const answer = { commit, path };
    const listed = await git(['ls-tree', '--full-tree', '-z', commit, '--', `:(literal)${path}`], top);

    if (listed === null) {
        throw new GitError('git-failed', 'Could not read the tree of the commit.');
    }

    if (listed === '') {
        return { ...answer, omitted: 'missing' };
    }

    const tab = listed.indexOf('\t');

    // A pathspec could still match more than the one entry; only the exact path is an answer.
    if (tab < 0 || listed.slice(tab + 1) !== `${path}\0`) {
        throw new GitError('git-failed', 'The path matches no file of the commit, or more than one.');
    }

    const [mode, type, object] = listed.slice(0, tab).split(' ');

    if (mode === '160000') {
        return { ...answer, omitted: 'gitlink' };
    }

    if (type !== 'blob' || object === undefined) {
        return { ...answer, omitted: 'not-file' };
    }

    const size = Number((await git(['cat-file', '-s', object], top))?.trim());

    if (!Number.isFinite(size)) {
        throw new GitError('git-failed', 'Could not read the size of the file.');
    }

    if (size > GIT_BLOB_MAX_BYTES) {
        return { ...answer, omitted: 'too-large' };
    }

    const blob = await runGitBytes(['cat-file', 'blob', object], top);

    if (blob.code !== 0) {
        throw new GitError('git-failed', 'Could not read the content of the file.');
    }

    if (blob.stdout.includes(0)) {
        return { ...answer, omitted: 'binary' };
    }

    const language = languageOf(basename(path));

    return {
        ...answer,
        text: KEEP_BOM.decode(blob.stdout),
        ...(language === undefined ? {} : { language }),
        ...(mode === '120000' ? { symlink: true } : {})
    };
}

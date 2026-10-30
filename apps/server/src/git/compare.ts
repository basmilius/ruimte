import { basename } from 'node:path';
import { languageOf } from '../fs/read.ts';
import type { GitBlobResult, GitCompareMode, GitComparePage, GitCompareResult } from '@ruimte/contracts';
import { diffPinnedTrees } from './diff.ts';
import { readRangeLog } from './log.ts';
import { GitError, git, runGitBytes, toplevel, verifyRev } from './run.ts';

const MAX_BLOB_BYTES = 512 * 1024;
const KEEP_BOM = new TextDecoder('utf-8', { ignoreBOM: true });

async function pinCommit(top: string, ref: string): Promise<string> {
    const commit = await verifyRev(`${ref}^{commit}`, top);
    if (commit === null) {
        throw new GitError('git-failed', `The ref '${ref}' does not name a commit in this repository.`);
    }
    return commit;
}

export async function compareBranches(cwd: string, from: string, to: string, mode: GitCompareMode): Promise<GitCompareResult> {
    const top = await toplevel(cwd);
    const [fromCommit, toCommit] = await Promise.all([pinCommit(top, from), pinCommit(top, to)]);
    let baseCommit = fromCommit;
    if (mode === 'merge-base') {
        const bases = (await git(['merge-base', '--all', fromCommit, toCommit], top))?.trim().split(/\s+/).filter(Boolean) ?? [];
        if (bases.length === 0) {
            throw new GitError('git-failed', 'These branches have no common ancestor. Choose Tips to compare their snapshots.');
        }
        if (bases.length !== 1) {
            throw new GitError('git-failed', 'These branches have multiple merge bases. Choose Tips for an unambiguous comparison.');
        }
        baseCommit = bases[0]!;
    }
    const [diff, left, right] = await Promise.all([
        diffPinnedTrees(top, baseCommit, toCommit),
        readRangeLog(top, toCommit, fromCommit),
        readRangeLog(top, fromCommit, toCommit)
    ]);
    return { cwd: top, from, to, fromCommit, toCommit, baseCommit, mode, diff, left, right };
}

export async function compareCommits(cwd: string, from: string, to: string, side: 'left' | 'right', skip: number, limit: number): Promise<GitComparePage> {
    const top = await toplevel(cwd);
    const [left, right] = await Promise.all([pinCommit(top, from), pinCommit(top, to)]);
    return side === 'left' ? readRangeLog(top, right, left, skip, limit) : readRangeLog(top, left, right, skip, limit);
}

export async function readSnapshot(cwd: string, ref: string, path: string): Promise<GitBlobResult> {
    if (path.startsWith('/') || path.includes('\0') || path.split('/').includes('..')) {
        throw new GitError('git-failed', 'A snapshot path must stay inside the commit tree.');
    }
    const top = await toplevel(cwd);
    const commit = await pinCommit(top, ref);
    const answer = { commit, path };
    const listed = await git(['ls-tree', '--full-tree', '-z', commit, '--', `:(literal)${path}`], top);
    if (listed === null) {
        throw new GitError('git-failed', 'The snapshot could not be read.');
    }
    if (listed === '') {
        return { ...answer, omitted: 'missing' };
    }
    const [mode, type, object] = listed.slice(0, listed.indexOf('\t')).split(' ');
    if (mode === '160000') {
        return { ...answer, omitted: 'gitlink' };
    }
    if (type !== 'blob' || object === undefined) {
        return { ...answer, omitted: 'not-file' };
    }
    const size = Number((await git(['cat-file', '-s', object], top))?.trim());
    if (!Number.isFinite(size)) {
        throw new GitError('git-failed', 'The snapshot size could not be read.');
    }
    if (size > MAX_BLOB_BYTES) {
        return { ...answer, omitted: 'too-large' };
    }
    const blob = await runGitBytes(['cat-file', 'blob', object], top);
    if (blob.code !== 0) {
        throw new GitError('git-failed', 'The snapshot content could not be read.');
    }
    if (blob.stdout.includes(0)) {
        return { ...answer, omitted: 'binary' };
    }
    return { ...answer, text: KEEP_BOM.decode(blob.stdout), language: languageOf(basename(path)), ...(mode === '120000' ? { symlink: true } : {}) };
}

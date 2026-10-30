import type { GitCommit, GitLogResult, GitComparePage } from '@ruimte/contracts';
import { FIELD, GitError, git, toplevel } from './run.ts';

export const DEFAULT_LIMIT = 30;

const LOG_FORMAT = ['%H', '%h', '%an', '%at', '%ct', '%ae', '%D', '%s'].join(FIELD);

/*
 * `log -z --format=...` writes one NUL terminated record per commit, the fields separated by the
 * one character a commit subject cannot hold. `%D` is the names pointing at the commit, comma
 * separated, with the arrow of `HEAD -> main` written out and, under `--decorate=full`, the
 * `refs/` prefix that tells a remote-tracking branch from a local one with a slash in its name.
 */
export function parseLog(output: string): GitCommit[] {
    const commits: GitCommit[] = [];
    for (const record of output.split('\0')) {
        if (record === '') {
            continue;
        }
        const [hash = '', shortHash = '', author = '', at = '', committedAt = '', authorEmail = '', decoration = '', ...rest] = record.split(FIELD);
        if (hash === '') {
            continue;
        }
        const refs: string[] = [];
        const remoteRefs: string[] = [];
        for (const entry of decoration.split(', ')) {
            const full = entry.replace('HEAD -> ', '').replace('tag: ', '').trim();
            if (full === '') {
                continue;
            }
            const remote = full.startsWith('refs/remotes/');
            const name = full.replace(/^refs\/(heads|remotes|tags)\//, '');
            refs.push(name);
            if (remote) {
                remoteRefs.push(name);
            }
        }
        commits.push({
            hash,
            shortHash,
            author,
            at: Number.parseInt(at, 10) || 0,
            committedAt: Number.parseInt(committedAt, 10) || 0,
            refs,
            subject: rest.join(FIELD),
            authorEmail,
            remoteRefs
        });
    }
    return commits;
}

/*
 * A page of the commit log of the checkout's own HEAD. The cursor is how many commits were handed
 * out before this page, which keeps paging right when a commit lands on top while the log is open:
 * a hash to continue from would silently skip the new one instead.
 */
export async function readLog(cwd: string, limit: number = DEFAULT_LIMIT, cursor?: string): Promise<GitLogResult> {
    const top = await toplevel(cwd);
    const skip = Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0);
    // One more than asked for, which is how the answer knows whether there is another page.
    const output = await git(['log', '-z', '--decorate=full', `--format=${LOG_FORMAT}`, `--max-count=${limit + 1}`, `--skip=${skip}`, 'HEAD'], top);
    if (output === null) {
        // A repository without a commit has no HEAD to walk, which is an empty log and not a failure.
        return { commits: [], cursor: null };
    }
    const commits = parseLog(output);
    const page = commits.slice(0, limit);
    return { commits: page, cursor: commits.length > page.length ? String(skip + page.length) : null };
}

/* One commit as the log row that names it, for the tab a diff of that commit opens in. */
export async function readCommit(top: string, hash: string): Promise<GitCommit | null> {
    const output = await git(['log', '-z', '--decorate=full', `--format=${LOG_FORMAT}`, '--max-count=1', hash], top);
    return output === null ? null : (parseLog(output)[0] ?? null);
}

/* A bounded page unique to one pinned tip, without involving HEAD. */
export async function readRangeLog(top: string, excluded: string, included: string, skip = 0, limit = DEFAULT_LIMIT): Promise<GitComparePage> {
    const output = await git(
        [
            'log',
            '-z',
            '--topo-order',
            '--decorate=full',
            `--format=${LOG_FORMAT}`,
            `--max-count=${limit + 1}`,
            `--skip=${skip}`,
            `${excluded}..${included}`,
            '--'
        ],
        top
    );
    if (output === null) {
        throw new GitError('git-failed', 'The comparison commits could not be read.');
    }
    const commits = parseLog(output);
    const page = commits.slice(0, limit);
    return { commits: page, next: commits.length > page.length ? skip + page.length : null };
}

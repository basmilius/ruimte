import type { GitCommit, GitLogResult } from '@ruimte/contracts';
import { git, toplevel } from './run.ts';

export const DEFAULT_LIMIT = 30;

// A branch name may hold anything but a control character, so this one cannot appear inside a field.
const FIELD = '\u001f';

export const LOG_FORMAT = ['%H', '%h', '%an', '%at', '%D', '%s'].join(FIELD);

/*
 * `log -z --format=...` writes one NUL terminated record per commit, the fields separated by the
 * one character a commit subject cannot hold. `%D` is the names pointing at the commit, comma
 * separated, with the arrow of `HEAD -> main` written out.
 */
export const parseLog = (output: string): GitCommit[] => {
    const commits: GitCommit[] = [];
    for (const record of output.split('\0')) {
        if (record === '') {
            continue;
        }
        const [hash = '', shortHash = '', author = '', at = '', decoration = '', ...rest] = record.split(FIELD);
        if (hash === '') {
            continue;
        }
        const refs = decoration
            .split(', ')
            .map((name) => name.replace('HEAD -> ', '').replace('tag: ', '').trim())
            .filter((name) => name !== '');
        commits.push({ hash, shortHash, author, at: Number.parseInt(at, 10) || 0, refs, subject: rest.join(FIELD) });
    }
    return commits;
};

/*
 * A page of the commit log of the checkout's own HEAD. The cursor is how many commits were handed
 * out before this page, which keeps paging right when a commit lands on top while the log is open:
 * a hash to continue from would silently skip the new one instead.
 */
export const readLog = async (cwd: string, limit: number = DEFAULT_LIMIT, cursor?: string): Promise<GitLogResult> => {
    const top = await toplevel(cwd);
    const skip = Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0);
    // One more than asked for, which is how the answer knows whether there is another page.
    const output = await git(['log', '-z', `--format=${LOG_FORMAT}`, `--max-count=${limit + 1}`, `--skip=${skip}`, 'HEAD'], top);
    if (output === null) {
        // A repository without a commit has no HEAD to walk, which is an empty log and not a failure.
        return { commits: [], cursor: null };
    }
    const commits = parseLog(output);
    const page = commits.slice(0, limit);
    return { commits: page, cursor: commits.length > page.length ? String(skip + page.length) : null };
};

/* One commit as the log row that names it, for the tab a diff of that commit opens in. */
export const readCommit = async (top: string, hash: string): Promise<GitCommit | null> => {
    const output = await git(['log', '-z', `--format=${LOG_FORMAT}`, '--max-count=1', hash], top);
    return output === null ? null : (parseLog(output)[0] ?? null);
};

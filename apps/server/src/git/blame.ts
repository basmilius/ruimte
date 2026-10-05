import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitBlameCommit, GitBlameResult } from '@ruimte/contracts';
import { insideCheckout } from './diff.ts';
import { GitError, runGit, toplevel } from './run.ts';

/* Past this the daemon does not blame: the walk grows with the file and the history behind each line. */
export const MAX_BLAME_LINES = 20_000;
const MAX_BLAME_BYTES = 2 * 1024 * 1024;

const UNCOMMITTED = /^0+$/;
const HEADER = /^([0-9a-f]{40,64}) \d+ \d+(?: \d+)?$/;

/*
 * `blame --porcelain` writes a header per line (the commit, where the line was and is, and for the
 * first line of a group how many follow), the commit's own fields the first time that commit shows
 * up, and the line itself behind a tab. A tab leads every line of text, so no line of the file can be
 * mistaken for a field.
 */
export function parseBlame(output: string): GitBlameResult {
    const commits: GitBlameCommit[] = [];
    const indexOf = new Map<string, number>();
    const lines: number[] = [];
    let current = -1;
    let pending: Partial<GitBlameCommit> | null = null;
    const settle = (): void => {
        if (pending?.hash !== undefined && !indexOf.has(pending.hash) && !UNCOMMITTED.test(pending.hash)) {
            indexOf.set(pending.hash, commits.length);
            commits.push({
                hash: pending.hash,
                shortHash: pending.hash.slice(0, 7),
                author: pending.author ?? '',
                email: pending.email ?? '',
                at: pending.at ?? 0,
                summary: pending.summary ?? ''
            });
        }
        pending = null;
    };
    for (const line of output.split('\n')) {
        if (line.startsWith('\t')) {
            settle();
            lines.push(current);
            continue;
        }
        const header = HEADER.exec(line);
        if (header) {
            const hash = header[1]!;
            current = UNCOMMITTED.test(hash) ? -1 : (indexOf.get(hash) ?? commits.length);
            pending = indexOf.has(hash) || UNCOMMITTED.test(hash) ? null : { hash };
            continue;
        }
        if (pending === null) {
            continue;
        }
        if (line.startsWith('author ')) {
            pending.author = line.slice('author '.length);
        } else if (line.startsWith('author-mail ')) {
            pending.email = line.slice('author-mail '.length).replace(/^<|>$/g, '');
        } else if (line.startsWith('author-time ')) {
            pending.at = Number.parseInt(line.slice('author-time '.length), 10) || 0;
        } else if (line.startsWith('summary ')) {
            pending.summary = line.slice('summary '.length);
        }
    }
    return { commits, lines };
}

/*
 * Who wrote each line of a file as it stands in the working tree. A line that is typed and not
 * committed has no author yet, which is -1 and never the person at the keyboard: whoever reads it says
 * what an uncommitted line is. A file git does not know has no lines and says why.
 */
export async function blameFile(cwd: string, path: string): Promise<GitBlameResult> {
    const top = await toplevel(cwd);
    if (!(await insideCheckout(top, path))) {
        throw new GitError('outside-checkout', `${path} is not inside the checkout.`);
    }
    const size = await stat(join(top, path)).then(
        (info) => info.size,
        () => null
    );
    if (size === null) {
        throw new GitError('git-failed', `${path} does not exist.`);
    }
    if (size > MAX_BLAME_BYTES) {
        return { commits: [], lines: [], omitted: 'too-large' };
    }
    const result = await runGit(['blame', '--porcelain', '--', path], top, { env: { LC_ALL: 'C' } });
    if (result.code !== 0) {
        // Git refuses a file that is in no commit and not in the index, and a repository without a commit.
        return { commits: [], lines: [], omitted: 'untracked' };
    }
    const blame = parseBlame(result.stdout);
    return blame.lines.length > MAX_BLAME_LINES ? { commits: [], lines: [], omitted: 'too-large' } : blame;
}

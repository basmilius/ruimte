import type { GitIdentity, GitIdentityMiss, GitIdentityResult } from '@ruimte/contracts';
import { realOrSelf } from '../disk/real-path.ts';
import { nativePath } from './native-path.ts';
import { READ_ONLY_GIT, runGit } from './run.ts';

// The same cap the contract holds the lists to.
const MAX_LISTED = 50;

// A question about a folder that sits on a stuck volume must not hold up the others.
const GIT_TIMEOUT_MS = 5_000;

const PARALLEL_PATHS = 4;

// Root commits only change with HEAD, and finding them walks the whole history.
const MAX_CACHED = 200;

// A query parameter that carries a secret in a remote URL, as hosting services spell it.
const SECRET_PARAMETER = /token|secret|password|passwd|auth|key|signature|^sig$/i;

/* A remote URL goes to another machine, and neither `https://user:token@host/repo.git` nor `?access_token=` may take a secret along. */
export function withoutCredentials(url: string): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        // An scp-style address (git@host:owner/repo) is no URL and carries no password.
        return url;
    }
    const secrets = [...parsed.searchParams.keys()].filter((name) => SECRET_PARAMETER.test(name));
    if (parsed.username === '' && parsed.password === '' && secrets.length === 0) {
        return url;
    }
    parsed.username = '';
    parsed.password = '';
    for (const name of secrets) {
        parsed.searchParams.delete(name);
    }
    return parsed.href;
}

function linesOf(output: string | null): string[] {
    return (output ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
}

class TimedOut extends Error {}

/* Output of a git that succeeded, null for any other outcome, and a throw for one that took too long. */
async function read(args: string[], cwd: string): Promise<string | null> {
    const result = await runGit(args, cwd, { env: READ_ONLY_GIT, timeoutMs: GIT_TIMEOUT_MS });
    if (result.timedOut === true) {
        throw new TimedOut();
    }
    return result.code === 0 ? result.stdout : null;
}

/* What a checkout is, read without taking a lock: the history it starts from, where it came from and where its branches stand. */
export class IdentityReader {
    private readonly roots = new Map<string, string[]>();

    async read(paths: readonly string[]): Promise<GitIdentityResult> {
        const identities: GitIdentityResult['identities'] = new Array(paths.length);
        let next = 0;
        const worker = async (): Promise<void> => {
            while (next < paths.length) {
                const at = next++;
                const path = paths[at]!;
                identities[at] = await this.identityOf(path);
            }
        };
        await Promise.all(Array.from({ length: Math.min(PARALLEL_PATHS, paths.length) }, worker));
        return { identities };
    }

    private async identityOf(path: string): Promise<GitIdentity | GitIdentityMiss> {
        try {
            return (await this.readIdentity(path)) ?? { path, error: 'not-a-repository' };
        } catch (e) {
            if (e instanceof TimedOut) {
                return { path, error: 'timed-out' };
            }
            throw e;
        }
    }

    private async readIdentity(path: string): Promise<GitIdentity | null> {
        const where = linesOf(await read(['rev-parse', '--show-toplevel', '--absolute-git-dir'], path)).map((line) => nativePath(line));
        // A folder inside a repository is not a checkout of it: a dotfiles repository at the home folder would otherwise claim every project below it.
        if (where.length < 2 || (await realOrSelf(where[0]!)) !== (await realOrSelf(path))) {
            return null;
        }
        const gitDir = where[1]!;
        const [head, remote, branch, branches] = await Promise.all([
            read(['rev-parse', '--verify', 'HEAD'], path),
            read(['remote', 'get-url', 'origin'], path),
            read(['symbolic-ref', '--short', 'HEAD'], path),
            read(['for-each-ref', '--format=%(objectname)', 'refs/heads'], path)
        ]);
        const headSha = linesOf(head)[0];
        const rootCommits = headSha === undefined ? [] : await this.rootsOf(path, gitDir, headSha);
        const remoteUrl = remote?.trim() ?? '';
        const branchName = branch?.trim() ?? '';
        return {
            path,
            rootCommits,
            ...(remoteUrl === '' ? {} : { remoteUrl: withoutCredentials(remoteUrl) }),
            ...(branchName === '' ? {} : { branch: branchName }),
            heads: [...new Set([...(headSha === undefined ? [] : [headSha]), ...linesOf(branches)])].slice(0, MAX_LISTED)
        };
    }

    private async rootsOf(path: string, gitDir: string, head: string): Promise<string[]> {
        const key = `${gitDir}\0${head}`;
        const cached = this.roots.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const roots = linesOf(await read(['rev-list', '--max-parents=0', head], path)).slice(0, MAX_LISTED);
        if (this.roots.size >= MAX_CACHED) {
            this.roots.delete(this.roots.keys().next().value!);
        }
        this.roots.set(key, roots);
        return roots;
    }
}

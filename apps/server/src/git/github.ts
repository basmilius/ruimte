import { existsSync } from 'node:fs';
import { GitError, streamWithTimeout, type GitResult } from './run.ts';

// `gh` talks to the network, and a login prompt that cannot be answered would wait for ever.
const GH_TIMEOUT_MS = 30_000;
const GH_ENV = { GH_PROMPT_DISABLED: '1', NO_COLOR: '1' };

/* Runs `gh` with these arguments in a folder; a seam so tests hand in answers. */
export type GhRunner = (args: string[], cwd: string) => Promise<GitResult>;

export const runGh: GhRunner = (args, cwd) => {
    // A folder that is gone would otherwise read as a `gh` that cannot start.
    if (!existsSync(cwd)) {
        return Promise.reject(new GitError('folder-missing', 'That folder no longer exists on this machine.'));
    }
    return streamWithTimeout('gh', args, cwd, GH_TIMEOUT_MS, { env: GH_ENV });
};

/* A failed `gh` as an error a client can tell apart. Never reads a token: gh holds the login. */
export function ghError(result: GitResult): GitError {
    const text = result.stderr.trim();
    if (result.code === 128 && /could not be started/.test(text)) {
        return new GitError('gh-missing', 'The GitHub CLI (gh) is not installed on this machine.');
    }
    if (/gh auth login|not logged in|authentication required|HTTP 401/i.test(text)) {
        return new GitError('gh-unauthenticated', 'gh is not signed in on this machine. Run `gh auth login` there.');
    }
    return new GitError('gh-failed', text === '' ? 'gh failed' : text);
}

export async function ghOutput(run: GhRunner, args: string[], cwd: string): Promise<string> {
    const result = await run(args, cwd);
    if (result.code !== 0) {
        throw ghError(result);
    }
    return result.stdout;
}

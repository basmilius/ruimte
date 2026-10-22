import { lstat, readdir, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import type { GitActionPhase, GitCloneResult } from '@ruimte/contracts';
import { GitError, streamCommand } from './run.ts';

/*
 * The remotes a clone may come from: HTTPS, SSH in both spellings and the git protocol. A local path,
 * `file://` and the `ext::` transport are left out, since a clone from another machine's client must
 * reach the network and never run a command or read a folder of this one.
 */
const REMOTE_URL = /^(https?:\/\/|ssh:\/\/|git:\/\/)[^\s]+$|^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/;

export function isRemoteUrl(url: string): boolean {
    return !url.startsWith('-') && REMOTE_URL.test(url);
}

interface CloneJob {
    hold(kill: () => void): void;
    /* Whether a cancel came in, so a failure reads as one. */
    readonly canceled: boolean;
}

export interface CloneOptions {
    url: string;
    path: string;
    job: CloneJob;
    onProgress(phase: GitActionPhase, line: string): void;
    run?: typeof streamCommand;
}

async function emptyOrAbsent(path: string): Promise<'absent' | 'empty' | 'taken'> {
    const found = await lstat(path).catch(() => null);
    if (found === null) {
        return 'absent';
    }
    if (!found.isDirectory()) {
        return 'taken';
    }
    return (await readdir(path)).length === 0 ? 'empty' : 'taken';
}

/*
 * `git clone` of a remote into a new folder, with its progress as it runs. SSH runs in batch mode
 * unless a person set their own command, so a key that needs a passphrase fails instead of waiting on
 * a terminal nobody sees. A clone that fails or is canceled leaves no half folder behind it, and a
 * folder that was there already (empty) is left as it was.
 */
export async function cloneRepository(options: CloneOptions): Promise<GitCloneResult> {
    const { url, job, onProgress } = options;
    if (!isRemoteUrl(url)) {
        throw new GitError('clone-refused', 'Only an HTTPS, SSH or git URL of a remote can be cloned');
    }
    if (!isAbsolute(options.path)) {
        throw new GitError('clone-refused', 'The folder to clone into must be an absolute path');
    }
    const path = resolve(options.path);
    const parent = dirname(path);
    if ((await lstat(parent).catch(() => null))?.isDirectory() !== true) {
        throw new GitError('folder-missing', `${parent} is not a folder on this machine`);
    }
    const before = await emptyOrAbsent(path);
    if (before === 'taken') {
        throw new GitError('clone-refused', `${path} is already there and not empty`);
    }
    const env = process.env.GIT_SSH_COMMAND === undefined && process.env.GIT_SSH === undefined ? { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' } : undefined;
    onProgress('fetch', '');
    const result = await (options.run ?? streamCommand)('git', ['clone', '--progress', '--', url, basename(path)], parent, {
        onLine: (line) => onProgress('fetch', line),
        onSpawn: (kill) => job.hold(kill),
        group: true,
        ...(env === undefined ? {} : { env })
    });
    const output = `${result.stdout}${result.stderr}`.trim();
    if (result.code !== 0 || job.canceled) {
        if (before === 'absent') {
            await rm(path, { recursive: true, force: true });
        } else {
            await Promise.all((await readdir(path).catch(() => [])).map((name) => rm(resolve(path, name), { recursive: true, force: true })));
        }
        const message = job.canceled ? 'The clone was canceled.' : output.split('\n').findLast((line) => line.trim() !== '') || 'git clone failed';
        onProgress('failed', message);
        throw new GitError('git-failed', message);
    }
    onProgress('done', `Cloned into ${path}`);
    return { path, output };
}

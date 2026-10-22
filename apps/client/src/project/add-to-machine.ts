import { IGNORED_COPY_MAX_BYTES, type FsReadResult, type GitIgnoredFilesResult } from '@ruimte/contracts';

export type RemoteProtocol = 'ssh' | 'https';

// `git@host:owner/repo.git`, the short SSH form most hosts show.
const SCP_LIKE = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):(?!\/\/)(.+)$/;

/* Which way a remote URL reaches its host; null for anything that is neither, such as a local path. */
export function protocolOf(url: string): RemoteProtocol | null {
    if (/^https?:\/\//.test(url)) {
        return 'https';
    }
    if (/^ssh:\/\//.test(url) || SCP_LIKE.test(url)) {
        return 'ssh';
    }
    return null;
}

/* Host and path of a remote URL, whichever way it is written, without credentials or a port. */
function hostAndPath(url: string): { host: string; path: string } | null {
    const scp = SCP_LIKE.exec(url);
    if (scp !== null) {
        return { host: scp[2]!, path: scp[3]! };
    }
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:', 'ssh:'].includes(parsed.protocol) || parsed.hostname === '') {
            return null;
        }
        return { host: parsed.hostname, path: parsed.pathname.replace(/^\//, '') };
    } catch {
        return null;
    }
}

/*
 * The same repository over the other protocol, the way a hosting service writes both: `git@host:path`
 * and `https://host/path`. A URL that already is the protocol asked for comes back as it is, so its
 * port or user stay; null when the URL is no remote.
 */
export function remoteUrlAs(url: string, protocol: RemoteProtocol): string | null {
    const current = protocolOf(url);
    if (current === null) {
        return null;
    }
    if (current === protocol) {
        return url;
    }
    const parts = hostAndPath(url);
    if (parts === null) {
        return null;
    }
    return protocol === 'https' ? `https://${parts.host}/${parts.path}` : `git@${parts.host}:${parts.path}`;
}

/* The folder name a clone takes by default: the last part of the path, without `.git`. */
export function repositoryName(url: string): string {
    const path = hostAndPath(url)?.path ?? url;
    const last = path.replace(/\/+$/, '').split('/').at(-1) ?? '';
    return last.replace(/\.git$/, '') || 'repository';
}

export type CopySkip = 'link' | 'too-large';

export interface CopyCandidate {
    path: string;
    size: number;
    /* The permission bits the copy is made with. */
    mode: number;
    /* Why it is never copied; null when it can be. */
    skip: CopySkip | null;
    /* Checked when the list opens. */
    checked: boolean;
}

/* `.env`, `.env.local`, `app/.env.production`: what a project almost always needs to run and never commits. */
function isEnvFile(path: string): boolean {
    return /^\.env/.test(path.split('/').at(-1) ?? '');
}

// What a file is copied with when its machine did not say: only its owner reads it.
const PRIVATE_MODE = 0o600;

// Group and others may read it, which is what a machine that writes 0644 gives every file anyway.
function readableByAll(mode: number): boolean {
    return (mode & 0o044) === 0o044;
}

/* The ignored files as the list shows them: `.env*` checked, links and anything over the limit never copied. */
export function copyCandidates(listed: GitIgnoredFilesResult): CopyCandidate[] {
    return listed.files.map((file) => {
        const skip: CopySkip | null = file.link ? 'link' : file.size > IGNORED_COPY_MAX_BYTES ? 'too-large' : null;
        return { path: file.path, size: file.size, mode: file.mode ?? PRIVATE_MODE, skip, checked: skip === null && isEnvFile(file.path) };
    });
}

export type CopyOutcome =
    | { path: string; copied: true }
    | { path: string; copied: false; reason: 'binary' | 'too-large' | 'link' | 'private' | 'failed'; message?: string };

export interface CopyIo {
    read(path: string): Promise<FsReadResult>;
    write(path: string, text: string, mode: number): Promise<void>;
    /* Whether the machine written to makes a file with the bits it is given; one that does not makes every file 0644. */
    keepsMode: boolean;
}

function joined(root: string, path: string): string {
    return `${root.replace(/\/+$/, '')}/${path}`;
}

/*
 * Copies text files from one checkout into its clone through the client: read on the one machine,
 * written on the other with the permission bits it has here, one at a time so a large list never holds
 * every file in memory. A file that is not text, too large, private to a machine that would widen it,
 * or fails says so and the rest go on.
 */
export async function copyIgnoredFiles(
    files: readonly CopyCandidate[],
    from: string,
    to: string,
    io: CopyIo,
    onCopied?: (done: number) => void
): Promise<CopyOutcome[]> {
    const outcomes: CopyOutcome[] = [];
    for (const file of files) {
        outcomes.push(await copyOne(file, from, to, io));
        onCopied?.(outcomes.length);
    }
    return outcomes;
}

async function copyOne(file: CopyCandidate, from: string, to: string, io: CopyIo): Promise<CopyOutcome> {
    if (file.skip !== null) {
        return { path: file.path, copied: false, reason: file.skip };
    }
    if (!io.keepsMode && !readableByAll(file.mode)) {
        return { path: file.path, copied: false, reason: 'private' };
    }
    try {
        const read = await io.read(joined(from, file.path));
        if (read.kind === 'binary') {
            return { path: file.path, copied: false, reason: 'binary' };
        }
        if (read.kind === 'too-large' || read.size > IGNORED_COPY_MAX_BYTES) {
            return { path: file.path, copied: false, reason: 'too-large' };
        }
        await io.write(joined(to, file.path), read.text, file.mode);
        return { path: file.path, copied: true };
    } catch (e) {
        return { path: file.path, copied: false, reason: 'failed', message: e instanceof Error ? e.message : String(e) };
    }
}

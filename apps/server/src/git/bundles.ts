import { mkdir, open, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KeyedSerializer } from '@adecore/utils/async';
import {
    BUNDLE_MAX_BYTES,
    BYTES_CHUNK_MAX,
    PEER_MAX_OPEN_TASKS,
    type GitBundlePayload,
    type GitBundleResult,
    type GitFetchBundlePayload,
    type GitFetchBundleResult
} from '@ruimte/contracts';
import { sha256, sha256Of } from '../disk/hash.ts';
import type { CheckpointService } from './checkpoints.ts';
import { GitError, git, gitOrThrow, runGit, toplevel, verifyRev } from './run.ts';
import type { Worktrees } from './worktrees.ts';

const ID = /^[a-z0-9][a-z0-9-]{5,63}$/;
const COMMIT = /^[0-9a-f]{7,64}$/;
const HANDOFF = 'refs/ruimte/handoff/';
const RECEIVED = 'refs/ruimte/received/';

// More than a few pieces of different bundles on their way in at once means a client that never finishes.
const MAX_OPEN_UPLOADS = 16;

// A client that asks for bundles and never reads them would otherwise fill the disk one checkout at a time.
const MAX_MADE_PER_CLIENT = 4;
const MAX_MADE = 16;

// What one machine that works here may have sent to this disk at once, finished transfers that were not taken in yet included.
export const PEER_MAX_BUNDLES = 2;
export const PEER_MAX_BUNDLE_BYTES = 512 * 1024 * 1024;
// Results written for that machine and not read to the end yet: a place for every task it may have open, twice, so three fetched together all arrive.
export const PEER_MAX_RESULT_BUNDLES = PEER_MAX_OPEN_TASKS * 2;

/* How much of this disk the bundles of one machine may hold. */
interface BundleLimits {
    /* Transfers it sent. */
    bundles: number;
    bytes: number;
    /* Results written for it; its own count, so a result never takes the place of a transfer. */
    results?: number;
}

const TOO_BIG = `The work to send is larger than ${BUNDLE_MAX_BYTES / 1024 / 1024} MiB. Push the branch to origin and fetch it there instead.`;

const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null'];

/* A machine id as a folder name, whatever characters the id holds. */
function peerFolder(machineId: string): string {
    return sha256(machineId).slice(0, 32);
}

/*
 * The bundles of this machine: the ones it wrote for another machine to read, and the ones another
 * machine is sending. Both live under `$RUIMTE_HOME/bundles` and nothing outside it is reachable by
 * an id, since an id is only a name of that folder.
 */
export class BundleStore {
    readonly root: string;
    readonly incoming: string;
    private readonly uploads = new KeyedSerializer();
    private readonly admitting = new KeyedSerializer();
    // What each incoming bundle is meant to weigh, as the sender said; a file that reached it waits for its fetch and is no open upload.
    private readonly expected = new Map<string, number>();
    // The client each bundle written here was for, oldest first, and how far it got: a bundle being made or read is never evicted.
    private readonly madeFor = new Map<string, { clientId: string; state: 'making' | 'made' | 'reading' }>();
    // Only the bundles of a machine that works here are capped; a person's own are bounded per client.
    private readonly limits: BundleLimits | null;

    constructor(home: string, peer?: string, limits: BundleLimits = { bundles: PEER_MAX_BUNDLES, bytes: PEER_MAX_BUNDLE_BYTES }) {
        this.root = peer === undefined ? join(home, 'bundles') : join(home, 'bundles', 'peers', peerFolder(peer));
        this.incoming = join(this.root, 'incoming');
        this.limits = peer === undefined ? null : limits;
    }

    static isId(id: string): boolean {
        return ID.test(id);
    }

    pathOf(id: string): string {
        return join(this.root, `${this.checked(id)}.bundle`);
    }

    incomingPathOf(id: string): string {
        return join(this.incoming, `${this.checked(id)}.bundle`);
    }

    /* The file of a bundle this machine wrote, or null when it is gone. */
    async made(id: string): Promise<string | null> {
        if (!BundleStore.isId(id)) {
            return null;
        }
        const path = this.pathOf(id);
        if (!(await stat(path).catch(() => null))?.isFile()) {
            return null;
        }
        const held = this.madeFor.get(id);
        if (held !== undefined) {
            held.state = 'reading';
        }
        return path;
    }

    /* How many bundles a client holds that nobody read to the end yet. */
    heldBy(clientId: string): number {
        return [...this.madeFor.values()].filter((held) => held.clientId === clientId).length;
    }

    /* Refuses a client that holds its share already, and otherwise holds a place for the bundle `id` until it is kept or discarded. */
    admit(clientId: string, id: string): void {
        if (this.heldBy(clientId) >= MAX_MADE_PER_CLIENT) {
            throw new GitError('bundle-limit', `${MAX_MADE_PER_CLIENT} transfers are already waiting on this machine. Try again once they are done.`);
        }
        this.madeFor.set(id, { clientId, state: 'making' });
    }

    /* Notes a bundle written for a client, and drops the oldest ones nobody began to read beyond the machine's share. */
    async keep(id: string, clientId: string): Promise<void> {
        this.madeFor.set(id, { clientId, state: 'made' });
        const share = this.limits === null ? MAX_MADE : (this.limits.results ?? PEER_MAX_RESULT_BUNDLES);
        const unread = [...this.madeFor].filter(([other, held]) => other !== id && held.state === 'made').map(([other]) => other);
        for (const oldest of unread.slice(0, Math.max(0, this.madeFor.size - share))) {
            await this.discard(oldest);
        }
    }

    /* Removes a bundle written here, once its last piece was read or it is not wanted. */
    async discard(id: string): Promise<void> {
        this.madeFor.delete(id);
        if (BundleStore.isId(id)) {
            await rm(this.pathOf(id), { force: true });
        }
    }

    /* Removes a bundle that came in, whether it was taken in or refused. */
    async dropIncoming(id: string): Promise<void> {
        this.expected.delete(id);
        await this.uploads.run(id, () => rm(this.incomingPathOf(id), { force: true }));
    }

    /* What the transfers sent by this machine weigh, not counting the one `except` names, which a new upload replaces. */
    private async stored(except: string): Promise<{ count: number; bytes: number }> {
        let count = 0;
        let bytes = 0;
        for (const name of await readdir(this.incoming).catch(() => [])) {
            if (name.endsWith('.bundle') && name.slice(0, -'.bundle'.length) !== except) {
                count += 1;
                bytes += (await stat(join(this.incoming, name)).catch(() => null))?.size ?? 0;
            }
        }
        return { count, bytes };
    }

    private async unfinishedUploads(): Promise<number> {
        let open = 0;
        for (const name of await readdir(this.incoming)) {
            const id = name.slice(0, -'.bundle'.length);
            const total = this.expected.get(id);
            const size = (await stat(join(this.incoming, name)).catch(() => null))?.size ?? 0;
            if (name.endsWith('.bundle') && (total === undefined || size < total)) {
                open += 1;
            }
        }
        return open;
    }

    /*
     * Appends a piece at the end of what came in so far; a piece at offset 0 starts the bundle over.
     * `total` is the size the sender will have sent by the last piece, which is what tells a finished upload from an open one.
     */
    async receive(id: string, offset: number, bytes: Uint8Array, total?: number): Promise<number> {
        const path = this.incomingPathOf(id);
        return this.uploads.run(id, async () => {
            if (
                bytes.byteLength > BYTES_CHUNK_MAX ||
                offset + bytes.byteLength > BUNDLE_MAX_BYTES ||
                (total !== undefined && offset + bytes.byteLength > total)
            ) {
                throw new GitError('bundle-too-large', TOO_BIG);
            }
            await mkdir(this.incoming, { recursive: true, mode: 0o700 });
            const have = (await stat(path).catch(() => null))?.size ?? null;
            if (offset > 0 && have !== offset) {
                throw new GitError('bundle-offset', 'The transfer broke off. Send it again from the start.');
            }
            const { limits } = this;
            if (offset === 0 && limits !== null) {
                // The file is made inside the check, so two transfers that begin together cannot both take the last place.
                await this.admitting.run('peer', async () => {
                    const held = await this.stored(id);
                    if (held.count >= limits.bundles || held.bytes + (total ?? bytes.byteLength) > limits.bytes) {
                        throw new GitError(
                            'peer-bundle-limit',
                            `This machine already keeps ${limits.bundles} transfers for that machine. Try again once they are taken in.`
                        );
                    }
                    await writeFile(path, new Uint8Array(0), { mode: 0o600 });
                });
            }
            if (have === null && (await this.unfinishedUploads()) >= MAX_OPEN_UPLOADS) {
                throw new GitError('bundle-uploads-busy', 'This machine is receiving too many transfers at once. Try again in a moment.');
            }
            if (total !== undefined) {
                this.expected.set(id, total);
            }
            const file = await open(path, offset === 0 ? 'w' : 'a', 0o600);
            try {
                await file.write(bytes);
            } finally {
                await file.close();
            }
            return offset + bytes.byteLength;
        });
    }

    /* Removes every bundle not named in `keep`. Run at daemon start, when no transfer is open; never on a clock. */
    async sweep(keep: ReadonlySet<string> = new Set()): Promise<void> {
        this.expected.clear();
        this.madeFor.clear();
        // What machines that work here sent lives in a store of its own per machine, below the root.
        await rm(join(this.root, 'peers'), { recursive: true, force: true });
        for (const folder of [this.root, this.incoming]) {
            for (const name of await readdir(folder).catch(() => [])) {
                if (name.endsWith('.bundle') && !keep.has(name.slice(0, -'.bundle'.length))) {
                    await rm(join(folder, name), { force: true });
                }
            }
        }
    }

    private checked(id: string): string {
        if (!BundleStore.isId(id)) {
            throw new GitError('bundle-missing', 'The transfer did not arrive. Send it again.');
        }
        return id;
    }
}

/* The id the bundle of one piece of work always has, so sending it again replaces the earlier copy instead of adding to it. */
export function bundleIdFor(key: string): string {
    return `bundle-${sha256(key).slice(0, 32)}`;
}

/* Git commits as someone even where nobody set a name, since the handoff commit is the daemon's. */
async function committer(top: string): Promise<Record<string, string>> {
    const [name, email] = await Promise.all([git(['config', 'user.name'], top), git(['config', 'user.email'], top)]);
    return {
        ...(name?.trim() ? {} : { GIT_AUTHOR_NAME: 'Ruimte', GIT_COMMITTER_NAME: 'Ruimte' }),
        ...(email?.trim() ? {} : { GIT_AUTHOR_EMAIL: 'ruimte@localhost', GIT_COMMITTER_EMAIL: 'ruimte@localhost' })
    };
}

/* The commits of `haves` this repository has too, since a bundle can only leave out what the receiver and the sender share. */
async function sharedCommits(top: string, haves: readonly string[]): Promise<string[]> {
    const shared: string[] = [];
    for (let at = 0; at < haves.length; at += 8) {
        const batch = haves.slice(at, at + 8).filter((have) => COMMIT.test(have));
        const known = await Promise.all(batch.map(async (have) => (await runGit(['cat-file', '-e', `${have}^{commit}`], top)).code === 0));
        shared.push(...batch.filter((_have, i) => known[i]));
    }
    return shared;
}

/*
 * Writes a checkout's state as a bundle. The state is a commit made from a tree (the working tree
 * through the checkpoint index, or HEAD's tree) on top of HEAD, or the tip of a branch; the person's
 * index, stashes, branches and files stay as they were. The bundle names its tip under a ref of its
 * own so it can be fetched without a branch name in common.
 */
export async function makeBundle(
    store: BundleStore,
    checkpoints: Pick<CheckpointService, 'take' | 'head'>,
    payload: GitBundlePayload,
    id: string = crypto.randomUUID()
): Promise<GitBundleResult> {
    const top = await toplevel(payload.path);
    const ref = `${HANDOFF}${id}`;
    const head = await verifyRev('HEAD^{commit}', top);
    let commit: string;
    let base: string | null = head;
    if (payload.from === 'branch') {
        if (payload.branch === undefined) {
            throw new GitError('no-branch', 'A bundle of a branch names the branch.');
        }
        const tip = await verifyRev(`${payload.branch}^{commit}`, top);
        if (tip === null) {
            throw new GitError('ref-not-found', `${payload.branch} is not a branch, tag or commit of this repository.`);
        }
        commit = tip;
        base = null;
    } else {
        const tree = payload.from === 'files' ? await checkpoints.take(top) : head === null ? null : await verifyRev(`${head}^{tree}`, top);
        if (tree === null) {
            throw new GitError(
                'ref-not-found',
                payload.from === 'files' ? 'The files of this checkout could not be read.' : 'This checkout has no commit yet.'
            );
        }
        const written = await gitOrThrow(
            ['-c', 'commit.gpgSign=false', 'commit-tree', tree, ...(head === null ? [] : ['-p', head]), '-m', payload.name],
            top,
            await committer(top)
        );
        commit = written.trim();
    }
    const haves = await sharedCommits(top, payload.haves);
    if (base === null && haves.length > 0) {
        base = (await git(['merge-base', commit, ...haves], top))?.trim().split('\n')[0] || null;
    }
    const path = store.pathOf(id);
    await mkdir(store.root, { recursive: true, mode: 0o700 });
    await gitOrThrow(['update-ref', ref, commit], top);
    try {
        const made = await runGit(['bundle', 'create', '--quiet', path, ref, ...(haves.length > 0 ? ['--not', ...haves] : [])], top);
        if (made.code !== 0) {
            throw new GitError('git-failed', made.stderr.trim() || 'git bundle failed');
        }
    } catch (e) {
        await rm(path, { force: true });
        throw e;
    } finally {
        await runGit(['update-ref', '-d', ref], top);
    }
    const size = (await stat(path)).size;
    if (size > BUNDLE_MAX_BYTES) {
        await rm(path, { force: true });
        throw new GitError('bundle-too-large', TOO_BIG);
    }
    return { bundleId: id, size, sha256: await sha256Of(path), commit, base };
}

function slug(text: string): string {
    return (
        text
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^[-.]+|[-.]+$/g, '') || 'machine'
    );
}

async function refIsValid(top: string, ref: string): Promise<boolean> {
    return (await runGit(['check-ref-format', ref], top)).code === 0;
}

/*
 * Takes a received bundle into a repository without running anything it carries: the fetch has git's
 * hooks off and nothing but one ref of the bundle is read. The tip is kept under `refs/ruimte/received`
 * and a worktree is made on it, so the work is there to open and to merge. `beforeWorktree` hears the
 * folder before git makes it.
 */
export async function fetchBundle(
    store: BundleStore,
    worktrees: Worktrees,
    folder: string,
    payload: GitFetchBundlePayload,
    beforeWorktree?: (path: string, branch: string) => Promise<void>
): Promise<GitFetchBundleResult> {
    try {
        return await takeIn(store, worktrees, folder, payload, beforeWorktree);
    } finally {
        // Taken in or refused, the file is of no use again: a sender that tries once more sends it from the start.
        await store.dropIncoming(payload.bundleId);
    }
}

async function takeIn(
    store: BundleStore,
    worktrees: Worktrees,
    folder: string,
    payload: GitFetchBundlePayload,
    beforeWorktree?: (path: string, branch: string) => Promise<void>
): Promise<GitFetchBundleResult> {
    const file = store.incomingPathOf(payload.bundleId);
    if (!(await stat(file).catch(() => null))?.isFile()) {
        throw new GitError('bundle-missing', 'The transfer did not arrive. Send it again.');
    }
    if ((await sha256Of(file)) !== payload.sha256) {
        throw new GitError('bundle-corrupt', 'What arrived is not what was sent. Send it again.');
    }
    const top = await toplevel(folder);
    const verified = await runGit(['bundle', 'verify', file], top);
    if (verified.code !== 0) {
        throw new GitError('bundle-unverified', verified.stderr.trim() || 'The work that arrived does not fit this repository.');
    }
    const heads = (await gitOrThrow(['bundle', 'list-heads', file], top)).split('\n');
    const source = heads.map((line) => line.split(' ')[1]).find((name): name is string => name !== undefined && name.startsWith(HANDOFF));
    if (source === undefined) {
        throw new GitError('bundle-unverified', 'The work that arrived holds no chat.');
    }
    const kept = `${RECEIVED}${payload.bundleId}`;
    await gitOrThrow([...NO_HOOKS, 'fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', file, `+${source}:${kept}`], top);
    const commit = (await verifyRev(`${kept}^{commit}`, top)) ?? '';
    try {
        const name = payload.branch.replace(/^ruimte\//, '');
        if (!(await refIsValid(top, `refs/heads/ruimte/${name}`))) {
            throw new GitError('git-failed', `${payload.branch} is not a usable branch name.`);
        }
        if (payload.into === 'remote-ref') {
            const remoteRef = `refs/remotes/ruimte-${slug(payload.machine ?? 'machine')}/${payload.branch}`;
            if (!(await refIsValid(top, remoteRef))) {
                throw new GitError('git-failed', `${payload.branch} is not a usable branch name.`);
            }
            // Only from what it was a moment ago: a branch that moved meanwhile is not overwritten blind.
            const before = (await verifyRev(remoteRef, top)) ?? '';
            await gitOrThrow([...NO_HOOKS, 'update-ref', remoteRef, commit, before], top);
        }
        const made = await worktrees.addFresh(
            top,
            `ruimte/${name}`,
            { madeBy: 'client', projectId: payload.projectId },
            {
                base: kept,
                hooksOff: true,
                ...(beforeWorktree === undefined ? {} : { beforeAdd: beforeWorktree })
            }
        );
        return { path: made.path, branch: made.branch, commit };
    } finally {
        // The worktree and the remote ref hold the commit now, or the take-in failed; either way the staging ref is done.
        await runGit([...NO_HOOKS, 'update-ref', '-d', kept], top);
    }
}

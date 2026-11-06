import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitBundleResult, GitFetchBundleResult, ServerFrame } from '@ruimte/contracts';
import { MachineHome } from '../disk/machine-home.ts';
import { Dispatcher } from '../dispatcher.ts';
import { BundleStore } from '../git/bundles.ts';
import { Checkpoints } from '../git/checkpoints.ts';
import { gitIn, initRepo, NO_WORKTREE_AGENTS } from '../git/test-repo.ts';
import { Worktrees } from '../git/worktrees.ts';
import { gitArea } from './git.ts';
import { gitDepsWith } from './test-helpers.ts';

/*
 * The trust of a checkout a person hands to another machine, through the requests the client sends:
 * `git.bundle` on the machine it comes from and `git.fetchBundle` on the one that takes it in.
 */

interface Machine {
    repo: string;
    bundles: BundleStore;
    dispatcher: Dispatcher;
    // The folders this machine never vouched for, as `peers.untrustFolder` writes them down.
    untrusted: Array<{ path: string; branch?: string }>;
    onUntrust?: (path: string) => Promise<void>;
}

let root: string;
let a: Machine;
let b: Machine;

async function machine(name: string): Promise<Machine> {
    const home = join(root, `${name}-home`);
    await mkdir(home, { recursive: true });
    const untrusted: Machine['untrusted'] = [];
    const worktrees = new Worktrees(home, NO_WORKTREE_AGENTS, Date.now, () => null, {
        branches: () => untrusted.flatMap((record) => (record.branch === undefined ? [] : [record.branch])),
        untrust: async (path, branch) => void untrusted.push({ path, branch })
    });
    const bundles = new BundleStore(home);
    const repo = join(root, name);
    const dispatcher = new Dispatcher();
    const result: Machine = { repo, bundles, dispatcher, untrusted };
    gitArea(
        gitDepsWith({
            worktrees,
            bundles,
            checkpoints: new Checkpoints(home, new MachineHome(home)),
            folderOf: async () => repo,
            untrusted: (path) => untrusted.some((record) => path === record.path || path.startsWith(`${record.path}/`)),
            untrustFolder: async (path, branch) => {
                untrusted.push({ path, branch });
                await result.onUntrust?.(path);
            }
        })
    ).handlers?.(dispatcher);
    return result;
}

async function ask<T>(on: Machine, type: string, payload: unknown): Promise<T> {
    const frames: ServerFrame[] = [];
    await on.dispatcher.handle({ id: 'person', send: (frame) => frames.push(frame) }, JSON.stringify({ id: type, type, payload }));
    const reply = frames.at(-1) as { ok: boolean; result?: T; error?: { code: string; message: string } };
    if (!reply.ok) {
        throw new Error(`${reply.error?.code}: ${reply.error?.message}`);
    }
    return reply.result as T;
}

/* What the client does for a handoff: bundle on one machine, move the bytes, take it in on the other. */
async function handOff(
    from: Machine,
    to: Machine,
    path: string,
    into: 'worktree' | 'remote-ref'
): Promise<{ made: GitBundleResult; taken: GitFetchBundleResult }> {
    const made = await ask<GitBundleResult>(from, 'git.bundle', { path, from: 'files', haves: [], name: 'Handoff' });
    const bytes = new Uint8Array(await Bun.file(from.bundles.pathOf(made.bundleId)).arrayBuffer());
    await ask(to, 'git.bundlePut', { bundleId: made.bundleId, offset: 0, data: Buffer.from(bytes).toString('base64'), total: bytes.byteLength });
    const taken = await ask<GitFetchBundleResult>(to, 'git.fetchBundle', {
        projectId: 'p',
        bundleId: made.bundleId,
        sha256: made.sha256,
        branch: 'atlas',
        into,
        machine: 'Laptop',
        ...(made.untrusted === true ? { untrusted: true } : {})
    });
    return { made, taken };
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-handoff-trust-')));
    a = await machine('a');
    b = await machine('b');
    await initRepo(a.repo, { 'a.txt': 'one\n' });
    await gitIn(root, ['clone', '--quiet', a.repo, b.repo]);
    await mkdir(join(a.repo, '.claude'), { recursive: true });
    await writeFile(join(a.repo, '.claude', 'settings.json'), '{"hooks":{}}\n');
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('a checkout a person hands to another machine', () => {
    test('from a checkout its machine vouches for is vouched for there too, settings included', async () => {
        const { made, taken } = await handOff(a, b, a.repo, 'worktree');

        expect(made.untrusted).toBeUndefined();
        expect(b.untrusted).toEqual([]);
        expect(await readFile(join(taken.path!, '.claude', 'settings.json'), 'utf8')).toBe('{"hooks":{}}\n');
    });

    test('from a folder its machine never vouched for stays untrusted there, written down before git made it', async () => {
        a.untrusted.push({ path: a.repo });
        const written = Promise.withResolvers<string>();
        const proceed = Promise.withResolvers<void>();
        b.onUntrust = async (path) => {
            written.resolve(path);
            await proceed.promise;
        };
        const transfer = handOff(a, b, a.repo, 'worktree');
        let outcome: Awaited<typeof transfer>;
        try {
            const path = await Promise.race([
                written.promise,
                transfer.then(() => {
                    throw new Error('git completed before the trust write');
                })
            ]);
            expect(b.untrusted).toEqual([{ path, branch: 'ruimte/atlas' }]);
            expect(await stat(path).catch(() => null)).toBeNull();
        } finally {
            proceed.resolve();
            outcome = await transfer;
        }
        const { made, taken } = outcome;

        expect(made.untrusted).toBe(true);
        expect(b.untrusted).toEqual([{ path: taken.path!, branch: taken.branch }]);
        expect((await stat(join(taken.path!, '.git'))).isFile()).toBe(true);
    });

    test('brought back to the machine of the project is untrusted there, whoever asked for it', async () => {
        const { taken: there } = await handOff(a, b, a.repo, 'worktree');
        await writeFile(join(there.path!, 'done.txt'), 'done\n');

        const { made, taken: back } = await handOff(b, a, there.path!, 'remote-ref');

        expect(made.untrusted).toBeUndefined();
        expect(a.untrusted.map((record) => record.path)).toContain(back.path!);
    });
});

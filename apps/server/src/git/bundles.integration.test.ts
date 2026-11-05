import { afterAll, afterEach, beforeAll, beforeEach, expect, setDefaultTimeout, test } from 'bun:test';
import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BYTES_CHUNK_MAX } from '@ruimte/contracts';
import { sha256Of } from '../disk/hash.ts';
import { BundleStore, fetchBundle, makeBundle } from './bundles.ts';
import { Checkpoints } from './checkpoints.ts';
import { listRefs } from './refs.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate, NO_WORKTREE_AGENTS } from './test-repo.ts';
import { Worktrees } from './worktrees.ts';

// Real Git subprocesses on a loaded runner are not bound by the unit-test execution budget.
setDefaultTimeout(30_000);

let root: string;
let template: RepoTemplate;
let first: Machine;
let second: Machine;

interface Machine {
    home: string;
    repo: string;
    bundles: BundleStore;
    checkpoints: Checkpoints;
    worktrees: Worktrees;
}

async function machine(name: string): Promise<Machine> {
    const home = join(root, `${name}-home`);
    await mkdir(home, { recursive: true });
    return {
        home,
        repo: join(root, name),
        bundles: new BundleStore(home),
        checkpoints: new Checkpoints(home),
        worktrees: new Worktrees(home, NO_WORKTREE_AGENTS)
    };
}

/* Moves a bundle between two machines the way the client does: a piece at a time. */
async function send(from: Machine, to: Machine, bundleId: string): Promise<void> {
    const bytes = new Uint8Array(await Bun.file(from.bundles.pathOf(bundleId)).arrayBuffer());
    for (let offset = 0; offset < bytes.byteLength; offset += BYTES_CHUNK_MAX) {
        await to.bundles.receive(bundleId, offset, bytes.slice(offset, offset + BYTES_CHUNK_MAX));
    }
}

beforeAll(async () => {
    template = await repoTemplate('ruimte-bundles', async (dir) => {
        await initRepo(join(dir, 'first'), { 'a.txt': 'one\n', 'b.txt': 'two\n' });
        await gitIn(dir, ['clone', '--quiet', join(dir, 'first'), join(dir, 'second')]);
        for (const [key, value] of Object.entries({ 'user.name': 'Ada', 'user.email': 'a@a', 'commit.gpgSign': 'false', 'gc.auto': '0' })) {
            await gitIn(join(dir, 'second'), ['config', '--local', key, value]);
        }
    });
});

afterAll(async () => {
    await template.dispose();
});

beforeEach(async () => {
    root = await template.copy();
    first = await machine('first');
    second = await machine('second');
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function dirty(): Promise<void> {
    await writeFile(join(first.repo, 'a.txt'), 'one, changed\n');
    await writeFile(join(first.repo, 'new.txt'), 'untracked\n');
    await writeFile(join(first.repo, 'staged.txt'), 'staged\n');
    await gitIn(first.repo, ['add', 'staged.txt']);
}

test('the working tree is in the bundle as a commit on HEAD, and the checkout is left as it was', async () => {
    await dirty();
    const statusBefore = await gitIn(first.repo, ['status', '--porcelain=v2', '--branch']);
    const indexBefore = await sha256Of(join(first.repo, '.git', 'index'));
    const head = (await gitIn(first.repo, ['rev-parse', 'HEAD'])).trim();

    const made = await makeBundle(first.bundles, first.checkpoints, { path: first.repo, from: 'files', haves: [], name: 'Handoff' });

    expect(await gitIn(first.repo, ['status', '--porcelain=v2', '--branch'])).toBe(statusBefore);
    expect(await sha256Of(join(first.repo, '.git', 'index'))).toBe(indexBefore);
    expect(await gitIn(first.repo, ['for-each-ref', 'refs/ruimte'])).toBe('');
    expect(made.base).toBe(head);
    expect(made.size).toBe(Bun.file(first.bundles.pathOf(made.bundleId)).size);
    expect(made.sha256).toBe(await sha256Of(first.bundles.pathOf(made.bundleId)));

    const read = (path: string): Promise<string> => gitIn(first.repo, ['show', `${made.commit}:${path}`]);
    expect(await read('a.txt')).toBe('one, changed\n');
    expect(await read('new.txt')).toBe('untracked\n');
    expect(await read('staged.txt')).toBe('staged\n');
    expect((await gitIn(first.repo, ['rev-parse', `${made.commit}^`])).trim()).toBe(head);
});

test('what the receiver already has is left out of the bundle, and a have this checkout lacks is ignored', async () => {
    await dirty();
    const head = (await gitIn(first.repo, ['rev-parse', 'HEAD'])).trim();
    const full = await makeBundle(first.bundles, first.checkpoints, { path: first.repo, from: 'head', haves: [], name: 'Full' });
    const lean = await makeBundle(first.bundles, first.checkpoints, {
        path: first.repo,
        from: 'head',
        haves: [head, 'f'.repeat(40), '--all'],
        name: 'Lean'
    });
    expect(lean.size).toBeLessThan(full.size);
    const verified = Bun.spawnSync(['git', 'bundle', 'verify', first.bundles.pathOf(lean.bundleId)], { cwd: second.repo });
    expect(verified.exitCode).toBe(0);
    // HEAD's tree, not the working tree: the change is not in it.
    expect(await gitIn(first.repo, ['show', `${lean.commit}:a.txt`])).toBe('one\n');
});

test('a branch is bundled as it stands', async () => {
    await gitIn(first.repo, ['switch', '--quiet', '--create', 'feature']);
    await writeFile(join(first.repo, 'f.txt'), 'f\n');
    await gitIn(first.repo, ['add', '.']);
    await gitIn(first.repo, ['commit', '--quiet', '--message', 'feature work']);
    await gitIn(first.repo, ['switch', '--quiet', 'main']);
    const tip = (await gitIn(first.repo, ['rev-parse', 'feature'])).trim();
    const base = (await gitIn(first.repo, ['rev-parse', 'main'])).trim();

    const made = await makeBundle(first.bundles, first.checkpoints, { path: first.repo, from: 'branch', branch: 'feature', haves: [base], name: 'Feature' });

    expect(made.commit).toBe(tip);
    expect(made.base).toBe(base);
});

test('a bundle taken in on the other machine is a worktree holding the files', async () => {
    await dirty();
    const head = (await gitIn(first.repo, ['rev-parse', 'HEAD'])).trim();
    const made = await makeBundle(first.bundles, first.checkpoints, { path: first.repo, from: 'files', haves: [head], name: 'Handoff' });
    await send(first, second, made.bundleId);

    const result = await fetchBundle(second.bundles, second.worktrees, second.repo, {
        projectId: 'p',
        bundleId: made.bundleId,
        sha256: made.sha256,
        branch: 'atlas',
        into: 'worktree'
    });

    expect(result.branch).toBe('ruimte/atlas');
    expect(result.commit).toBe(made.commit);
    expect(await readFile(join(result.path!, 'a.txt'), 'utf8')).toBe('one, changed\n');
    expect(await readFile(join(result.path!, 'new.txt'), 'utf8')).toBe('untracked\n');
    expect((await second.worktrees.list(second.repo)).map((worktree) => worktree.path)).toContain(result.path!);
    // The other machine's own branch and checkout are untouched.
    expect((await gitIn(second.repo, ['status', '--porcelain'])).trim()).toBe('');
});

test('the work comes back as a remote branch and a worktree to merge', async () => {
    const head = (await gitIn(first.repo, ['rev-parse', 'HEAD'])).trim();
    const out = await makeBundle(first.bundles, first.checkpoints, { path: first.repo, from: 'head', haves: [head], name: 'Handoff' });
    await send(first, second, out.bundleId);
    const there = await fetchBundle(second.bundles, second.worktrees, second.repo, {
        projectId: 'p',
        bundleId: out.bundleId,
        sha256: out.sha256,
        branch: 'atlas',
        into: 'worktree'
    });
    await writeFile(join(there.path!, 'done.txt'), 'done\n');
    await gitIn(there.path!, ['add', '.']);
    await gitIn(there.path!, ['commit', '--quiet', '--message', 'the work']);

    const back = await makeBundle(second.bundles, second.checkpoints, { path: there.path!, from: 'branch', branch: there.branch, haves: [head], name: 'Back' });
    await send(second, first, back.bundleId);
    const here = await fetchBundle(first.bundles, first.worktrees, first.repo, {
        projectId: 'p',
        bundleId: back.bundleId,
        sha256: back.sha256,
        branch: there.branch,
        into: 'remote-ref',
        machine: 'MacBook Pro'
    });

    const refs = (await listRefs(first.repo)).refs;
    expect(refs.some((ref) => ref.kind === 'remote' && ref.name === 'ruimte-macbook-pro/ruimte/atlas' && ref.commit === back.commit)).toBe(true);
    expect((await first.worktrees.list(first.repo)).map((worktree) => worktree.path)).toContain(here.path!);
    expect(await readFile(join(here.path!, 'done.txt'), 'utf8')).toBe('done\n');
    // Not the person's own checkout.
    expect((await gitIn(first.repo, ['rev-parse', 'HEAD'])).trim()).toBe(head);
});

test('a bundle that is not the one named is refused before git reads it', async () => {
    const made = await makeBundle(first.bundles, first.checkpoints, { path: first.repo, from: 'head', haves: [], name: 'Handoff' });
    await send(first, second, made.bundleId);

    const refused = fetchBundle(second.bundles, second.worktrees, second.repo, {
        projectId: 'p',
        bundleId: made.bundleId,
        sha256: '0'.repeat(64),
        branch: 'atlas',
        into: 'worktree'
    });

    await expect(refused).rejects.toMatchObject({ code: 'bundle-corrupt' });
    expect(await gitIn(second.repo, ['for-each-ref', 'refs/ruimte'])).toBe('');
});

test('pieces out of order and over the cap are refused, and a sweep clears what is left', async () => {
    await second.bundles.receive('transfer-one', 0, new Uint8Array(10));
    await expect(second.bundles.receive('transfer-one', 5, new Uint8Array(10))).rejects.toMatchObject({ code: 'bundle-offset' });
    await expect(second.bundles.receive('transfer-one', 10, new Uint8Array(BYTES_CHUNK_MAX + 1))).rejects.toMatchObject({ code: 'bundle-too-large' });
    await expect(second.bundles.receive('../escape', 0, new Uint8Array(1))).rejects.toMatchObject({ code: 'bundle-missing' });

    await second.bundles.sweep();

    expect(await Bun.file(second.bundles.incomingPathOf('transfer-one')).exists()).toBe(false);
});

test('the file that came in is gone after a fetch, whether it was taken in or refused', async () => {
    const made = await makeBundle(first.bundles, first.checkpoints, { path: first.repo, from: 'head', haves: [], name: 'Handoff' });
    await send(first, second, made.bundleId);
    const incoming = second.bundles.incomingPathOf(made.bundleId);
    const request = { projectId: 'p', bundleId: made.bundleId, sha256: made.sha256, branch: 'atlas', into: 'worktree' as const };

    await expect(fetchBundle(second.bundles, second.worktrees, second.repo, { ...request, sha256: '0'.repeat(64) })).rejects.toMatchObject({
        code: 'bundle-corrupt'
    });
    expect(await Bun.file(incoming).exists()).toBe(false);

    await send(first, second, made.bundleId);
    await fetchBundle(second.bundles, second.worktrees, second.repo, request);
    expect(await Bun.file(incoming).exists()).toBe(false);
});

test('an upload that reached its size no longer counts as open, and abandoned ones are refused past the limit', async () => {
    const piece = new Uint8Array(4);
    for (let i = 0; i < 16; i++) {
        await second.bundles.receive(`finished-${i}`, 0, piece, 4);
    }
    // Sixteen files waiting for their fetch, and room for another transfer all the same.
    await second.bundles.receive('another-one', 0, piece, 8);

    for (let i = 0; i < 15; i++) {
        await second.bundles.receive(`open-${i}`, 0, piece, 8);
    }
    await expect(second.bundles.receive('one-too-many', 0, piece, 8)).rejects.toMatchObject({ code: 'bundle-uploads-busy' });
});

test('a client holds only a few bundles that nobody read, and the machine keeps only the newest of all', async () => {
    for (let i = 0; i < 4; i++) {
        const made = await makeBundle(first.bundles, first.checkpoints, { path: first.repo, from: 'head', haves: [], name: `Handoff ${i}` });
        await first.bundles.keep(made.bundleId, 'window');
    }
    expect(() => first.bundles.admit('window', 'refused-one')).toThrow(expect.objectContaining({ code: 'bundle-limit' }));
    expect(() => first.bundles.admit('other-window', 'other-one')).not.toThrow();

    const lastRead = (await readdir(first.bundles.root)).find((name) => name.endsWith('.bundle'))!;
    await first.bundles.discard(lastRead.slice(0, -'.bundle'.length));
    expect(await Bun.file(join(first.bundles.root, lastRead)).exists()).toBe(false);
    expect(() => first.bundles.admit('window', 'admitted-one')).not.toThrow();

    const ids: string[] = [];
    for (let i = 0; i < 18; i++) {
        const made = await makeBundle(first.bundles, first.checkpoints, { path: first.repo, from: 'head', haves: [], name: `Many ${i}` });
        ids.push(made.bundleId);
        await first.bundles.keep(made.bundleId, `window-${i}`);
    }
    expect(await first.bundles.made(ids[0]!)).toBeNull();
    expect(await first.bundles.made(ids.at(-1)!)).not.toBeNull();
});

test('no hook of the receiving repository runs while a bundle is taken in, and the staging ref is gone afterwards', async () => {
    const marker = join(root, 'hook-ran');
    for (const name of ['post-checkout', 'reference-transaction']) {
        const hook = join(second.repo, '.git', 'hooks', name);
        await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`);
        await chmod(hook, 0o755);
    }
    // A control: the hooks do fire for a worktree made the ordinary way.
    await gitIn(second.repo, ['worktree', 'add', '--quiet', join(root, 'control'), '-b', 'control']);
    expect(await Bun.file(marker).exists()).toBe(true);
    await rm(marker);

    const made = await makeBundle(first.bundles, first.checkpoints, { path: first.repo, from: 'head', haves: [], name: 'Handoff' });
    await send(first, second, made.bundleId);
    await fetchBundle(second.bundles, second.worktrees, second.repo, {
        projectId: 'p',
        bundleId: made.bundleId,
        sha256: made.sha256,
        branch: 'atlas',
        into: 'remote-ref',
        machine: 'Studio'
    });

    expect(await Bun.file(marker).exists()).toBe(false);
    expect(await gitIn(second.repo, ['for-each-ref', 'refs/ruimte'])).toBe('');
});

test('only the handoff ref of a bundle is read, whatever else it carries', async () => {
    await writeFile(join(first.repo, 'extra.txt'), 'extra\n');
    await gitIn(first.repo, ['add', '.']);
    await gitIn(first.repo, ['commit', '--quiet', '--message', 'main moved on']);
    const moved = (await gitIn(first.repo, ['rev-parse', 'main'])).trim();
    const handoff = (await gitIn(first.repo, ['rev-parse', 'HEAD'])).trim();
    await gitIn(first.repo, ['update-ref', 'refs/ruimte/handoff/crafted', handoff]);
    await mkdir(first.bundles.root, { recursive: true });
    const crafted = 'crafted-bundle-1';
    await gitIn(first.repo, ['bundle', 'create', '--quiet', first.bundles.pathOf(crafted), 'refs/ruimte/handoff/crafted', 'refs/heads/main']);
    const mainThere = (await gitIn(second.repo, ['rev-parse', 'main'])).trim();
    await send(first, second, crafted);

    await fetchBundle(second.bundles, second.worktrees, second.repo, {
        projectId: 'p',
        bundleId: crafted,
        sha256: await sha256Of(first.bundles.pathOf(crafted)),
        branch: 'atlas',
        into: 'worktree'
    });

    expect((await gitIn(second.repo, ['rev-parse', 'main'])).trim()).toBe(mainThere);
    expect(mainThere).not.toBe(moved);
    expect(await gitIn(second.repo, ['for-each-ref', 'refs/ruimte'])).toBe('');
});

test('bringing a branch back twice moves its remote ref to the newer tip', async () => {
    const head = (await gitIn(first.repo, ['rev-parse', 'HEAD'])).trim();
    const bringBack = async (title: string): Promise<string> => {
        const made = await makeBundle(second.bundles, second.checkpoints, { path: second.repo, from: 'files', haves: [head], name: title });
        await send(second, first, made.bundleId);
        await fetchBundle(first.bundles, first.worktrees, first.repo, {
            projectId: 'p',
            bundleId: made.bundleId,
            sha256: made.sha256,
            branch: 'atlas',
            into: 'remote-ref',
            machine: 'Studio'
        });
        return made.commit;
    };
    await writeFile(join(second.repo, 'one.txt'), '1\n');
    await bringBack('One');
    await writeFile(join(second.repo, 'two.txt'), '2\n');
    const newer = await bringBack('Two');
    expect((await gitIn(first.repo, ['rev-parse', 'refs/remotes/ruimte-studio/atlas'])).trim()).toBe(newer);
});

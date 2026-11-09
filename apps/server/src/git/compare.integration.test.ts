import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { access, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compareBranches, compareCommits, readSnapshot } from './compare.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';

const WEIRD = 'space [x]*?.txt';

describe('comparing two branches without a checkout', () => {
    let template: RepoTemplate;
    let root: string;
    let repo: string;

    beforeAll(async () => {
        template = await repoTemplate('ruimte-compare', async (folder) => {
            const at = join(folder, 'repo');

            await initRepo(at, { 'tracked.txt': 'original\n', '.gitattributes': 'tracked.txt diff=probe\n' });
            await writeFile(join(folder, 'textconv.sh'), 'printf ran > textconv-ran\ncat "$1"\n');
            await gitIn(at, ['config', 'diff.probe.textconv', 'sh ../textconv.sh']);

            await gitIn(at, ['checkout', '-q', '-b', 'left']);
            await writeFile(join(at, 'tracked.txt'), 'left\n');
            await writeFile(join(at, 'left.txt'), 'left only\n');
            await gitIn(at, ['add', '.']);
            await gitIn(at, ['commit', '-qm', 'left one']);
            await writeFile(join(at, 'left.txt'), 'left two\n');
            await gitIn(at, ['commit', '-qam', 'left two']);

            await gitIn(at, ['checkout', '-q', '-b', 'right', 'main']);
            await writeFile(join(at, 'tracked.txt'), 'right\n');
            await writeFile(join(at, WEIRD), 'literal\n');
            await writeFile(join(at, 'line\nbreak.txt'), 'newline path\n');
            await writeFile(join(at, '-option.txt'), 'option path\n');
            await writeFile(join(at, 'binary.bin'), new Uint8Array([1, 0, 2]));
            await writeFile(join(at, 'large.txt'), 'x'.repeat(600 * 1024));
            await symlink('/outside/the/repository', join(at, 'link.txt'));
            await mkdir(join(at, 'folder'));
            await writeFile(join(at, 'folder/inner.txt'), 'inner file\n');
            await gitIn(at, ['add', '.']);

            const left = (await gitIn(at, ['rev-parse', 'left'])).trim();

            await gitIn(at, ['update-index', '--add', '--cacheinfo', `160000,${left},vendor`]);
            await gitIn(at, ['commit', '-qm', 'right one']);
            await gitIn(at, ['tag', '-a', 'right-tag', '-m', 'annotated']);
            await gitIn(at, ['checkout', '-q', 'main']);
        });
    });

    afterAll(async () => {
        await template.dispose();
    });

    beforeEach(async () => {
        root = await template.copy();
        repo = join(root, 'repo');
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('leaves HEAD, the index and the working tree as they were, dirty work included', async () => {
        await writeFile(join(repo, 'tracked.txt'), 'staged\n');
        await gitIn(repo, ['add', 'tracked.txt']);
        await writeFile(join(repo, 'tracked.txt'), 'unsaved on disk\n');
        await writeFile(join(repo, 'untracked.txt'), 'keep\n');

        const head = await readFile(join(repo, '.git', 'HEAD'));
        const index = await readFile(join(repo, '.git', 'index'));

        await compareBranches(repo, 'left', 'right', 'merge-base');
        await compareBranches(repo, 'left', 'right', 'tips');

        expect(await readFile(join(repo, '.git', 'HEAD'))).toEqual(head);
        expect(await readFile(join(repo, '.git', 'index'))).toEqual(index);
        expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('unsaved on disk\n');
        expect(await readFile(join(repo, 'untracked.txt'), 'utf8')).toBe('keep\n');
    });

    test('reads from the merge base by default and from the tips on request', async () => {
        const merged = await compareBranches(repo, 'left', 'right', 'merge-base');
        const main = (await gitIn(repo, ['rev-parse', 'main'])).trim();

        expect(merged.baseCommit).toBe(main);
        expect(merged.diff.files?.some((file) => file.path === 'left.txt')).toBe(false);
        expect(merged.diff.files?.find((file) => file.path === 'tracked.txt')?.diff).toContain('-original');
        expect(merged.right.commits.map((commit) => commit.subject)).toEqual(['right one']);
        expect(merged.left.commits.map((commit) => commit.subject)).toEqual(['left two', 'left one']);

        const tips = await compareBranches(repo, 'left', 'right', 'tips');

        expect(tips.baseCommit).toBe(tips.fromCommit);
        expect(tips.diff.files?.find((file) => file.path === 'left.txt')?.kind).toBe('delete');
        expect(tips.diff.files?.find((file) => file.path === 'tracked.txt')?.diff).toContain('-left');
        expect(tips.left.commits).toHaveLength(2);
        expect(tips.right.commits).toHaveLength(1);
    });

    test('never runs a text conversion or an external diff the repository configures', async () => {
        await compareBranches(repo, 'left', 'right', 'tips');

        await expect(access(join(repo, 'textconv-ran'))).rejects.toThrow();

        // The probe is real: git's own diff runs it.
        await gitIn(repo, ['diff', 'left', 'right', '--', 'tracked.txt']);

        expect(await readFile(join(repo, 'textconv-ran'), 'utf8')).toBe('ran');
    });

    test('keeps reading the commits it pinned after a branch moves, and takes an annotated tag for its commit', async () => {
        const compared = await compareBranches(repo, 'left', 'right-tag', 'tips');

        await gitIn(repo, ['update-ref', 'refs/heads/right', 'main']);

        expect((await readSnapshot(repo, compared.toCommit, 'tracked.txt')).text).toBe('right\n');

        const first = await compareCommits(repo, compared.fromCommit, compared.toCommit, 'left', 0, 1);

        expect(first.commits.map((commit) => commit.subject)).toEqual(['left two']);
        expect(first.next).toBe(1);

        const second = await compareCommits(repo, compared.fromCommit, compared.toCommit, 'left', first.next!, 1);

        expect(second.commits.map((commit) => commit.subject)).toEqual(['left one']);
        expect(second.next).toBeNull();
        expect((await compareCommits(repo, compared.fromCommit, compared.toCommit, 'right', 0, 10)).commits[0]?.subject).toBe('right one');
    });

    test('tells apart unusual names, binary, oversized, symlink, submodule, folder and missing entries', async () => {
        const { toCommit } = await compareBranches(repo, 'main', 'right', 'tips');
        const names = [WEIRD, 'line\nbreak.txt', '-option.txt', 'binary.bin', 'large.txt', 'link.txt', 'vendor', 'folder', 'missing.txt'];
        const blobs = await Promise.all(names.map((path) => readSnapshot(repo, toCommit, path)));

        expect(blobs.map((blob) => blob.omitted ?? blob.text)).toEqual([
            'literal\n',
            'newline path\n',
            'option path\n',
            'binary',
            'too-large',
            '/outside/the/repository',
            'gitlink',
            'not-file',
            'missing'
        ]);
        expect(blobs[5]?.symlink).toBe(true);
        expect((await readSnapshot(repo, toCommit, 'folder/inner.txt')).text).toBe('inner file\n');
        expect((await compareBranches(repo, 'main', 'right', 'tips')).diff.files?.find((file) => file.path === 'binary.bin')?.omitted).toBe('binary');
    });

    test('refuses a path that leaves the tree or names no single entry', async () => {
        const { toCommit } = await compareBranches(repo, 'main', 'right', 'tips');

        for (const path of ['../tracked.txt', '/tracked.txt', 'folder/', './tracked.txt', 'folder//inner.txt', 'folder/./inner.txt']) {
            await expect(readSnapshot(repo, toCommit, path)).rejects.toThrow('inside the commit');
        }
    });

    test('answers an equal pair with no files and no commits', async () => {
        const result = await compareBranches(repo, 'right', 'right', 'merge-base');

        expect(result.diff.files).toEqual([]);
        expect(result.left).toEqual({ commits: [], next: null });
        expect(result.right).toEqual({ commits: [], next: null });
    });

    test('refuses a missing ref, and never reads a ref that looks like an option', async () => {
        await expect(compareBranches(repo, 'missing', 'right', 'tips')).rejects.toThrow('does not name a commit');
        await expect(compareBranches(repo, '--output=oops', 'right', 'tips')).rejects.toThrow('does not name a commit');
        await expect(access(join(repo, 'oops'))).rejects.toThrow();
    });

    test('refuses the merge base of unrelated histories and compares their tips', async () => {
        const tree = (await gitIn(repo, ['rev-parse', 'main^{tree}'])).trim();
        const orphan = (await gitIn(repo, ['commit-tree', tree, '-m', 'orphan'])).trim();

        await expect(compareBranches(repo, 'right', orphan, 'merge-base')).rejects.toThrow('no common ancestor');
        expect((await compareBranches(repo, 'right', orphan, 'tips')).toCommit).toBe(orphan);
    });

    test('refuses to pick one of several merge bases, while the tips stay unambiguous', async () => {
        const tree = (await gitIn(repo, ['rev-parse', 'main^{tree}'])).trim();
        const left = (await gitIn(repo, ['rev-parse', 'left'])).trim();
        const right = (await gitIn(repo, ['rev-parse', 'right'])).trim();
        const crossA = (await gitIn(repo, ['commit-tree', tree, '-p', left, '-p', right, '-m', 'cross a'])).trim();
        const crossB = (await gitIn(repo, ['commit-tree', tree, '-p', right, '-p', left, '-m', 'cross b'])).trim();

        await expect(compareBranches(repo, crossA, crossB, 'merge-base')).rejects.toThrow('more than one merge base');
        expect((await compareBranches(repo, crossA, crossB, 'tips')).diff.files).toEqual([]);
    });

    test('leaves out the paths the machine keeps its own state in', async () => {
        const open = await compareBranches(repo, 'main', 'right', 'tips');
        const shielded = await compareBranches(repo, 'main', 'right', 'tips', async () => ['folder']);

        expect(open.diff.files?.some((file) => file.path === 'folder/inner.txt')).toBe(true);
        expect(shielded.diff.files?.some((file) => file.path === 'folder/inner.txt')).toBe(false);
    });
});

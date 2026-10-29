import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diffTrees } from './diff.ts';
import { gitIn, initRepo, repoTemplate, type RepoTemplate } from './test-repo.ts';

const NAMES = ['a.txt', 'b.txt', 'tab\tname.txt', 'line\nname.txt', 'café.txt'];

let template: RepoTemplate;
let root: string;
let repo: string;

beforeAll(async () => {
    template = await repoTemplate('ruimte-tree-diff', (dir) => initRepo(join(dir, 'repo'), Object.fromEntries(NAMES.map((name) => [name, 'old\n']))));
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

test('one patch process reads a multi-file tree diff and preserves patches for quoted paths', async () => {
    await Promise.all(NAMES.map((name, index) => writeFile(join(repo, name), `new ${index}\n`)));
    await gitIn(repo, ['add', '.']);
    const tree = (await gitIn(repo, ['write-tree'])).trim();
    const spawned = spyOn(Bun, 'spawn');
    let diff: Awaited<ReturnType<typeof diffTrees>>;

    try {
        diff = await diffTrees(repo, 'HEAD', tree);
        const patches = spawned.mock.calls.filter(
            ([command]) =>
                Array.isArray(command) &&
                command[0] === 'git' &&
                command.includes('diff') &&
                !command.includes('--numstat') &&
                !command.includes('--name-status')
        );
        expect(patches).toHaveLength(1);
    } finally {
        spawned.mockRestore();
    }

    expect(diff?.files).toHaveLength(NAMES.length);

    for (const name of NAMES) {
        const expected = await gitIn(repo, ['diff', '--no-color', '--no-ext-diff', '--no-renames', 'HEAD', tree, '--', `:(literal)${name}`]);
        expect(diff?.files.find((file) => file.path === name)).toMatchObject({ path: name, kind: 'update', added: 1, deleted: 1, diff: expected });
    }
});

test('binary, mode-only, oversized and later small files keep their omission and budget behavior', async () => {
    await writeFile(join(repo, 'a.txt'), 'x'.repeat(4096));
    await writeFile(join(repo, 'binary.bin'), new Uint8Array([0, 1, 2]));
    await writeFile(join(repo, 'café.txt'), 'later\n');
    await gitIn(repo, ['add', '.']);
    await gitIn(repo, ['update-index', '--chmod=+x', 'b.txt']);
    const tree = (await gitIn(repo, ['write-tree'])).trim();
    const diff = await diffTrees(repo, 'HEAD', tree, '', { files: 100, fileLines: 100, fileBytes: 512, totalBytes: 1024 });
    const files = new Map(diff?.files.map((file) => [file.path, file]));
    expect(files.get('a.txt')).toMatchObject({ omitted: 'too-large', diff: '' });
    expect(files.get('binary.bin')).toMatchObject({ omitted: 'binary', diff: '' });
    expect(files.get('b.txt')?.diff).toContain('new mode 100755');
    expect(files.get('café.txt')?.diff).toContain('+later');
});

test('custom patch prefixes and output indicators cannot turn file content into a patch boundary', async () => {
    await gitIn(repo, ['config', '--local', 'diff.outputIndicatorNew', 'd']);
    await gitIn(repo, ['config', '--local', 'diff.outputIndicatorOld', 'd']);
    await writeFile(join(repo, 'a.txt'), 'iff --git a/fake b/fake\n');
    await writeFile(join(repo, 'b.txt'), 'second\n');
    await gitIn(repo, ['add', '.']);
    const tree = (await gitIn(repo, ['write-tree'])).trim();
    const diff = await diffTrees(repo, 'HEAD', tree);
    expect(diff?.files.find((file) => file.path === 'a.txt')?.diff).toContain('+iff --git a/fake b/fake');
    expect(diff?.files.find((file) => file.path === 'b.txt')?.diff).toContain('+second');
});

test('long path lists use bounded argument batches and share one total patch budget', async () => {
    const names = Array.from({ length: 450 }, (_, index) => `file-${String(index).padStart(4, '0')}-${'x'.repeat(130)}.txt`);
    await Promise.all(names.map((name) => writeFile(join(repo, name), 'new\n')));
    await gitIn(repo, ['add', '.']);
    const tree = (await gitIn(repo, ['write-tree'])).trim();
    const spawned = spyOn(Bun, 'spawn');
    let diff: Awaited<ReturnType<typeof diffTrees>>;

    try {
        diff = await diffTrees(repo, 'HEAD', tree, '', { files: 1000, fileLines: 100, fileBytes: 2048, totalBytes: 6000 });
        const patches = spawned.mock.calls.filter(
            ([command]) =>
                Array.isArray(command) &&
                command[0] === 'git' &&
                command.includes('diff') &&
                !command.includes('--numstat') &&
                !command.includes('--name-status')
        );
        expect(patches).toHaveLength(2);
    } finally {
        spawned.mockRestore();
    }

    expect(diff?.files).toHaveLength(names.length);
    expect(diff?.files.reduce((bytes, file) => bytes + file.diff.length, 0)).toBeLessThanOrEqual(6000);
    expect(diff?.files[0]?.diff).toContain('+new');
    expect(diff?.files.at(-1)?.omitted).toBe('too-large');
});

test('a type change keeps both patch segments without omitting a neighboring text file', async () => {
    const target = (await gitIn(repo, ['hash-object', 'b.txt'])).trim();
    await gitIn(repo, ['update-index', '--cacheinfo', `120000,${target},a.txt`]);
    await writeFile(join(repo, 'b.txt'), 'changed\n');
    await gitIn(repo, ['add', 'b.txt']);
    const tree = (await gitIn(repo, ['write-tree'])).trim();
    const diff = await diffTrees(repo, 'HEAD', tree);
    const expected = await gitIn(repo, ['diff', '--no-color', '--no-ext-diff', '--no-renames', 'HEAD', tree, '--', ':(literal)a.txt']);
    expect(diff?.files.find((file) => file.path === 'a.txt')?.diff).toBe(expected);
    expect(diff?.files.find((file) => file.path === 'b.txt')?.diff).toContain('+changed');

    const capped = await diffTrees(repo, 'HEAD', tree, '', { files: 100, fileLines: 100, fileBytes: expected.length - 1, totalBytes: expected.length - 1 });
    expect(capped?.files.find((file) => file.path === 'a.txt')).toMatchObject({ omitted: 'too-large', diff: '' });
    expect(capped?.files.find((file) => file.path === 'b.txt')?.diff).toContain('+changed');
});

test('a file replaced by a directory with an omitted child does not hide neighboring patches', async () => {
    await rm(join(repo, 'a.txt'));
    await mkdir(join(repo, 'a.txt'));
    await writeFile(join(repo, 'a.txt', 'binary.bin'), new Uint8Array([0, 1, 2]));
    await writeFile(join(repo, 'b.txt'), 'changed\n');
    await gitIn(repo, ['add', '-A']);
    const tree = (await gitIn(repo, ['write-tree'])).trim();
    const diff = await diffTrees(repo, 'HEAD', tree);
    expect(diff?.files.find((file) => file.path === 'a.txt')?.diff).toContain('deleted file mode');
    expect(diff?.files.find((file) => file.path === 'a.txt/binary.bin')).toMatchObject({ omitted: 'binary', diff: '' });
    expect(diff?.files.find((file) => file.path === 'b.txt')?.diff).toContain('+changed');
});

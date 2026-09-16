import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Checkpoints } from './checkpoints.ts';

const git = async (args: string[], cwd: string): Promise<void> => {
    const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) {
        throw new Error(`git ${args.join(' ')}: ${stderr}`);
    }
};

const status = async (cwd: string): Promise<string> => {
    const proc = Bun.spawn(['git', 'status', '--porcelain'], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return stdout;
};

let home: string;
let repo: string;
let plain: string;
let checkpoints: Checkpoints;

beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-checkpoint-home-'));
    repo = await mkdtemp(join(tmpdir(), 'ruimte-checkpoint-repo-'));
    plain = await mkdtemp(join(tmpdir(), 'ruimte-checkpoint-plain-'));
    checkpoints = new Checkpoints(home);
    await git(['init', '-q'], repo);
    await git(['config', 'user.email', 'test@example.com'], repo);
    await git(['config', 'user.name', 'Test'], repo);
    await git(['config', 'commit.gpgsign', 'false'], repo);
    await writeFile(join(repo, '.gitignore'), 'ignored.txt\n');
    await writeFile(join(repo, 'kept.txt'), 'one\ntwo\nthree\n');
    await writeFile(join(repo, 'gone.txt'), 'bye\n');
    await git(['add', '-A'], repo);
    await git(['commit', '-q', '-m', 'init'], repo);
});

afterAll(async () => {
    await Promise.all([rm(home, { recursive: true, force: true }), rm(repo, { recursive: true, force: true }), rm(plain, { recursive: true, force: true })]);
});

describe('Checkpoints', () => {
    test('a folder outside a repository has no checkpoint', async () => {
        expect(await checkpoints.take(plain)).toBeNull();
        expect(await checkpoints.diff(plain, '0'.repeat(40))).toBeNull();
    });

    test('takes a tree without touching the index of the person', async () => {
        await writeFile(join(repo, 'staged-nothing.txt'), 'x\n');
        const tree = await checkpoints.take(repo);
        expect(tree).toMatch(/^[0-9a-f]{40}$/);
        // The file is still untracked as far as the repository itself knows.
        expect(await status(repo)).toContain('?? staged-nothing.txt');
        await rm(join(repo, 'staged-nothing.txt'));
    });

    test('diffs the working tree against the checkpoint, ignoring what git ignores', async () => {
        const tree = await checkpoints.take(repo);
        expect(tree).not.toBeNull();
        await writeFile(join(repo, 'kept.txt'), 'one\ntwo changed\nthree\n');
        await mkdir(join(repo, 'nested'), { recursive: true });
        await writeFile(join(repo, 'nested', 'fresh.txt'), 'new\nfile\n');
        await writeFile(join(repo, 'ignored.txt'), 'never seen\n');
        await rm(join(repo, 'gone.txt'));

        const diff = await checkpoints.diff(repo, tree!);
        expect(diff).not.toBeNull();
        expect(diff!.truncated).toBe(false);
        const byPath = new Map(diff!.files.map((file) => [file.path, file]));
        expect([...byPath.keys()].sort()).toEqual(['gone.txt', 'kept.txt', 'nested/fresh.txt']);
        expect(byPath.get('kept.txt')).toMatchObject({ kind: 'update', added: 1, deleted: 1 });
        expect(byPath.get('kept.txt')?.diff).toContain('+two changed');
        expect(byPath.get('nested/fresh.txt')).toMatchObject({ kind: 'add', added: 2, deleted: 0 });
        expect(byPath.get('gone.txt')).toMatchObject({ kind: 'delete', added: 0, deleted: 1 });
    });

    test('a binary file is listed without a diff body', async () => {
        const tree = await checkpoints.take(repo);
        await writeFile(join(repo, 'blob.bin'), Buffer.from([0, 1, 2, 0, 3, 4]));
        const diff = await checkpoints.diff(repo, tree!);
        const blob = diff?.files.find((file) => file.path === 'blob.bin');
        expect(blob).toMatchObject({ kind: 'add', omitted: 'binary', diff: '' });
        await rm(join(repo, 'blob.bin'));
    });

    test('a patch over the cap is listed without a diff body', async () => {
        const tree = await checkpoints.take(repo);
        await writeFile(join(repo, 'huge.txt'), `${Array.from({ length: 2500 }, (_, i) => `line ${i}`).join('\n')}\n`);
        const diff = await checkpoints.diff(repo, tree!);
        const huge = diff?.files.find((file) => file.path === 'huge.txt');
        expect(huge).toMatchObject({ added: 2500, omitted: 'too-large', diff: '' });
        await rm(join(repo, 'huge.txt'));
    });

    test('more changed files than the cap answer a truncated list', async () => {
        const tree = await checkpoints.take(repo);
        const many = join(repo, 'many');
        await mkdir(many, { recursive: true });
        // Binary content keeps the test cheap: the cap is about the list, and a binary file needs no patch.
        await Promise.all(Array.from({ length: 101 }, (_, i) => writeFile(join(many, `file-${i}.bin`), Buffer.from([0, i]))));
        const diff = await checkpoints.diff(repo, tree!);
        expect(diff?.files).toHaveLength(100);
        expect(diff?.truncated).toBe(true);
        await rm(many, { recursive: true, force: true });
    });

    test('a chat in a subfolder answers only for what changed under it', async () => {
        const inner = join(repo, 'inner');
        await mkdir(inner, { recursive: true });
        const tree = await checkpoints.take(inner);
        await writeFile(join(inner, 'mine.txt'), 'mine\n');
        // The person's own edit beside it, which the card of that chat must not claim.
        await writeFile(join(repo, 'kept.txt'), 'one\ntwo\nthree\nfour\n');
        const diff = await checkpoints.diff(inner, tree!);
        expect(diff?.files.map((file) => file.path)).toEqual(['inner/mine.txt']);
        expect((await checkpoints.diff(repo, tree!))?.files.map((file) => file.path).sort()).toEqual(['inner/mine.txt', 'kept.txt']);
        await rm(inner, { recursive: true, force: true });
        await git(['checkout', '--', 'kept.txt'], repo);
    });

    test('a diff of two checkpoints of the same tree is empty', async () => {
        const tree = await checkpoints.take(repo);
        const diff = await checkpoints.diff(repo, tree!);
        expect(diff).toEqual({ files: [], truncated: false });
    });
});

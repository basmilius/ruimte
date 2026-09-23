import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FS_READ_MAX_TEXT_BYTES } from '@ruimte/contracts';
import { readFile as readForViewer } from './read.ts';
import { writeTextFile, type WriteBoundary } from './write.ts';

let root: string;
let project: string;
let outside: string;
let worktreesRoot: string;

const boundary = (worktrees: string[] = []): WriteBoundary => ({
    folders: [project],
    worktreesOf: async () => worktrees,
    worktreesRoot
});

const put = async (path: string, content: string | Buffer): Promise<{ path: string; mtime: number }> => {
    await writeFile(path, content);
    return { path, mtime: Math.round((await stat(path)).mtimeMs) };
};

/* The code a failed write carries, which is what the wire hands the client. */
const codeOf = async (work: Promise<unknown>): Promise<string | undefined> => {
    try {
        await work;
        return undefined;
    } catch (e) {
        return (e as { code?: string }).code;
    }
};

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-fs-write-'));
    project = join(root, 'project');
    outside = join(root, 'outside');
    worktreesRoot = join(root, 'home', 'worktrees');
    await Promise.all([mkdir(join(project, 'src'), { recursive: true }), mkdir(outside), mkdir(worktreesRoot, { recursive: true })]);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('fs.write', () => {
    test('writes over the mtime a read handed out and answers the new mtime and size', async () => {
        const { path } = await put(join(project, 'src', 'main.ts'), 'const a = 1;\n');
        const read = await readForViewer(path);
        if (read.kind !== 'text') {
            throw new Error('expected text');
        }

        const result = await writeTextFile(path, 'const café = 2;\n', read.mtime, boundary());

        expect(await readFile(path, 'utf8')).toBe('const café = 2;\n');
        const after = await stat(path);
        expect(result).toEqual({ size: 17, mtime: Math.round(after.mtimeMs) });
    });

    test('keeps the inode, the mode and every hard link', async () => {
        const { path, mtime } = await put(join(project, 'script.sh'), 'echo one and a longer tail\n');
        await chmod(path, 0o754);
        const twin = join(project, 'twin.sh');
        await link(path, twin);
        const before = await stat(path);

        await writeTextFile(path, 'echo two\n', mtime, boundary());

        const after = await stat(path);
        expect(after.ino).toBe(before.ino);
        expect(after.mode & 0o777).toBe(0o754);
        expect(await readFile(twin, 'utf8')).toBe('echo two\n');
    });

    test('refuses a file that moved since it was read', async () => {
        const { path, mtime } = await put(join(project, 'notes.md'), 'first\n');

        expect(await codeOf(writeTextFile(path, 'mine\n', mtime - 1000, boundary()))).toBe('stale');
        expect(await readFile(path, 'utf8')).toBe('first\n');
    });

    test('refuses a path outside every project folder and its worktrees', async () => {
        const { path, mtime } = await put(join(outside, 'secret.txt'), 'theirs\n');

        expect(await codeOf(writeTextFile(path, 'mine\n', mtime, boundary()))).toBe('outside-project');
        expect(await codeOf(writeTextFile(join(project, '..', 'outside', 'secret.txt'), 'mine\n', mtime, boundary()))).toBe('outside-project');
        expect(await readFile(path, 'utf8')).toBe('theirs\n');
    });

    test('refuses a file reached through a symlinked folder that leads out of the project', async () => {
        const { mtime } = await put(join(outside, 'secret.txt'), 'theirs\n');
        await symlink(outside, join(project, 'escape'));

        expect(await codeOf(writeTextFile(join(project, 'escape', 'secret.txt'), 'mine\n', mtime, boundary()))).toBe('outside-project');
        expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('theirs\n');
    });

    test('writes in a worktree under the worktrees folder, and only there', async () => {
        const worktree = join(worktreesRoot, 'project-1234', 'feature');
        await mkdir(worktree, { recursive: true });
        const inside = await put(join(worktree, 'a.ts'), 'one\n');
        const elsewhere = await put(join(outside, 'b.ts'), 'one\n');

        await writeTextFile(inside.path, 'two\n', inside.mtime, boundary([worktree, outside]));

        expect(await readFile(inside.path, 'utf8')).toBe('two\n');
        expect(await codeOf(writeTextFile(elsewhere.path, 'two\n', elsewhere.mtime, boundary([worktree, outside])))).toBe('outside-project');
    });

    test('never writes over a file the sniff calls binary', async () => {
        const { path, mtime } = await put(join(project, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));

        expect(await codeOf(writeTextFile(path, 'text\n', mtime, boundary()))).toBe('not-text');
        expect((await readFile(path))[0]).toBe(0x89);
    });

    test('refuses text over the cap in UTF-8 bytes, not in characters', async () => {
        const { path, mtime } = await put(join(project, 'big.txt'), 'small\n');
        // Two bytes each in UTF-8, so this is under the cap in characters and over it in bytes.
        const text = 'é'.repeat(FS_READ_MAX_TEXT_BYTES / 2 + 1);

        expect(await codeOf(writeTextFile(path, text, mtime, boundary()))).toBe('too-large');
        expect(await readFile(path, 'utf8')).toBe('small\n');
    });

    test('refuses a symlink, even one inside the project', async () => {
        const { path, mtime } = await put(join(project, 'real.txt'), 'real\n');
        const alias = join(project, 'alias.txt');
        await symlink(path, alias);

        expect(await codeOf(writeTextFile(alias, 'mine\n', mtime, boundary()))).toBe('not-a-file');
        expect(await readFile(path, 'utf8')).toBe('real\n');
    });

    test('answers the read codes for what is not there, not a file or not absolute', async () => {
        expect(await codeOf(writeTextFile(join(project, 'missing.txt'), 'x\n', 0, boundary()))).toBe('not-found');
        expect(await codeOf(writeTextFile(join(project, 'src'), 'x\n', 0, boundary()))).toBe('not-a-file');
        expect(await codeOf(writeTextFile('src/main.ts', 'x\n', 0, boundary()))).toBe('bad-path');
    });

    test('refuses the state Ruimte keeps in a project, however the path reaches it', async () => {
        await mkdir(join(project, '.ruimte', 'private'), { recursive: true });
        const shared = await put(join(project, '.ruimte', 'project.json'), '{}\n');
        const personal = await put(join(project, '.ruimte', 'private', 'project.json'), '{}\n');
        await symlink(join(project, '.ruimte'), join(project, 'state'));

        expect(await codeOf(writeTextFile(shared.path, '[]\n', shared.mtime, boundary()))).toBe('ruimte-state');
        expect(await codeOf(writeTextFile(personal.path, '[]\n', personal.mtime, boundary()))).toBe('ruimte-state');
        expect(await codeOf(writeTextFile(join(project, 'src', '..', '.ruimte', 'project.json'), '[]\n', shared.mtime, boundary()))).toBe('ruimte-state');
        expect(await codeOf(writeTextFile(join(project, 'state', 'private', 'project.json'), '[]\n', personal.mtime, boundary()))).toBe('ruimte-state');
        expect(await readFile(shared.path, 'utf8')).toBe('{}\n');
        expect(await readFile(personal.path, 'utf8')).toBe('{}\n');
    });

    test('lets nobody write when the client holds no project', async () => {
        const { path, mtime } = await put(join(project, 'a.txt'), 'one\n');

        expect(await codeOf(writeTextFile(path, 'two\n', mtime, { ...boundary(), folders: [] }))).toBe('outside-project');
    });
});

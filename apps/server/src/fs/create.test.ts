import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FS_READ_MAX_TEXT_BYTES } from '@ruimte/contracts';
import { createEntry, planCreate } from './create.ts';
import { codeOf, projectBoundary } from './test-boundary.ts';
import type { WriteBoundary } from './write.ts';

let root: string;
let project: string;
let outside: string;

function boundary(): WriteBoundary {
    return projectBoundary(root, project);
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-fs-create-')));
    project = join(root, 'project');
    outside = join(root, 'outside');
    await Promise.all([mkdir(join(project, 'src'), { recursive: true }), mkdir(outside)]);
    await Promise.all([mkdir(join(project, '.git')), mkdir(join(project, '.ruimte'))]);
    await writeFile(join(project, 'src', 'a.ts'), 'a');
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('fs.create', () => {
    test('creates an empty file and answers its size and mtime', async () => {
        const path = join(project, 'src', 'b.ts');

        const result = await createEntry({ path, kind: 'file' }, boundary());

        expect(await readFile(path, 'utf8')).toBe('');
        expect(result).toEqual({ size: 0, mtime: Math.round((await stat(path)).mtimeMs) });
    });

    test('starts a file with the text it was given', async () => {
        const path = join(project, 'notes.md');

        const result = await createEntry({ path, kind: 'file', text: '# café\n' }, boundary());

        expect(await readFile(path, 'utf8')).toBe('# café\n');
        expect(result.size).toBe(Buffer.byteLength('# café\n'));
    });

    test('creates a folder', async () => {
        const path = join(project, 'lib');

        await createEntry({ path, kind: 'directory' }, boundary());

        expect((await stat(path)).isDirectory()).toBe(true);
    });

    test('creates the folders above that are missing', async () => {
        await createEntry({ path: join(project, 'a', 'b', 'c.txt'), kind: 'file' }, boundary());
        await createEntry({ path: join(project, 'x', 'y'), kind: 'directory' }, boundary());

        expect((await stat(join(project, 'a', 'b', 'c.txt'))).isFile()).toBe(true);
        expect((await stat(join(project, 'x', 'y'))).isDirectory()).toBe(true);
    });

    test('refuses a name that is there and leaves it alone', async () => {
        const path = join(project, 'src', 'a.ts');

        expect(await codeOf(createEntry({ path, kind: 'file', text: 'new' }, boundary()))).toBe('exists');
        expect(await codeOf(createEntry({ path: join(project, 'src'), kind: 'directory' }, boundary()))).toBe('exists');
        expect(await codeOf(createEntry({ path: join(project, 'src'), kind: 'file' }, boundary()))).toBe('exists');
        expect(await readFile(path, 'utf8')).toBe('a');
    });

    test('refuses a link that leads nowhere as a name that is taken', async () => {
        await symlink(join(outside, 'nope'), join(project, 'dangling'));

        expect(await codeOf(createEntry({ path: join(project, 'dangling'), kind: 'file' }, boundary()))).toBe('exists');
    });

    test('refuses a folder that would sit below a file', async () => {
        expect(await codeOf(createEntry({ path: join(project, 'src', 'a.ts', 'b'), kind: 'file' }, boundary()))).toBe('not-a-directory');
    });

    test('refuses a path outside the projects open', async () => {
        expect(await codeOf(createEntry({ path: join(outside, 'b.txt'), kind: 'file' }, boundary()))).toBe('outside-project');
        expect(await codeOf(createEntry({ path: join(project, '..', 'outside', 'b.txt'), kind: 'file' }, boundary()))).toBe('outside-project');
        expect(await stat(join(outside, 'b.txt')).catch(() => null)).toBeNull();
    });

    test('refuses a path that reaches out of the project through a link, creating nothing', async () => {
        await symlink(outside, join(project, 'out'));

        expect(await codeOf(createEntry({ path: join(project, 'out', 'deep', 'b.txt'), kind: 'file' }, boundary()))).toBe('outside-project');
        expect(await stat(join(outside, 'deep')).catch(() => null)).toBeNull();
    });

    test('refuses .git at any level and .ruimte at the root', async () => {
        await mkdir(join(project, 'vendor', 'lib', '.git'), { recursive: true });

        expect(await codeOf(createEntry({ path: join(project, '.git', 'hooks', 'pre-commit'), kind: 'file' }, boundary()))).toBe('git-state');
        expect(await codeOf(createEntry({ path: join(project, 'vendor', 'lib', '.git', 'x'), kind: 'file' }, boundary()))).toBe('git-state');
        expect(await codeOf(createEntry({ path: join(project, 'new', '.git', 'x'), kind: 'file' }, boundary()))).toBe('git-state');
        expect(await codeOf(createEntry({ path: join(project, '.ruimte', 'project.json'), kind: 'file' }, boundary()))).toBe('ruimte-state');
        expect(await codeOf(createEntry({ path: join(project, '.ruimte', 'sub', 'x'), kind: 'directory' }, boundary()))).toBe('ruimte-state');
        expect(await codeOf(createEntry({ path: join(project, '.ruimte', 'private', 'consoles'), kind: 'directory' }, boundary()))).toBe('ruimte-state');
        expect(await codeOf(createEntry({ path: join(project, '.ruimte', 'designs'), kind: 'directory' }, boundary()))).toBe('ruimte-state');
        expect(await codeOf(createEntry({ path: join(project, '.ruimte', 'private', 'designs'), kind: 'directory' }, boundary()))).toBe('ruimte-state');
    });

    test('creates the pages of a design in its folder, private or shared', async () => {
        for (const folder of [join(project, '.ruimte', 'private', 'designs', 'onboarding'), join(project, '.ruimte', 'designs', 'pricing')]) {
            await createEntry({ path: join(folder, 'assets', 'logo.svg'), kind: 'file', text: '<svg/>' }, boundary());
            expect(await stat(join(folder, 'assets', 'logo.svg')).then((entry) => entry.isFile())).toBe(true);
        }
    });

    test('creates a console in the private state, with the folders it needs', async () => {
        const path = join(project, '.ruimte', 'private', 'consoles', 'shop 1.sql');
        await createEntry({ path, kind: 'file', text: 'SELECT 1;\n' }, boundary());

        expect(await readFile(path, 'utf8')).toBe('SELECT 1;\n');
        expect(await codeOf(createEntry({ path, kind: 'file' }, boundary()))).toBe('exists');
    });

    test('refuses a relative path and a NUL', async () => {
        expect(await codeOf(createEntry({ path: 'src/b.ts', kind: 'file' }, boundary()))).toBe('bad-path');
        expect(await codeOf(createEntry({ path: join(project, 'a\0b'), kind: 'file' }, boundary()))).toBe('bad-path');
    });

    test('refuses a text past the limit', async () => {
        const text = 'x'.repeat(FS_READ_MAX_TEXT_BYTES + 1);

        expect(await codeOf(createEntry({ path: join(project, 'big.txt'), kind: 'file', text }, boundary()))).toBe('too-large');
        expect(await stat(join(project, 'big.txt')).catch(() => null)).toBeNull();
    });

    test('replaces the text of a file that is there when asked to overwrite', async () => {
        const path = join(project, 'src', 'a.ts');

        const result = await createEntry({ path, kind: 'file', text: 'longer text', overwrite: true }, boundary());

        expect(await readFile(path, 'utf8')).toBe('longer text');
        expect(result.size).toBe(11);
    });

    test('makes a file with the permission bits it was given, also over a file that others could read', async () => {
        const fresh = join(project, '.env');
        await createEntry({ path: fresh, kind: 'file', text: 'KEY=1\n', mode: 0o600 }, boundary());
        expect((await stat(fresh)).mode & 0o777).toBe(0o600);

        const taken = join(project, '.env.local');
        await writeFile(taken, 'old', { mode: 0o644 });
        await createEntry({ path: taken, kind: 'file', text: 'KEY=2\n', overwrite: true, mode: 0o600 }, boundary());
        expect((await stat(taken)).mode & 0o777).toBe(0o600);
        expect(await readFile(taken, 'utf8')).toBe('KEY=2\n');

        const script = join(project, 'run.sh');
        await createEntry({ path: script, kind: 'file', text: '#!/bin/sh\n', mode: 0o755 }, boundary());
        expect((await stat(script)).mode & 0o777).toBe(0o755);
    });

    test('shortens a file it overwrites', async () => {
        const path = join(project, 'src', 'a.ts');
        await writeFile(path, 'a long old text');

        await createEntry({ path, kind: 'file', text: 'new', overwrite: true }, boundary());

        expect(await readFile(path, 'utf8')).toBe('new');
    });

    test('still refuses a file over a folder, a folder over a file and a link, also with overwrite', async () => {
        await symlink(join(project, 'src', 'a.ts'), join(project, 'link.ts'));

        expect(await codeOf(createEntry({ path: join(project, 'src'), kind: 'file', text: 'x', overwrite: true }, boundary()))).toBe('exists');
        expect(await codeOf(createEntry({ path: join(project, 'src', 'a.ts'), kind: 'directory', overwrite: true }, boundary()))).toBe('exists');
        expect(await codeOf(createEntry({ path: join(project, 'link.ts'), kind: 'file', text: 'x', overwrite: true }, boundary()))).toBe('exists');
        expect(await readFile(join(project, 'src', 'a.ts'), 'utf8')).toBe('a');
    });

    test('keeps the boundary when overwriting', async () => {
        await writeFile(join(outside, 'c.txt'), 'c');

        expect(await codeOf(createEntry({ path: join(outside, 'c.txt'), kind: 'file', text: 'x', overwrite: true }, boundary()))).toBe('outside-project');
        expect(await readFile(join(outside, 'c.txt'), 'utf8')).toBe('c');
    });

    for (const [platform, noFollow] of [
        ['with O_NOFOLLOW', undefined],
        ['without O_NOFOLLOW, as on Windows', 0]
    ] as const) {
        test(`never follows a link put in place of a file it plans to replace, ${platform}`, async () => {
            const path = join(project, 'src', 'a.ts');
            await writeFile(join(outside, 'c.txt'), 'c');
            const plan = await planCreate({ path, kind: 'file', text: 'x', overwrite: true }, boundary(), noFollow);
            await rm(path);
            await symlink(join(outside, 'c.txt'), path);

            expect(await codeOf(plan.run())).toBe('exists');
            expect(await readFile(join(outside, 'c.txt'), 'utf8')).toBe('c');
        });
    }

    test('checks everything in a plan before it makes anything', async () => {
        const plan = await planCreate({ path: join(project, 'deep', 'new.ts'), kind: 'file', text: 'x' }, boundary());

        expect(await stat(join(project, 'deep')).catch(() => null)).toBeNull();
        await plan.run();
        expect(await readFile(join(project, 'deep', 'new.ts'), 'utf8')).toBe('x');
    });
});

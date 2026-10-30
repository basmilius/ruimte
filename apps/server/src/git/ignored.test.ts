import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listIgnoredFiles } from './ignored.ts';
import { initRepo } from './test-repo.ts';

let root: string;

beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-ignored-')));
    await mkdir(join(root, 'app'));
    await initRepo(root, { '.gitignore': '.env*\n*.local.json\nnode_modules/\nlink\n', 'app/index.ts': '' });
    await writeFile(join(root, '.env'), 'KEY=1\n', { mode: 0o600 });
    await writeFile(join(root, '.env.local'), 'KEY=2\n', { mode: 0o644 });
    await mkdir(join(root, 'app', 'config'), { recursive: true });
    await writeFile(join(root, 'app', 'config', 'dev.local.json'), '{}', { mode: 0o644 });
    await mkdir(join(root, 'app', 'config', 'node_modules', 'x'), { recursive: true });
    await writeFile(join(root, 'app', 'config', 'node_modules', 'x', 'index.js'), '');
    await mkdir(join(root, 'app', 'config', 'deeper'), { recursive: true });
    await writeFile(join(root, 'app', 'config', 'deeper', 'keys.local.json'), '{}', { mode: 0o644 });
    await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), '');
    await writeFile(join(root, 'untracked.ts'), '');
    await symlink('/etc/hosts', join(root, 'link'));
    await mkdir(join(root, '.ruimte', 'private'), { recursive: true });
    await writeFile(join(root, '.ruimte', 'private', '.gitignore'), '*\n');
    await writeFile(join(root, '.ruimte', 'private', 'project.json'), '{}');
}, 30_000);

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

// Windows keeps only whether a file is read-only.
const modeOf = (bits: number): number => (process.platform === 'win32' ? 0o666 : bits);

describe('the ignored files of a checkout', () => {
    test('lists the files git ignores, leaves out folders ignored whole and untracked files, and marks links', async () => {
        const listed = await listIgnoredFiles(root);
        expect(listed.root).toBe(root);
        expect(listed.prefix).toBe('');
        expect(listed.truncated).toBe(false);
        expect(listed.files.sort((left, right) => left.path.localeCompare(right.path))).toEqual([
            { path: '.env', size: 6, link: false, mode: modeOf(0o600) },
            { path: '.env.local', size: 6, link: false, mode: modeOf(0o644) },
            { path: 'app/config/deeper/keys.local.json', size: 2, link: false, mode: modeOf(0o644) },
            { path: 'app/config/dev.local.json', size: 2, link: false, mode: modeOf(0o644) },
            { path: 'link', size: expect.any(Number), link: true }
        ]);
    });

    test('from a folder inside the checkout the paths stay relative to its top level', async () => {
        const listed = await listIgnoredFiles(join(root, 'app'));
        expect(listed.root).toBe(root);
        expect(listed.prefix).toBe('app');
        expect(listed.files.map((file) => file.path)).toContain('.env');
    });

    test('a folder outside a repository is refused', async () => {
        const outside = await mkdtemp(join(tmpdir(), 'ruimte-ignored-none-'));
        await expect(listIgnoredFiles(outside)).rejects.toMatchObject({ code: 'not-a-repo' });
        await rm(outside, { recursive: true, force: true });
    });
});

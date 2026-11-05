import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRepos } from './repos.ts';
import { gitIn, initRepo } from './test-repo.ts';

// `git submodule` is a shell script, whose start alone can take a slow Windows runner past a unit test's five seconds.
let root: string;

beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-repos-submodule-')));
    await initRepo(join(root, 'origin'), { 'o.txt': 'o\n' });
    await initRepo(join(root, 'parent'), { 'p.txt': 'p\n' });
    await gitIn(join(root, 'parent'), ['-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', join(root, 'origin'), 'backend']);
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

test('the folder itself comes first, then its submodules', async () => {
    const folder = join(root, 'parent');
    const { repos } = await listRepos(folder);
    expect(repos[0]).toEqual({ path: folder, label: 'parent', kind: 'root' });
    expect(repos.find((repo) => repo.label === 'backend')?.kind).toBe('submodule');
});

import { describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Worktree } from '@ruimte/contracts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { checkCwd } from '../tools/project-paths.ts';
import { checkoutHost } from './worktree-host.ts';
import type { Worktrees } from './worktrees.ts';

const newHome = tempHomes('ruimte-worktree-host-');

describe('checkoutHost', () => {
    test('a worktree counts only under the worktree folder or as one the daemon made, never one git lists from a planted path', async () => {
        const root = await newHome();
        const project = join(root, 'repo');
        const underRoot = join(root, 'home', 'worktrees', 'repo-1', 'feature');
        const made = join(root, 'chosen', 'repo-1', 'other');
        const planted = join(root, 'elsewhere');
        await Promise.all([project, underRoot, made, planted].map((folder) => mkdir(folder, { recursive: true })));
        const worktrees = {
            root: join(root, 'home', 'worktrees'),
            list: async () => [project, underRoot, made, planted].map((path) => ({ path }) as Worktree),
            registeredPaths: async () => [underRoot, made]
        } as unknown as Worktrees;
        const host = checkoutHost(worktrees);

        expect(await host.paths(project)).toEqual([underRoot, made]);
        expect(await checkCwd(project, made, host.paths)).toBe(made);
        await expect(checkCwd(project, planted, host.paths)).rejects.toMatchObject({ code: 'cwd-outside-project' });
    });
});

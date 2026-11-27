import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDevicePath, startCwdGuard } from './project-paths.ts';

describe('checkDevicePath', () => {
    let root: string;
    let project: string;
    let outside: string;
    const noWorktrees = (): Promise<string[]> => Promise.resolve([]);

    beforeAll(async () => {
        root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-device-path-')));
        project = join(root, 'project');
        outside = join(root, 'outside');
        await mkdir(join(project, 'Good.app', 'Frameworks'), { recursive: true });
        await mkdir(join(project, 'Leaky.app'), { recursive: true });
        await mkdir(outside);
        await writeFile(join(project, 'clip.mp4'), 'video');
        await writeFile(join(project, 'Good.app', 'Info.plist'), 'plist');
        await writeFile(join(outside, 'secret'), 'secret');
        await symlink('../Info.plist', join(project, 'Good.app', 'Frameworks', 'link'));
        await symlink(join(outside, 'secret'), join(project, 'Leaky.app', 'secret'));
        await symlink(join(project, 'clip.mp4'), join(project, 'alias.mp4'));
    });

    afterAll(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('answers the real path, so a link swapped in later leads nowhere new', async () => {
        expect(await checkDevicePath(project, 'alias.mp4', noWorktrees)).toBe(join(project, 'clip.mp4'));
    });

    test('takes a bundle whose links stay inside and refuses one with a link out of the project', async () => {
        expect(await checkDevicePath(project, 'Good.app', noWorktrees)).toBe(join(project, 'Good.app'));
        await expect(checkDevicePath(project, 'Leaky.app', noWorktrees)).rejects.toMatchObject({ code: 'device-path-refused' });
    });
});

describe('startCwdGuard', () => {
    let root: string;
    let project: string;

    const guard = startCwdGuard({ madeByAgent: (nodeId) => nodeId !== 'person', folderOf: () => project, worktreePaths: async () => [] });

    beforeAll(async () => {
        root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-start-cwd-')));
        project = join(root, 'project');
        await mkdir(join(project, 'src'), { recursive: true });
        await mkdir(join(root, 'outside'));
    });

    afterAll(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('says a folder that is gone is gone, apart from one outside the project', async () => {
        await expect(guard('agent', 'src')).resolves.toBeUndefined();
        await expect(guard('agent', 'removed-worktree')).rejects.toMatchObject({
            code: 'bad-cwd',
            message: `The folder ${join(project, 'removed-worktree')} is gone, so nothing can start in it until it is back or the chat moves to another folder`
        });
        await expect(guard('agent', join(root, 'outside'))).rejects.toMatchObject({ code: 'cwd-outside-project' });
        await expect(guard('person', 'removed-worktree')).resolves.toBeUndefined();
    });
});

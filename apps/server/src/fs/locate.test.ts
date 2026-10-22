import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitReposResult } from '@ruimte/contracts';
import { locateFile, type LocateDeps } from './locate.ts';

let root: string;

async function file(path: string): Promise<void> {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), '');
}

function depsWith(repos: Record<string, string[]>, homes: string[] = []): LocateDeps {
    return {
        repos: async (folder): Promise<GitReposResult> => ({
            repos: (repos[folder] ?? []).map((path) => ({ path, label: path, kind: 'nested' as const })),
            truncated: false
        }),
        policy: { homes }
    };
}

beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'locate-')));
    await file('project/src/own.ts');
    await file('project/lib/src/own.ts');
    await file('project/lib/src/deep.ts');
    await file('project/other/src/deep.ts');
    await mkdir(join(root, 'project/docs'), { recursive: true });
    await file('worktree/README.md');
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('locateFile', () => {
    test("a path in the agent's own folder is the one answer, whatever else holds it", async () => {
        const project = join(root, 'project');
        const result = await locateFile({ path: 'src/own.ts', cwd: project }, depsWith({ [project]: [project, join(project, 'lib')] }));
        expect(result.matches).toEqual([join(project, 'src/own.ts')]);
    });

    test('a path that is not there is looked for in every repository inside, in their order', async () => {
        const project = join(root, 'project');
        const deps = depsWith({ [project]: [project, join(project, 'lib'), join(project, 'other')] });
        expect((await locateFile({ path: 'src/deep.ts', cwd: project }, deps)).matches).toEqual([
            join(project, 'lib/src/deep.ts'),
            join(project, 'other/src/deep.ts')
        ]);
    });

    test("an agent in a worktree finds what only the project's checkout holds", async () => {
        const project = join(root, 'project');
        const worktree = join(root, 'worktree');
        const deps = depsWith({ [worktree]: [worktree], [project]: [project, join(project, 'lib')] });
        expect((await locateFile({ path: 'src/deep.ts', cwd: worktree, folder: project }, deps)).matches).toEqual([join(project, 'lib/src/deep.ts')]);
    });

    test('a folder is found only when the link names one, and a file only when it does not', async () => {
        const project = join(root, 'project');
        const deps = depsWith({});
        expect((await locateFile({ path: 'docs', cwd: project, directory: true }, deps)).matches).toEqual([join(project, 'docs')]);
        expect((await locateFile({ path: 'docs', cwd: project }, deps)).matches).toEqual([]);
    });

    test("an absolute path is only checked, and the machine's own state is never handed out", async () => {
        const deps = depsWith({}, [join(root, 'project')]);
        expect((await locateFile({ path: join(root, 'worktree/README.md'), cwd: root }, deps)).matches).toEqual([join(root, 'worktree/README.md')]);
        expect((await locateFile({ path: join(root, 'project/src/own.ts'), cwd: root }, deps)).matches).toEqual([]);
    });

    test("a link to the machine's own state does not say that state is there", async () => {
        await file('home/local.key');
        await symlink(join(root, 'home/local.key'), join(root, 'worktree/key-link'));
        const deps = depsWith({}, [join(root, 'home')]);
        expect((await locateFile({ path: 'key-link', cwd: join(root, 'worktree') }, deps)).matches).toEqual([]);
        expect((await locateFile({ path: join(root, 'worktree/key-link'), cwd: root }, deps)).matches).toEqual([]);
    });

    describe('by the end of its path', () => {
        // What the listing of the project folder holds; an ignored file would not be in it.
        const listed = ['src/own.ts', 'lib/src/own.ts', 'lib/src/deep.ts', 'other/src/deep.ts', 'worktree-only.ts'];
        const withList = (homes: string[] = []): LocateDeps => ({
            ...depsWith({}, homes),
            list: async (folder) => (folder === join(root, 'project') ? listed : [])
        });

        test('a bare name finds the one file deeper in the tree', async () => {
            const project = join(root, 'project');
            expect((await locateFile({ path: 'own.ts', cwd: join(project, 'docs'), folder: project }, withList())).matches).toEqual([
                join(project, 'src/own.ts'),
                join(project, 'lib/src/own.ts')
            ]);
        });

        test('every file it fits comes back, the shortest first', async () => {
            const project = join(root, 'project');
            expect((await locateFile({ path: 'deep.ts', cwd: project }, withList())).matches).toEqual([
                join(project, 'lib/src/deep.ts'),
                join(project, 'other/src/deep.ts')
            ]);
        });

        test('a path from a folder below the root fits only where its folders match', async () => {
            const project = join(root, 'project');
            expect((await locateFile({ path: 'lib/src/deep.ts', cwd: join(project, 'docs'), folder: project }, withList())).matches).toEqual([
                join(project, 'lib/src/deep.ts')
            ]);
            expect((await locateFile({ path: 'rc/deep.ts', cwd: project }, withList())).matches).toEqual([]);
        });

        test('a file that is listed but gone, or under the machine home, is not handed out', async () => {
            const project = join(root, 'project');
            expect((await locateFile({ path: 'worktree-only.ts', cwd: project }, withList())).matches).toEqual([]);
            expect((await locateFile({ path: 'deep.ts', cwd: project }, withList([join(project, 'lib')]))).matches).toEqual([
                join(project, 'other/src/deep.ts')
            ]);
        });

        test('the own folder and the repositories still answer before the listing is read', async () => {
            const project = join(root, 'project');
            let read = 0;
            const deps: LocateDeps = {
                ...depsWith({ [project]: [project, join(project, 'lib')] }),
                list: async () => {
                    read += 1;
                    return listed;
                }
            };
            expect((await locateFile({ path: 'src/deep.ts', cwd: project }, deps)).matches).toEqual([join(project, 'lib/src/deep.ts')]);
            expect(read).toBe(0);
        });

        test('a folder, a path that climbs out and a caller without a listing do not search', async () => {
            const project = join(root, 'project');
            const anyFolder: LocateDeps = { ...depsWith({}), list: async () => listed };
            expect((await locateFile({ path: 'src', cwd: join(project, 'docs'), directory: true }, anyFolder)).matches).toEqual([]);
            expect((await locateFile({ path: '../src/own.ts', cwd: project }, withList())).matches).toEqual([]);
            expect((await locateFile({ path: 'deep.ts', cwd: project }, depsWith({}))).matches).toEqual([]);
        });
    });

    test('dots in the path name the same file once', async () => {
        const project = join(root, 'project');
        const result = await locateFile({ path: './lib/../src/own.ts', cwd: project }, depsWith({}));
        expect(result.matches).toEqual([join(project, 'src/own.ts')]);
    });
});

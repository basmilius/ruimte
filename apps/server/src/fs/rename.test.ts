import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { link, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileExists } from '@adecore/utils/fs';
import { renameNoReplace } from './no-replace-rename.ts';
import { planRename } from './rename.ts';
import { codeOf, projectBoundary } from './test-boundary.ts';
import type { WriteBoundary } from './write.ts';

let root: string;
let project: string;
let outside: string;

function boundary(): WriteBoundary {
    return projectBoundary(root, project);
}

async function renamePath(path: string, to: string, boundary: WriteBoundary): Promise<void> {
    await (await planRename(path, to, boundary)).run();
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-fs-rename-')));
    project = join(root, 'project');
    outside = join(root, 'outside');
    await mkdir(join(project, 'src'), { recursive: true });
    await Promise.all([mkdir(outside), mkdir(join(project, '.git')), mkdir(join(project, '.ruimte'))]);
    await Promise.all([writeFile(join(project, 'src', 'a.ts'), 'a'), writeFile(join(project, 'src', 'b.ts'), 'b'), writeFile(join(outside, 'c.txt'), 'c')]);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('fs.rename', () => {
    test('renames a file and moves a folder with what is in it', async () => {
        await renamePath(join(project, 'src', 'a.ts'), join(project, 'src', 'z.ts'), boundary());
        expect(await readFile(join(project, 'src', 'z.ts'), 'utf8')).toBe('a');
        await renamePath(join(project, 'src'), join(project, 'lib'), boundary());
        expect(await readFile(join(project, 'lib', 'b.ts'), 'utf8')).toBe('b');
        expect(await fileExists(join(project, 'src'))).toBe(false);
    });

    test('makes the folders above a new place that are missing', async () => {
        await renamePath(join(project, 'src', 'b.ts'), join(project, 'deep', 'er', 'b.ts'), boundary());
        expect(await readFile(join(project, 'deep', 'er', 'b.ts'), 'utf8')).toBe('b');
    });

    test('a taken name is refused before a move is planned', async () => {
        for (const overwrite of [undefined, false]) {
            expect(await codeOf(planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'b.ts'), boundary(), { overwrite }))).toBe('exists');
        }
        expect(await readFile(join(project, 'src', 'b.ts'), 'utf8')).toBe('b');
    });

    test('refuses what is not there, a relative path and a folder moved into itself', async () => {
        expect(await codeOf(renamePath(join(project, 'nope'), join(project, 'x'), boundary()))).toBe('not-found');
        expect(await codeOf(renamePath('src/a.ts', join(project, 'x'), boundary()))).toBe('bad-path');
        expect(await codeOf(renamePath(join(project, 'src'), join(project, 'src', 'inner'), boundary()))).toBe('into-itself');
    });

    test('stays inside the projects open here, and leaves .git and .ruimte closed', async () => {
        expect(await codeOf(renamePath(join(outside, 'c.txt'), join(project, 'c.txt'), boundary()))).toBe('outside-project');
        expect(await codeOf(renamePath(join(project, 'src', 'a.ts'), join(outside, 'a.ts'), boundary()))).toBe('outside-project');
        expect(await codeOf(renamePath(join(project, '.git'), join(project, 'git'), boundary()))).toBe('git-state');
        expect(await codeOf(renamePath(join(project, 'src', 'a.ts'), join(project, '.git', 'a.ts'), boundary()))).toBe('git-state');
        expect(await codeOf(renamePath(join(project, 'src', 'a.ts'), join(project, '.ruimte', 'a.ts'), boundary()))).toBe('ruimte-state');
        expect(await codeOf(renamePath(project, join(project, '..', 'moved'), boundary()))).toBe('outside-project');
    });

    test('moves a console out of the private state and back, since a person owns it', async () => {
        const consoles = join(project, '.ruimte', 'private', 'consoles');
        await renamePath(join(project, 'src', 'a.ts'), join(consoles, 'a.sql'), boundary());
        await renamePath(join(consoles, 'a.sql'), join(project, 'queries', 'a.sql'), boundary());

        expect((await stat(join(project, 'queries', 'a.sql'))).isFile()).toBe(true);
        expect(await codeOf(renamePath(consoles, join(project, 'consoles'), boundary()))).toBe('ruimte-state');
    });

    test('a link out of the project is moved as the link and a target through one is judged on where it lands', async () => {
        await symlink(outside, join(project, 'link'));
        await renamePath(join(project, 'link'), join(project, 'other'), boundary());
        expect((await stat(join(outside, 'c.txt'))).isFile()).toBe(true);
        await symlink(outside, join(project, 'out'));
        expect(await codeOf(renamePath(join(project, 'src', 'a.ts'), join(project, 'out', 'a.ts'), boundary()))).toBe('outside-project');
    });
});

describe('fs.rename when the disk moved after the plan', () => {
    test('never overwrites a file that took the name in between', async () => {
        const plan = await planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'c.ts'), boundary());
        await writeFile(join(project, 'src', 'c.ts'), 'newcomer');

        expect(await codeOf(plan.run())).toBe('exists');

        expect(await readFile(join(project, 'src', 'c.ts'), 'utf8')).toBe('newcomer');
        expect(await readFile(join(project, 'src', 'a.ts'), 'utf8')).toBe('a');
    });

    test('never overwrites a name a file takes in the very moment of the move', async () => {
        const plan = await planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'c.ts'), boundary(), {
            rename: async (from, to) => {
                await writeFile(to, 'newcomer');
                await renameNoReplace(from, to);
            }
        });

        expect(await codeOf(plan.run())).toBe('exists');

        expect(await readFile(join(project, 'src', 'c.ts'), 'utf8')).toBe('newcomer');
        expect(await readFile(join(project, 'src', 'a.ts'), 'utf8')).toBe('a');
    });

    test('never moves a folder over one made in between', async () => {
        const plan = await planRename(join(project, 'src'), join(project, 'lib'), boundary());
        await mkdir(join(project, 'lib'));

        expect(await codeOf(plan.run())).toBe('exists');

        expect(await readdir(join(project, 'lib'))).toEqual([]);
        expect((await readdir(join(project, 'src'))).sort()).toEqual(['a.ts', 'b.ts']);
    });

    test('an overwrite refuses a folder that took the place of the file it was to replace', async () => {
        const plan = await planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'b.ts'), boundary(), {
            overwrite: true,
            trash: async () => undefined
        });
        await rm(join(project, 'src', 'b.ts'));
        await mkdir(join(project, 'src', 'b.ts'));

        expect(await codeOf(plan.run())).toBe('exists');

        expect(await readFile(join(project, 'src', 'a.ts'), 'utf8')).toBe('a');
    });

    test('never moves a folder over one made in the very moment of the move', async () => {
        const plan = await planRename(join(project, 'src'), join(project, 'lib'), boundary(), {
            rename: async (from, to) => {
                await mkdir(to);
                await renameNoReplace(from, to);
            }
        });

        expect(await codeOf(plan.run())).toBe('exists');

        expect(await readdir(join(project, 'lib'))).toEqual([]);
        expect((await readdir(join(project, 'src'))).sort()).toEqual(['a.ts', 'b.ts']);
    });

    test('never moves a link over a file made in the very moment of the move', async () => {
        await symlink(outside, join(project, 'link'));
        const plan = await planRename(join(project, 'link'), join(project, 'other'), boundary(), {
            rename: async (from, to) => {
                await writeFile(to, 'newcomer');
                await renameNoReplace(from, to);
            }
        });

        expect(await codeOf(plan.run())).toBe('exists');

        expect(await readFile(join(project, 'other'), 'utf8')).toBe('newcomer');
    });

    test('changes only the case of a name, through a spare name it leaves nothing of', async () => {
        await renamePath(join(project, 'src', 'a.ts'), join(project, 'src', 'A.ts'), boundary());

        expect((await readdir(join(project, 'src'))).sort()).toEqual(['A.ts', 'b.ts']);
        expect(await readFile(join(project, 'src', 'A.ts'), 'utf8')).toBe('a');
    });

    test('puts a name back when its new case cannot be had', async () => {
        const plan = await planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'A.ts'), boundary(), {
            rename: async (from, to) => {
                if (to.endsWith('A.ts')) {
                    throw Object.assign(new Error('busy'), { code: 'EBUSY' });
                }
                await renameNoReplace(from, to);
            }
        });

        expect(await codeOf(plan.run())).toBe('EBUSY');

        expect(await readdir(join(project, 'src'))).toContain('a.ts');
        expect((await readdir(join(project, 'src'))).some((name) => name.startsWith('.ruimte-rename-'))).toBe(false);
    });

    test('never folds one hard link of a file into another', async () => {
        await rm(join(project, 'src', 'b.ts'));
        await link(join(project, 'src', 'a.ts'), join(project, 'src', 'b.ts'));

        expect(await codeOf(renamePath(join(project, 'src', 'a.ts'), join(project, 'src', 'b.ts'), boundary()))).toBe('exists');

        expect((await readdir(join(project, 'src'))).sort()).toEqual(['a.ts', 'b.ts']);
    });

    test('fails closed where a volume cannot refuse a taken name', async () => {
        const unsupported = async (): Promise<void> => {
            throw Object.assign(new Error('not supported'), { code: 'ENOTSUP' });
        };
        const plan = await planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'c.ts'), boundary(), { rename: unsupported });

        expect(await codeOf(plan.run())).toBe('unsupported');

        expect((await readdir(join(project, 'src'))).sort()).toEqual(['a.ts', 'b.ts']);
    });
});

describe('fs.rename with overwrite', () => {
    test('trashes the file at the target and moves the source over it', async () => {
        const trashed: string[] = [];
        const plan = await planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'b.ts'), boundary(), {
            overwrite: true,
            trash: async (path) => {
                trashed.push(path);
                await rm(path);
            }
        });
        expect(trashed).toEqual([]);

        await plan.run();

        expect(trashed).toHaveLength(1);
        expect(trashed[0]).not.toBe(join(project, 'src', 'b.ts'));
        expect(trashed[0]!.startsWith(join(project, 'src'))).toBe(true);
        expect(await readFile(join(project, 'src', 'b.ts'), 'utf8')).toBe('a');
        expect(await fileExists(join(project, 'src', 'a.ts'))).toBe(false);
    });

    test('gives the target back when the source cannot be moved', async () => {
        const plan = await planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'b.ts'), boundary(), {
            overwrite: true,
            trash: async (path) => rm(path)
        });
        await rm(join(project, 'src', 'a.ts'));

        expect(await codeOf(plan.run())).toBeDefined();

        expect(await readFile(join(project, 'src', 'b.ts'), 'utf8')).toBe('b');
        expect(await readdir(join(project, 'src'))).toEqual(['b.ts']);
    });

    test('puts the replaced file back without overwriting what took its name in the meantime', async () => {
        const plan = await planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'b.ts'), boundary(), {
            overwrite: true,
            trash: async (path) => rm(path),
            rename: async (from, to) => {
                if (from.endsWith('a.ts')) {
                    await writeFile(to, 'newcomer');
                }
                await renameNoReplace(from, to);
            }
        });

        expect(await codeOf(plan.run())).toBe('exists');

        expect(await readFile(join(project, 'src', 'b.ts'), 'utf8')).toBe('newcomer');
        expect(await readFile(join(project, 'src', 'a.ts'), 'utf8')).toBe('a');
        const [holder] = (await readdir(join(project, 'src'))).filter((name) => name.startsWith('.ruimte-overwrite-'));
        expect(await readFile(join(project, 'src', holder!, 'b.ts'), 'utf8')).toBe('b');
    });

    test('leaves the replaced file where it is when the trash refuses it', async () => {
        const plan = await planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'b.ts'), boundary(), {
            overwrite: true,
            trash: async () => {
                throw new Error('no trash');
            }
        });

        await plan.run();

        expect(await readFile(join(project, 'src', 'b.ts'), 'utf8')).toBe('a');
        expect(await fileExists(join(project, 'src', 'a.ts'))).toBe(false);
        const holders = (await readdir(join(project, 'src'))).filter((name) => name.startsWith('.ruimte-overwrite-'));
        expect(holders).toHaveLength(1);
        expect(await readFile(join(project, 'src', holders[0]!, 'b.ts'), 'utf8')).toBe('b');
    });

    test('trashes nothing when the target is free', async () => {
        const trashed: string[] = [];
        const plan = await planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'c.ts'), boundary(), {
            overwrite: true,
            trash: async (path) => void trashed.push(path)
        });

        await plan.run();

        expect(trashed).toEqual([]);
        expect(await readFile(join(project, 'src', 'c.ts'), 'utf8')).toBe('a');
    });

    test('refuses a file over a folder and a folder over a file', async () => {
        await mkdir(join(project, 'dir'));
        const options = { overwrite: true, trash: async () => undefined };

        expect(await codeOf(planRename(join(project, 'src', 'a.ts'), join(project, 'dir'), boundary(), options))).toBe('exists');
        expect(await codeOf(planRename(join(project, 'dir'), join(project, 'src', 'a.ts'), boundary(), options))).toBe('exists');
        expect(await readFile(join(project, 'src', 'a.ts'), 'utf8')).toBe('a');
    });

    test('keeps the boundary of the target', async () => {
        await writeFile(join(outside, 'x.txt'), 'x');

        expect(
            await codeOf(planRename(join(project, 'src', 'a.ts'), join(outside, 'c.txt'), boundary(), { overwrite: true, trash: async () => undefined }))
        ).toBe('outside-project');
    });
});

describe('fs.rename across volumes', () => {
    const exdev = async (): Promise<void> => {
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
    };

    test('refuses before moving anything when the target is on another device', async () => {
        const moved: string[] = [];
        const code = await codeOf(
            planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'b.ts'), boundary(), {
                overwrite: true,
                deviceOf: async (path) => (path.endsWith('a.ts') ? 1 : 2),
                rename: async (from) => void moved.push(from)
            })
        );
        expect(code).toBe('other-volume');
        expect(moved).toEqual([]);
    });

    test('maps EXDEV from the move to other-volume', async () => {
        const plan = await planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'c.ts'), boundary(), { rename: exdev });
        expect(await codeOf(plan.run())).toBe('other-volume');
        expect(await readFile(join(project, 'src', 'a.ts'), 'utf8')).toBe('a');
    });

    test('maps EXDEV of a replacing move to other-volume and keeps the target', async () => {
        const plan = await planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'b.ts'), boundary(), {
            overwrite: true,
            trash: async () => undefined,
            rename: async (from, to) => (from.endsWith('a.ts') ? exdev() : renameNoReplace(from, to))
        });
        expect(await codeOf(plan.run())).toBe('other-volume');
        expect(await readFile(join(project, 'src', 'b.ts'), 'utf8')).toBe('b');
        expect((await readdir(join(project, 'src'))).sort()).toEqual(['a.ts', 'b.ts']);
    });

    test('tells the trash where the replaced file was', async () => {
        const originals: string[] = [];
        const plan = await planRename(join(project, 'src', 'a.ts'), join(project, 'src', 'b.ts'), boundary(), {
            overwrite: true,
            trash: async (path, original) => {
                originals.push(original);
                await rm(path);
            }
        });
        await plan.run();
        expect(originals).toEqual([join(project, 'src', 'b.ts')]);
    });
});

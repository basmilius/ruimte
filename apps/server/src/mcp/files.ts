import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ToolRefusal } from '@adecore/agents/context';
import { isInside } from '../tools/project-paths.ts';
import { realOrNull } from '../fs/real-path.ts';
import { readAtMost, type ImageFiles } from './visual-images.ts';

/*
 * The folders a tool reads a file from that an agent names: the project folder, the worktrees of its
 * repository, the caller's own folders under `$RUIMTE_HOME` and the system temp folder, the same ones a
 * device takes a file from (`checkDevicePath`). Compared on real paths, so a symlink inside one of them
 * that leads out is refused, and `/tmp` matches `/private/tmp`.
 */
export class AgentFiles {
    private readonly folder: string;
    private readonly roots: readonly string[];

    constructor(folder: string, roots: readonly string[]) {
        this.folder = folder;
        this.roots = roots;
    }

    static async of(folder: string, worktrees: readonly string[], callerFolders: readonly string[]): Promise<AgentFiles> {
        const named = [folder, ...worktrees, ...callerFolders, tmpdir(), '/tmp'];
        const real = await Promise.all(named.map(realOrNull));

        return new AgentFiles(folder, [...new Set(real.filter((root): root is string => root !== null))]);
    }

    /* The real path of a regular file the caller may hand a tool, resolved against the project folder unless absolute. */
    async file(path: string): Promise<string> {
        const resolved = resolve(this.folder, path);
        const real = await realOrNull(resolved);

        if (real === null || !(await stat(real)).isFile()) {
            throw new ToolRefusal('bad-path', `${resolved} is no file; a path is resolved against the project folder unless it is absolute`);
        }

        if (!this.roots.some((root) => isInside(root, real))) {
            throw new ToolRefusal(
                'path-outside',
                `${resolved} is outside the folders a tool reads from: the project folder, its worktrees, your chat folder and the temp folder`,
                this.roots.map((root) => `folder\t${root}`)
            );
        }

        return real;
    }

    /* What a page's local images are read through: only inside the same folders, a path outside them read as one this process may not read. */
    images(): ImageFiles {
        const inside = async (path: string): Promise<string> => {
            try {
                return await this.file(path);
            } catch (e) {
                if (e instanceof ToolRefusal && e.code === 'path-outside') {
                    throw Object.assign(new Error(e.message), { code: 'EACCES' });
                }

                throw Object.assign(new Error(`${path} is no file`), { code: 'ENOENT' });
            }
        };

        return {
            size: async (path) => (await stat(await inside(path))).size,
            read: async (path, into) => readAtMost(await inside(path), into)
        };
    }
}

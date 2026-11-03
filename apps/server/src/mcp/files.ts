import { constants, open, stat, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ToolRefusal } from '@adecore/agents/context';
import { isInside, outsidePath } from '../tools/project-paths.ts';
import { realOrNull } from '../fs/real-path.ts';
import type { ImageFiles } from './visual-images.ts';

/* A file the caller may hand a tool, open, which its user reads from and closes. */
export interface OpenedFile {
    /* The real path of what the handle has open. */
    path: string;
    size: number;
    handle: FileHandle;
}

/* At most `into.length` bytes of an open file from `position`, and how many there were before its end. */
export async function readOpened(handle: FileHandle, into: Buffer, position = 0): Promise<number> {
    let length = 0;

    while (length < into.length) {
        const { bytesRead } = await handle.read(into, length, into.length - length, position + length);

        if (bytesRead === 0) {
            break;
        }

        length += bytesRead;
    }

    return length;
}

/*
 * The real path of what the handle has open, read off the descriptor, so a link swapped in after the
 * open changes nothing. Windows has no `/dev/fd`: there the named path must still be the open file.
 */
async function openedPath(handle: FileHandle, resolved: string): Promise<string | null> {
    if (process.platform !== 'win32') {
        return realOrNull(`/dev/fd/${handle.fd}`);
    }

    const real = await realOrNull(resolved);

    if (real === null) {
        return null;
    }

    const [opened, named] = await Promise.all([handle.stat(), stat(real)]);

    return opened.dev === named.dev && opened.ino === named.ino ? real : null;
}

/*
 * The folders a tool reads a file from that an agent names: the project folder, the worktrees of its
 * repository, the caller's own folders under `$RUIMTE_HOME` and the system temp folder, the same ones a
 * device takes a file from (`checkDevicePath`). A file is opened once and judged on the real path of
 * what was opened, and read from that same handle, so a symlink inside one of them that leads out is
 * refused even when it appears after a check, and `/tmp` matches `/private/tmp`. A picture a tool hands
 * back may also come from the folders the machine keeps its shots in.
 */
export class AgentFiles {
    private readonly folder: string;
    private readonly roots: readonly string[];
    private readonly pictureRoots: readonly string[];

    constructor(folder: string, roots: readonly string[], pictureRoots: readonly string[] = roots) {
        this.folder = folder;
        this.roots = roots;
        this.pictureRoots = pictureRoots;
    }

    static async of(folder: string, worktrees: readonly string[], callerFolders: readonly string[], shotFolders: readonly string[] = []): Promise<AgentFiles> {
        const named = [folder, ...worktrees, ...callerFolders, tmpdir(), '/tmp'];
        const real = async (paths: readonly string[]) => [
            ...new Set((await Promise.all(paths.map(realOrNull))).filter((root): root is string => root !== null))
        ];
        const roots = await real(named);

        return new AgentFiles(folder, roots, [...new Set([...roots, ...(await real(shotFolders))])]);
    }

    /* A regular file the caller may hand a tool, resolved against the project folder unless absolute; the caller closes its handle. */
    open(path: string): Promise<OpenedFile> {
        return this.openInside(path, this.roots);
    }

    /* At most `into.length` bytes of a file the caller may hand a tool, and how many there were. */
    async read(path: string, into: Buffer): Promise<number> {
        const file = await this.open(path);

        try {
            return await readOpened(file.handle, into);
        } finally {
            await file.handle.close();
        }
    }

    /* The bytes of a png a tool handed back, or null when it is gone, too large or outside the folders a picture may come from. */
    async picture(path: string, maxBytes: number): Promise<Buffer | null> {
        const file = await this.openInside(path, this.pictureRoots).catch((e: unknown) => {
            if (e instanceof ToolRefusal) {
                return null;
            }

            throw e;
        });

        if (file === null) {
            return null;
        }

        try {
            if (file.size > maxBytes) {
                return null;
            }

            const bytes = Buffer.alloc(file.size);

            return bytes.subarray(0, await readOpened(file.handle, bytes));
        } finally {
            await file.handle.close();
        }
    }

    /* What a page's local images are read through: only inside the same folders, a path outside them read as one this process may not read. */
    images(): ImageFiles {
        const inside = async <T>(path: string, take: () => Promise<T>): Promise<T> => {
            try {
                return await take();
            } catch (e) {
                if (e instanceof ToolRefusal && e.code === 'path-outside') {
                    throw Object.assign(new Error(e.message), { code: 'EACCES' });
                }

                if (e instanceof ToolRefusal) {
                    throw Object.assign(new Error(`${path} is no file`), { code: 'ENOENT' });
                }

                throw e;
            }
        };

        return {
            size: (path) =>
                inside(path, async () => {
                    const file = await this.open(path);
                    await file.handle.close();

                    return file.size;
                }),
            read: (path, into) => inside(path, () => this.read(path, into))
        };
    }

    private async openInside(path: string, roots: readonly string[]): Promise<OpenedFile> {
        const resolved = resolve(this.folder, path);
        const notFile = () => new ToolRefusal('bad-path', `${resolved} is no file; a path is resolved against the project folder unless it is absolute`);
        // Nonblocking, so a fifo planted under the name opens without waiting for a writer, and is then refused.
        const handle = await open(resolved, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)).catch(() => null);

        if (handle === null) {
            throw notFile();
        }

        try {
            const info = await handle.stat();
            const real = info.isFile() ? await openedPath(handle, resolved) : null;

            if (real === null) {
                throw notFile();
            }

            if (!roots.some((root) => isInside(root, real))) {
                throw new ToolRefusal(
                    'path-outside',
                    `${await outsidePath(resolved, real)} outside the folders a tool reads from: the project folder, its worktrees, your chat folder and the temp folder`,
                    roots.map((root) => `folder\t${root}`)
                );
            }

            return { path: real, size: info.size, handle };
        } catch (e) {
            await handle.close();

            throw e;
        }
    }
}

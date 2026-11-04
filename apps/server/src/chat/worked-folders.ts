import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { isRecord } from '@adecore/utils/record';
import type { ChatItem } from '@ruimte/contracts';
import { toolWrites } from '../provenance/tool-writes.ts';
import { isInside } from '../tools/project-paths.ts';

interface WorkedFolder {
    path: string;
    /* Distinct paths the chat wrote or read in it. */
    files: number;
}

export interface WorkedFolderOptions {
    /* The chat's own folder in Chats, which also resolves a relative path. */
    cwd: string;
    home: string;
    ruimteHome: string;
    /* The top of the checkout a folder is in, or null. The path may no longer exist. */
    gitRoot(directory: string): Promise<string | null>;
}

// Tools of the CLIs that name a path they only look at; Claude's names, which the Apple backend shares.
const READ_PATH_FIELDS: Record<string, ReadonlyArray<{ field: string; folder: boolean }>> = {
    Read: [{ field: 'file_path', folder: false }],
    Glob: [{ field: 'path', folder: true }],
    Grep: [{ field: 'path', folder: true }],
    LS: [{ field: 'path', folder: true }],
    NotebookRead: [{ field: 'notebook_path', folder: false }]
};

interface Touched {
    path: string;
    /* The path is a folder a tool looked into, not a file. */
    folder: boolean;
}

/* A path as the CLI wrote it: `~` is the person's home, anything relative is the chat's folder. */
function resolveIn(cwd: string, home: string, path: string): string {
    if (path === '~' || path.startsWith('~/')) {
        return join(home, path.slice(1));
    }
    return resolve(cwd, path);
}

function readPaths(item: Extract<ChatItem, { kind: 'tool' }>, cwd: string, home: string): Touched[] {
    const input = isRecord(item.input) ? item.input : {};
    return (READ_PATH_FIELDS[item.name] ?? []).flatMap(({ field, folder }) => {
        const value = input[field];
        return typeof value === 'string' && value !== '' ? [{ path: resolveIn(cwd, home, value), folder }] : [];
    });
}

/* The paths the finished tool calls of a thread touched, each once, in the order they first came up. */
function touchedPaths(items: readonly ChatItem[], cwd: string, home: string): Touched[] {
    const found = new Map<string, Touched>();
    for (const item of items) {
        if (item.kind !== 'tool' || item.state !== 'done') {
            continue;
        }
        for (const write of toolWrites(item, cwd)) {
            found.set(write.path, found.get(write.path) ?? { path: write.path, folder: false });
        }
        for (const read of readPaths(item, cwd, home)) {
            found.set(read.path, found.get(read.path) ?? read);
        }
    }
    return [...found.values()];
}

/* The first folder below home that holds the path; null for a file straight in home. */
function topUnderHome(home: string, touched: Touched): string | null {
    const [first, ...rest] = relative(home, touched.path).split(sep);
    return first !== undefined && first !== '' && (rest.length > 0 || touched.folder) ? join(home, first) : null;
}

/*
 * The folders a chat worked in, most touched first. A path rounds up to the checkout it is in, or
 * else to the first folder below home; home itself and anything under the chat's own folder or the
 * machine's data folder never counts.
 */
export async function workedFolders(items: readonly ChatItem[], options: WorkedFolderOptions): Promise<WorkedFolder[]> {
    const { cwd, home, ruimteHome, gitRoot } = options;
    const roots = new Map<string, Promise<string | null>>();
    const rootOf = (directory: string): Promise<string | null> => {
        let found = roots.get(directory);
        if (found === undefined) {
            found = gitRoot(directory);
            roots.set(directory, found);
        }
        return found;
    };

    const counts = new Map<string, number>();
    // Checkouts found so far, so a path inside one needs no process of its own.
    const checkouts: string[] = [];
    for (const touched of touchedPaths(items, cwd, home)) {
        const { path } = touched;
        if (isInside(cwd, path) || isInside(ruimteHome, path)) {
            continue;
        }
        const directory = touched.folder ? path : dirname(path);
        let root = checkouts.find((checkout) => isInside(checkout, directory)) ?? null;
        if (root === null) {
            const found = await rootOf(directory);
            // A checkout that is home or holds it (a dotfiles repository) says nothing about the folder.
            root = found !== null && !isInside(found, home) ? found : null;
            if (root !== null) {
                checkouts.push(root);
            }
        }
        const folder = root ?? (isInside(home, path) ? topUnderHome(home, touched) : directory);
        if (folder === null || folder === home || folder === parse(folder).root || isInside(ruimteHome, folder)) {
            continue;
        }
        counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    return [...counts].map(([path, files]) => ({ path, files })).sort((a, b) => b.files - a.files);
}

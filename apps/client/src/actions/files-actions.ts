import { ActionRefusal, FILE_READ_MAX_LINES, type ActionActorKind, type ActionHandlers } from '@ruimte/actions';
import type { Transport } from '@/transport/transport';
import { asRefusal } from '@/actions/developer-actions';
import { absoluteOf, basenameOf, isAbsolutePath, relativeTo, revealableInFiles } from '@/shell/panels/files-tree';
import { useFiles } from '@/state/files';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { machineFor } from '@/transport/connections';

type Requester = Pick<Transport, 'request'>;

/* What the file actions reach outside the document; a test hands in a fake of each. */
export interface FilesMachine {
    transport(): Requester | null;
    /* The project folder on the machine it runs on, or null for a project without one. */
    folder(): string | null;
    writeText(text: string): Promise<void>;
    /* Whether the preview has this file open as itself, not as a diff. */
    isOpen(path: string): boolean;
    open(path: string, line: number | null): void;
    close(path: string): void;
    reveal(path: string): void;
}

const LIVE_MACHINE: FilesMachine = {
    transport: () => machineFor(currentEndpointId())?.transport ?? null,
    folder: () => useProject.getState().current?.folder ?? null,
    writeText: async (text) => {
        if (typeof navigator === 'undefined' || !navigator.clipboard) {
            throw new ActionRefusal('no-clipboard', 'This window has no clipboard to copy to.');
        }
        await navigator.clipboard.writeText(text);
    },
    // A file tab is named by its path, so that is also what says whether it is open.
    isOpen: (path) => useFiles.getState().tabs.some((tab) => tab.key === path),
    open: (path, line) => useFiles.getState().open(path, useSettings.getState().filesTabLimit, undefined, line ?? undefined),
    close: (path) => useFiles.getState().close(path),
    reveal: (path) => useFiles.getState().revealInFiles(path)
};

/* What anyone but a person gets when nothing bounds it: enough to answer with, few enough to read out. */
const DEFAULT_RESULTS = 50;
const MAX_LISTED = 200;
const MAX_READ_CHARACTERS = 40_000;

const hasParentStep = (path: string): boolean => path.split(/[\\/]/).includes('..');

/*
 * What a file action names, as the absolute path the daemon takes. A person names any file a node or
 * a view can show; anyone else stays inside the project folder, since a read hands the bytes to a
 * model outside this machine.
 */
export const projectPathOf = (folder: string | null, path: string, actor: ActionActorKind): string => {
    const absolute = isAbsolutePath(path) ? path : folder === null ? null : absoluteOf(folder, path);
    if (absolute === null) {
        throw new ActionRefusal('no-folder', 'This project has no folder, so a path has to be absolute.');
    }
    if (actor !== 'person' && (folder === null || hasParentStep(path) || !revealableInFiles(folder, absolute))) {
        throw new ActionRefusal('outside-project', `“${path}” is not inside the project folder.`);
    }
    return absolute;
};

const resolvedPath = (machine: FilesMachine, path: string, actor: ActionActorKind): string => projectPathOf(machine.folder(), path, actor);

/*
 * What a person does with the files of a project, as actions: the files panel, its search, find in
 * files and the menus a file has on a tab, a node and a view of its own. None of them writes, renames
 * or deletes a file; the product has no such action. Revealing a file in the machine's file manager
 * stays the menu's own: it acts on the screen of whichever machine the project runs on.
 */
export function filesActions(overrides: Partial<FilesMachine> = {}): ActionHandlers<void> {
    const machine: FilesMachine = { ...LIVE_MACHINE, ...overrides };

    const connected = (): Requester => {
        const transport = machine.transport();
        if (transport === null) {
            throw new ActionRefusal('no-machine', 'The machine this project runs on is not connected.');
        }
        return transport;
    };

    const projectFolder = (): string => {
        const folder = machine.folder();
        if (folder === null) {
            throw new ActionRefusal('no-folder', 'This project has no folder to look in.');
        }
        return folder;
    };

    const requested = async <Result>(ask: () => Promise<Result>): Promise<Result> => {
        try {
            return await ask();
        } catch (error: unknown) {
            throw asRefusal(error);
        }
    };

    return {
        'file.list': async ({ path, hidden }, { actor }) => {
            const folder = path === null ? projectFolder() : resolvedPath(machine, path, actor.kind);
            const result = await requested(() => connected().request('fs.list', { path: folder, hidden }));
            if (actor.kind === 'person' || result.entries.length <= MAX_LISTED) {
                return { output: result };
            }
            return { output: { ...result, entries: result.entries.slice(0, MAX_LISTED), truncated: true } };
        },
        'file.search': async ({ query, limit }) => {
            const cwd = projectFolder();
            return { output: await requested(() => connected().request('fs.search', { cwd, query, limit: limit ?? DEFAULT_RESULTS })) };
        },
        'file.grep': async ({ query, regex, caseSensitive, wholeWord, limit }) => {
            const cwd = projectFolder();
            return {
                output: await requested(() => connected().request('fs.grep', { cwd, query, regex, caseSensitive, wholeWord, limit: limit ?? DEFAULT_RESULTS }))
            };
        },
        'file.read': async ({ path, fromLine, lines }, { actor }) => {
            const absolute = resolvedPath(machine, path, actor.kind);
            const read = await requested(() => connected().request('fs.read', { path: absolute }));
            const from = fromLine ?? 1;
            if (read.kind !== 'text') {
                return {
                    output: { path: absolute, kind: read.kind, text: null, fromLine: from, toLine: from - 1, totalLines: 0, truncated: false, size: read.size }
                };
            }
            const all = read.text.split('\n');
            const wanted = all.slice(from - 1, from - 1 + (lines ?? FILE_READ_MAX_LINES));
            let text = wanted.join('\n');
            const cut = text.length > MAX_READ_CHARACTERS;
            if (cut) {
                text = text.slice(0, MAX_READ_CHARACTERS);
            }
            const toLine = from - 1 + (cut ? text.split('\n').length : wanted.length);
            return {
                output: {
                    path: absolute,
                    kind: 'text',
                    text,
                    fromLine: from,
                    toLine,
                    totalLines: all.length,
                    truncated: cut || toLine < all.length,
                    size: read.size
                }
            };
        },
        'file.preview': ({ path, line }, { actor }) => {
            const absolute = resolvedPath(machine, path, actor.kind);
            const opened = !machine.isOpen(absolute);
            machine.open(absolute, line);
            return {
                output: { path: absolute, file: basenameOf(absolute), opened },
                ...(opened
                    ? {
                          undo: () => {
                              if (machine.isOpen(absolute)) {
                                  machine.close(absolute);
                              }
                          }
                      }
                    : {})
            };
        },
        'file.reveal': ({ path }, { actor }) => {
            const absolute = resolvedPath(machine, path, actor.kind);
            if (!revealableInFiles(machine.folder(), absolute)) {
                throw new ActionRefusal('outside-folder', `The files panel lists the project folder, and “${path}” is outside it.`);
            }
            machine.reveal(absolute);
            return { output: { path: absolute } };
        },
        'file.copyPath': async ({ path, relative }, { actor }) => {
            const absolute = resolvedPath(machine, path, actor.kind);
            const copied = relative ? relativeTo(projectFolder(), absolute) : absolute;
            await machine.writeText(copied);
            return { output: { path: absolute, copied } };
        }
    };
}

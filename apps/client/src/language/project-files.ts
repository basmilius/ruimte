import type { ProjectFiles, StagedFile } from '@adecore/editor-react';
import { messageOf } from '@adecore/ui';
import i18next from 'i18next';
import { basenameOf } from '@/paths/file-path';
import { draftPathsUnder, forgetDeleted, moveFile } from '@/state/file-moves';
import { endpointKey, isOfEndpoint, splitKey } from '@/state/keys';
import { isUnsavedDraft, textDrafts, useTextDrafts, type TextDrafts } from '@/state/text-drafts';
import { useToasts } from '@/state/toasts';
import type { Transport } from '@/transport-api/transport';

/* How many files a toast names before it says how many more there are. */
const NAMED_FILES = 3;

/* The toasts that wait for their staged files to be saved, by id, with the way to stop waiting. */
const stagedToasts = new Map<string, () => void>();

export interface DraftProjectFiles extends ProjectFiles {
    /* Hears the unsaved text of every file of the machine, by path: at once, and again after every change of a draft. */
    watchUnsaved(listener: (texts: ReadonlyMap<string, string>) => void): () => void;
}

function unsavedTexts(endpointId: string): Map<string, string> {
    const texts = new Map<string, string>();
    for (const [key, draft] of Object.entries(useTextDrafts.getState().rows)) {
        if (isOfEndpoint(key, endpointId) && isUnsavedDraft(draft)) {
            texts.set(splitKey(key).id, draft.text);
        }
    }
    return texts;
}

function dismissStaged(id: string): void {
    stagedToasts.get(id)?.();
    stagedToasts.delete(id);
    useToasts.getState().dismiss(id);
}

/* The toast stays while one of its files is unsaved, however that file is saved, and goes with the last of them. */
function dismissOnceSaved(id: string, unsaved: () => boolean): void {
    stagedToasts.get(id)?.();
    stagedToasts.set(
        id,
        useTextDrafts.subscribe(() => {
            const shown = useToasts.getState().toasts.some((toast) => toast.id === id);
            if (!shown || !unsaved()) {
                dismissStaged(id);
            }
        })
    );
}

/* The files of one machine as the editors keep their text: a draft where there is one, and otherwise what the machine has. */
export function draftFiles(endpointId: string, transport: Transport, projectId: string | null = null, drafts: TextDrafts = textDrafts): DraftProjectFiles {
    const isFolder = async (path: string): Promise<boolean> => {
        try {
            await transport.request('fs.list', { path, depth: 1 });
            return true;
        } catch {
            return false;
        }
    };
    /* Paths that took an unsaved draft along in a move, with what the move left on disk: the mtime of a read from before it is out of date. */
    const savedByMove = new Map<string, NonNullable<StagedFile['disk']>>();
    const diskOf = (file: StagedFile): StagedFile['disk'] => {
        const moved = savedByMove.get(file.path);
        savedByMove.delete(file.path);
        return moved !== undefined && file.disk.mtime < moved.mtime ? moved : file.disk;
    };
    return {
        read: async (path) => {
            const draft = drafts.draft(endpointId, path);
            if (draft !== undefined) {
                return { text: draft.text, mtime: draft.mtime };
            }
            try {
                const read = await transport.request('fs.read', { path });
                return read.kind === 'text' ? { text: read.text, mtime: read.mtime } : null;
            } catch {
                return null;
            }
        },
        save: async (files) => {
            for (const file of files) {
                drafts.stage(endpointId, file.path, diskOf(file), file.text);
                if (!(await drafts.save(endpointId, file.path, 'edit'))) {
                    return i18next.t('panels:language.edit.notSaved', { name: basenameOf(file.path) });
                }
            }
            return null;
        },
        supportsOverwrite: true,
        rename: async (from, to, options) => {
            try {
                const unsaved = draftPathsUnder(endpointId, from, true);
                await moveFile(transport, endpointId, projectId, from, to, { edits: false, focus: true, overwrite: options?.overwrite }, drafts);
                if (options?.overwrite) {
                    // The replaced file went to the trash, so what is open on it must not keep its text or write it back.
                    forgetDeleted(endpointId, to, drafts);
                }
                await Promise.all(
                    unsaved.map(async (path) => {
                        const moved = to + path.slice(from.length);
                        try {
                            const read = await transport.request('fs.read', { path: moved });
                            if (read.kind === 'text') {
                                savedByMove.set(moved, { text: read.text, mtime: read.mtime });
                            }
                        } catch {
                            // Without a read the save goes against the mtime it had.
                        }
                    })
                );
                return null;
            } catch (error) {
                return messageOf(error);
            }
        },
        create: async (path, text, options) => {
            try {
                const written = await transport.request('fs.create', {
                    path,
                    kind: 'file',
                    text,
                    ...(projectId === null ? {} : { projectId, edits: false }),
                    ...(options?.overwrite ? { overwrite: true } : {})
                });
                if (options?.overwrite) {
                    // An open editor is then set to this text: against the old mtime that would read as an unsaved change and a false conflict.
                    drafts.received(endpointId, path, { text, mtime: written.mtime });
                }
                return null;
            } catch (error) {
                return messageOf(error);
            }
        },
        delete: async (path) => {
            try {
                await transport.request('fs.delete', { path, ...(projectId === null ? {} : { projectId, edits: false }) });
                forgetDeleted(endpointId, path);
                return null;
            } catch (error) {
                return messageOf(error);
            }
        },
        isUnsaved: (path) => draftPathsUnder(endpointId, path, true).length > 0,
        isFolder,
        exists: async (path) => {
            try {
                await transport.request('fs.read', { path });
                return true;
            } catch {
                return isFolder(path);
            }
        },
        stage: (files: readonly StagedFile[]) => {
            for (const file of files) {
                drafts.stage(endpointId, file.path, file.disk, file.text);
            }
            const id = `language-staged-${endpointKey(endpointId, files[0]!.path)}`;
            // An edit that put a file back as it is on disk leaves nothing to save there.
            const unsaved = files.filter((file) => drafts.isUnsaved(endpointId, file.path));
            if (unsaved.length === 0) {
                dismissStaged(id);
                return;
            }
            const names = unsaved.slice(0, NAMED_FILES).map((file) => basenameOf(file.path));
            const more = unsaved.length - names.length;
            useToasts.getState().show({
                id,
                kind: 'success',
                persist: true,
                title: i18next.t('panels:language.edit.staged', { count: unsaved.length }),
                description: more > 0 ? i18next.t('panels:language.edit.stagedMore', { names: names.join(', '), count: more }) : names.join(', '),
                action: {
                    label: i18next.t('panels:language.edit.saveAll'),
                    run: () => {
                        for (const file of unsaved) {
                            void drafts.save(endpointId, file.path, 'edit');
                        }
                    }
                }
            });
            dismissOnceSaved(id, () => unsaved.some((file) => drafts.isUnsaved(endpointId, file.path)));
        },
        watchUnsaved: (listener) => {
            let last = unsavedTexts(endpointId);
            listener(last);
            return useTextDrafts.subscribe(() => {
                const texts = unsavedTexts(endpointId);
                if (texts.size !== last.size || [...texts].some(([path, text]) => last.get(path) !== text)) {
                    last = texts;
                    listener(texts);
                }
            });
        }
    };
}

import i18next from 'i18next';
import { moveFile } from '@/state/file-moves';
import { endpointKey } from '@/state/keys';
import { textDrafts } from '@/state/text-drafts';
import { useToasts } from '@/state/toasts';
import type { Transport } from '@/transport/transport';
import type { ProjectFiles, StagedFile } from '@adecore/editor-react';

/* How many files a toast names before it says how many more there are. */
const NAMED_FILES = 3;

function nameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

/* The files of one machine as the editors keep their text: a draft where there is one, and otherwise what the machine has. */
export function draftFiles(endpointId: string, transport: Transport, projectId: string | null = null): ProjectFiles {
    return {
        read: async (path) => {
            const draft = textDrafts.draft(endpointId, path);
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
                textDrafts.stage(endpointId, file.path, file.disk, file.text);
                if (!(await textDrafts.save(endpointId, file.path))) {
                    return i18next.t('panels:language.edit.notSaved', { name: nameOf(file.path) });
                }
            }
            return null;
        },
        rename: async (from, to) => {
            try {
                await moveFile(transport, endpointId, projectId, from, to, { edits: false, focus: true });
                return null;
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        },
        stage: (files: readonly StagedFile[]) => {
            for (const file of files) {
                textDrafts.stage(endpointId, file.path, file.disk, file.text);
            }
            const names = files.slice(0, NAMED_FILES).map((file) => nameOf(file.path));
            const more = files.length - names.length;
            useToasts.getState().show({
                id: `language-staged-${endpointKey(endpointId, files[0]!.path)}`,
                kind: 'success',
                persist: true,
                title: i18next.t('panels:language.edit.staged', { count: files.length }),
                description: more > 0 ? i18next.t('panels:language.edit.stagedMore', { names: names.join(', '), count: more }) : names.join(', '),
                action: {
                    label: i18next.t('panels:language.edit.saveAll'),
                    run: () => {
                        for (const file of files) {
                            void textDrafts.save(endpointId, file.path);
                        }
                    }
                }
            });
        }
    };
}

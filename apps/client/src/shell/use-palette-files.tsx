import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileIcon } from '@adecore/ui';
import { createViewAction, ignoreRefusal, perform } from '@/actions/client-actions';
import { showFileOnCanvas } from '@/project/views';
import { PaletteEntryList, PaletteNote } from '@/shell/PaletteEntryList';
import { activeEntryOf, optionId, type Entry, type PaletteContext, type PaletteModeView } from '@/shell/palette-entries';
import { absoluteOf, basenameOf } from '@/shell/panels/files-tree';
import { shownFolderOf, useProject } from '@/state/project';
import { useUi } from '@/state/ui';

const FILE_DEBOUNCE_MS = 120;
// Enough to recognize the file being looked for, few enough to leave room for what else matches.
const FILE_RESULTS = 8;

/*
 * The files of the project folder that match the field, as rows. They are a section of the commands
 * and, while a file is being picked, the whole list. `skip` is a search that draws its own results
 * or a folder browse, neither of which has files to offer.
 */
export function usePaletteFiles(context: PaletteContext, { skip, picking }: { skip: boolean; picking: boolean }) {
    const { t } = useTranslation(['shell']);
    const { query, index, setIndex, close } = context;
    const folder = useProject((s) => shownFolderOf(s.current));
    const filePick = useUi((s) => s.filePick);
    const [fileMatches, setFileMatches] = useState<readonly string[]>([]);
    const fileGeneration = useRef(0);

    useEffect(() => {
        const trimmed = query.trim();
        const mine = ++fileGeneration.current;
        if (skip || folder === null || (trimmed === '' && !picking)) {
            return;
        }
        const timer = window.setTimeout(() => {
            perform('file.search', { query: trimmed, limit: FILE_RESULTS })
                .then((result) => {
                    if (mine === fileGeneration.current) {
                        setFileMatches(result.files);
                    }
                })
                .catch(() => {
                    if (mine === fileGeneration.current) {
                        setFileMatches([]);
                    }
                });
        }, FILE_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [skip, folder, picking, query]);

    /* A file row does what the palette was opened for: a node where the menu was clicked, a view of
       its own, or the preview tab every other route here means. */
    const openFile = (path: string, line: number | null = null): void => {
        if (folder === null) {
            return;
        }
        const absolute = absoluteOf(folder, path);
        if (filePick?.kind === 'node') {
            void showFileOnCanvas(absolute, filePick.at);
            return;
        }
        if (filePick?.kind === 'view') {
            void createViewAction('file', { path: absolute });
            return;
        }
        void perform('file.preview', { path: absolute, line }).catch(ignoreRefusal);
    };

    /* What the last answer held stays out of a list it no longer belongs to; the effect above
       only fills it, so an empty query or a folder browse never shows yesterday's files. */
    const files: Entry[] = (query.trim() === '' && !picking ? [] : fileMatches).map((path) => {
        const name = basenameOf(path);
        return {
            id: `file-${path}`,
            label: name,
            // The folder the file sits in; a name on its own says too little in a deep tree.
            hint: path.slice(0, Math.max(path.length - name.length - 1, 0)) || undefined,
            icon: <FileIcon path={path} size={14} />,
            section: 'files' as const,
            run: () => openFile(path)
        };
    });

    const active = activeEntryOf(files, index);
    const run = (entry: Entry | undefined): void => {
        if (!entry) {
            return;
        }
        close();
        entry.run();
    };

    // Picking a file is a step with one list; the commands and the nodes have no place in it.
    const view: PaletteModeView = {
        count: files.length,
        activeOptionId: active ? optionId(files.indexOf(active)) : undefined,
        enter: () => run(active),
        notes: files.length === 0 && <PaletteNote>{folder === null ? t('palette.noProjectFolder') : t('palette.noFileMatch')}</PaletteNote>,
        results: <PaletteEntryList entries={files} active={active} onHover={setIndex} onRun={(entry) => run(entry)} />
    };

    return { folder, files, openFile, view };
}

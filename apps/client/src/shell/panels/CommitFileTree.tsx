import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { FileTreeVisibleRow } from '@pierre/trees';
import { FileTree, useFileTree } from '@adecore/ui';
import { useTranslation } from 'react-i18next';
import { GitTreeMarks } from './GitTreeMarks';
import type { GitDiffFile } from '@ruimte/contracts';
import { diffFileParts, firstFile, folderParts } from '@/shell/panels/commit-tree';
import { dirPathOf, mergeCollapsedPaths } from '@/shell/panels/git-tree';
const { applyExpansion, focusRow, selectOnly, visibleRows } = FileTree;

interface CommitFileTreeProps {
    files: readonly GitDiffFile[];
    /* The file whose diff is up, or null while none is picked yet. */
    shown: string | null;
    onPick(path: string): void;
}

/*
 * The files of a commit or of a checkout's changes, as the tree the git panel draws its changes in.
 * A commit is read, not staged, so a row has no box and no menu: selecting it is what shows its
 * diff, by the pointer or by the arrow keys, and the keyboard stays here while it does.
 */
export function CommitFileTree({ files, shown, onPick }: CommitFileTreeProps) {
    const { t } = useTranslation('panels');
    const filesRef = useRef(files);
    const byPathRef = useRef<ReadonlyMap<string, GitDiffFile>>(new Map());
    const onPickRef = useRef(onPick);
    /* The folders a person folded, which a reread of a checkout with other files keeps folded. */
    const foldedRef = useRef<string[]>([]);
    /* Set while this component folds the tree, so the folding is not read back as a person's doing. */
    const applyingRef = useRef(false);
    /* The paths the tree was last built from: a checkout is read again on every write in it. */
    const builtRef = useRef('');

    const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);

    const decorate = useCallback(
        (item: FileTreeVisibleRow) => {
            if (item.kind === 'directory') {
                const parts = folderParts(files, dirPathOf(item.path));
                return parts === null ? null : <GitTreeMarks parts={parts} />;
            }
            const file = byPath.get(item.path);
            return file === undefined ? null : <GitTreeMarks parts={diffFileParts(file)} />;
        },
        [byPath, files]
    );

    const { model } = useFileTree({
        paths: [],
        flattenEmptyDirectories: true,
        initialExpansion: 'open',
        onSelectionChange: (paths) => {
            const path = paths.length === 1 ? paths[0]! : null;
            if (path !== null && byPathRef.current.has(path)) {
                onPickRef.current(path);
            }
        }
    });

    /* Before the paint, so a tab that opens draws its first file at once and not a frame later. */
    useLayoutEffect(() => {
        filesRef.current = files;
        byPathRef.current = byPath;
        const paths = files.map((file) => file.path);
        const key = paths.join('\n');
        if (builtRef.current === key) {
            return;
        }
        builtRef.current = key;
        const selected = model.getSelectedPaths();
        const focused = model.getFocusedPath();
        const typing = document.activeElement !== null && document.activeElement === model.getFileTreeContainer();
        applyingRef.current = true;
        model.resetPaths(paths);
        applyExpansion(model, new Set(foldedRef.current));
        applyingRef.current = false;
        for (const path of selected) {
            model.getItem(path)?.select();
        }
        const next = !typing || focused === null ? null : model.getItem(focused) !== null ? focused : model.focusNearestPath(focused);
        if (next !== null) {
            focusRow(model, next);
        }
    }, [byPath, files, model]);

    useEffect(() => {
        onPickRef.current = onPick;
    }, [onPick]);

    useLayoutEffect(() => {
        if (shown === null) {
            const first = firstFile(visibleRows(model), filesRef.current);
            if (first !== null) {
                onPickRef.current(first);
            }
            return;
        }
        if (model.getSelectedPaths().length <= 1) {
            selectOnly(model, model.getItem(shown) !== null ? shown : null);
        }
    }, [model, shown]);

    /* The tree reports a fold nowhere, so every change of its own is the moment to read back which folders stand closed. */
    useEffect(
        () =>
            model.subscribe(() => {
                if (!applyingRef.current) {
                    foldedRef.current = mergeCollapsedPaths(foldedRef.current, visibleRows(model));
                }
            }),
        [model]
    );

    return (
        <FileTree.Root
            model={model}
            className="min-h-0 grow overflow-hidden"
            label={t('git.list.openChanges')}
            onActivate={(path) => selectOnly(model, path)}
            renderDecoration={decorate}
        />
    );
}

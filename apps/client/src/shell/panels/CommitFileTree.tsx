import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { FileTreeRowDecoration, FileTreeRowDecorationContext } from '@pierre/trees';
import { FileTree, useFileTree, useFileTreeSelector } from '@pierre/trees/react';
import type { GitDiffFile } from '@ruimte/contracts';
import { diffFileParts, firstFile, folderParts } from '@/shell/panels/commit-tree';
import { decorationOfParts, dirPathOf, mergeCollapsedPaths } from '@/shell/panels/git-tree';
import {
    applyExpansion,
    CHANGE_TREE_CSS,
    directoryHandle,
    focusRow,
    followFocus,
    movesFocus,
    pathOfRow,
    selectOnly,
    visibleRows,
    PANEL_TREE_ROW_HEIGHT
} from '@/shell/panels/panel-tree';
import { FILE_TREE_ICONS } from '@basmilius/desktop-ui';

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
    const filesRef = useRef(files);
    const byPathRef = useRef<ReadonlyMap<string, GitDiffFile>>(new Map());
    const onPickRef = useRef(onPick);
    /* The folders a person folded, which a reread of a checkout with other files keeps folded. */
    const foldedRef = useRef<string[]>([]);
    /* Set while this component folds the tree, so the folding is not read back as a person's doing. */
    const applyingRef = useRef(false);
    /* The paths the tree was last built from: a checkout is read again on every write in it. */
    const builtRef = useRef('');

    /* The tree keeps the renderer it was made with, so this reads the files of the moment. */
    const decorate = useCallback(({ item }: FileTreeRowDecorationContext): FileTreeRowDecoration | null => {
        if (item.kind === 'directory') {
            const parts = folderParts(filesRef.current, dirPathOf(item.path));
            return parts === null ? null : decorationOfParts(parts);
        }
        const file = byPathRef.current.get(item.path);
        return file === undefined ? null : decorationOfParts(diffFileParts(file));
    }, []);

    const { model } = useFileTree({
        paths: [],
        composition: { contextMenu: { enabled: false } },
        density: 'compact',
        itemHeight: PANEL_TREE_ROW_HEIGHT,
        flattenEmptyDirectories: true,
        icons: FILE_TREE_ICONS,
        initialExpansion: 'open',
        onSelectionChange: (paths) => {
            const path = paths.length === 1 ? paths[0]! : null;
            if (path !== null && byPathRef.current.has(path)) {
                onPickRef.current(path);
            }
        },
        renderRowDecoration: decorate,
        search: false,
        stickyFolders: false,
        unsafeCSS: CHANGE_TREE_CSS
    });

    const rowCount = useFileTreeSelector(model, (current) => current.getVisibleCount());

    /* Before the paint, so a tab that opens draws its first file at once and not a frame later. */
    useLayoutEffect(() => {
        filesRef.current = files;
        byPathRef.current = new Map(files.map((file) => [file.path, file]));
        const paths = files.map((file) => file.path);
        const key = paths.join('\n');
        if (builtRef.current === key) {
            // The same files with other counts, after a checkout was read again.
            model.setComposition(model.getComposition());
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
    }, [files, model]);

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

    const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLElement>): void => {
        if (event.altKey || event.metaKey || event.ctrlKey) {
            return;
        }
        if (event.key === 'Enter') {
            const index = model.getFocusedIndex();
            const row = index < 0 ? undefined : model.getVisibleRows(index, index)[0];
            if (row === undefined) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const path = pathOfRow(row);
            if (row.kind === 'directory') {
                directoryHandle(model, path)?.toggle();
            } else {
                selectOnly(model, path);
            }
        } else if (movesFocus(event)) {
            followFocus(model);
        }
    };

    return (
        <div style={{ height: rowCount * model.getItemHeight() }} onKeyDownCapture={onKeyDownCapture}>
            <FileTree model={model} className="panel-tree" />
        </div>
    );
}

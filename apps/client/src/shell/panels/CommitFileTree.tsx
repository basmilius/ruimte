import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiffSourceLine } from '@adecore/merge';
import type { FileTreeVisibleRow } from '@pierre/trees';
import type { GitDiffFile } from '@ruimte/contracts';
import { diffFileParts, firstFile, folderParts } from '@/shell/panels/commit-tree';
import { DiffRowMenuItems } from '@/shell/panels/DiffRowMenuItems';
import type { DecorationPart } from '@/shell/panels/git-tree';
import { GitTreeMarks } from '@/shell/panels/GitTreeMarks';
import { ContextMenu, FileTree, useFileTree } from '@adecore/ui';

const { applyExpansion, dirPathOf, mergeCollapsedPaths, rebuildPaths, rowPathOf, selectOnly, visibleRows } = FileTree;

interface CommitFileTreeProps {
    files: readonly GitDiffFile[];
    /* The file whose diff is up, or null while none is picked yet. */
    shown: string | null;
    onPick(path: string): void;
    /* The decoration after a file's name; the counts and letter of a commit's diff when absent. */
    marks?(file: GitDiffFile): DecorationPart[];
    /* Where the paths count from, and the commit they are part of; without it a row has no menu. */
    menu?: { cwd: string; commit?: string };
    /* Where the caret of the shown file's diff stands in the file, which its row's menu opens it at. */
    caret?: DiffSourceLine;
}

/*
 * The files of a commit or of a checkout's changes, as the tree the git panel draws its changes in.
 * A commit is read, not staged, so a row has no box and its menu only reads: selecting it is what
 * shows its diff, by the pointer or by the arrow keys, and the keyboard stays here while it does.
 */
export function CommitFileTree({ files, shown, onPick, marks = diffFileParts, menu, caret }: CommitFileTreeProps) {
    const { t } = useTranslation('panels');
    /* The file a right click landed on, which the menu acts on. */
    const [menuPath, setMenuPath] = useState<string | null>(null);
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

    const decorate = (item: FileTreeVisibleRow) => {
        if (item.kind === 'directory') {
            const parts = folderParts(files, dirPathOf(item.path));
            return parts === null ? null : <GitTreeMarks parts={parts} />;
        }
        const file = byPath.get(item.path);
        return file === undefined ? null : <GitTreeMarks parts={marks(file)} />;
    };

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
        rebuildPaths(model, paths, () => applyExpansion(model, new Set(foldedRef.current)), applyingRef);
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

    const tree = (
        <FileTree.Root
            model={model}
            className="min-h-0 grow overflow-hidden"
            label={t('git.list.openChanges')}
            onActivate={(path) => selectOnly(model, path)}
            renderDecoration={decorate}
        />
    );
    if (menu === undefined) {
        return tree;
    }
    const menuFile = menuPath === null ? undefined : byPath.get(menuPath);
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                className="flex min-h-0 grow flex-col overflow-hidden"
                onContextMenu={(event) => {
                    const path = rowPathOf(event);
                    // A folder of the tree is no file of the diff, and has nothing to offer.
                    if (path === null || !byPath.has(path)) {
                        event.preventBaseUIHandler();
                        return;
                    }
                    setMenuPath(path);
                }}
            >
                {tree}
            </ContextMenu.Trigger>
            <ContextMenu.Popup>
                {menuFile !== undefined && (
                    <DiffRowMenuItems
                        cwd={menu.cwd}
                        path={menuFile.path}
                        gone={menuFile.kind === 'delete'}
                        commit={menu.commit}
                        caret={menuFile.path === shown ? caret : undefined}
                        onOpenChanges={() => selectOnly(model, menuFile.path)}
                    />
                )}
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

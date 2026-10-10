import { revealFile } from './reveal-file';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileTreeVisibleRow } from '@pierre/trees';
import { FileTree, useFileTree } from '@adecore/ui';
import { GitTreeMarks } from './GitTreeMarks';
import { ChevronsDownUp, ChevronsUpDown, CornerUpRight, EyeOff, FileDiff, FileText, FileX, Folder, GitBranch, Minus, Plus, Trash2 } from 'lucide-react';
import type { GitFile } from '@ruimte/contracts';
import { FileCopyRow } from '@/shell/panels/FileCopyRow';
import { revealableInFiles } from '@/shell/panels/files-tree';
import {
    buildGitTree,
    byCheckout,
    checkOf,
    checkOfItems,
    compareGitRows,
    entriesOf,
    entryParts,
    fileId,
    foldedBranches,
    itemsOfNodes,
    mergeCollapsedPaths,
    nodeOf,
    shownFile,
    toggleItems,
    type DecorationPart,
    type FoldKeyOf,
    type GitEntry,
    type GitItem,
    type GitTreeLayout,
    type GitTreeNode
} from '@/shell/panels/git-tree';
import { setDragging } from '@/shell/view-drag';
import { useFiles } from '@/state/files';
import { useGit } from '@/state/git';
import type { GitCheckout } from '@/state/git-repos';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { Icon, PanelEmpty, ContextMenu } from '@adecore/ui';

const { applyExpansion, directoryHandle, focusRow, menuTargetsOf, rowPathOf, selectOnly, visibleRows } = FileTree;

const COUNT_COLOR = 'var(--text-faint)';
const BRANCH_COLOR = 'var(--text-muted)';

const GIT_TREE_CSS = `
    [data-type="item"][aria-level="1"] [data-item-section="content"] { font-weight: 500; }
`;

/* A file git no longer has on disk: opening it or revealing it would point at nothing. */
function isGone(entry: GitEntry): boolean {
    return [entry.staged, entry.worktree].some((file) => file?.status.startsWith('D') === true);
}

/* What moving a new file to the trash names: the index side first, so it is taken out of the index too. */
function newFileOf(entry: GitEntry): GitFile {
    return (entry.staged ?? entry.worktree)!;
}

type FileNode = Extract<GitTreeNode, { kind: 'file' }>;

function isFile(node: GitTreeNode | undefined): node is FileNode {
    return node?.kind === 'file';
}

/* What a dialog over a selection acts on: the files of each checkout it touches. */
export interface GitWork {
    cwd: string;
    files: GitFile[];
}

/* The items of a selection as the work of each checkout, with the file each one names. */
function workOf(items: readonly GitItem[], fileOf: (entry: GitEntry) => GitFile): GitWork[] {
    return byCheckout(items).map(([cwd, entries]) => ({ cwd, files: entries.map(fileOf) }));
}

interface ListProps {
    checkouts: readonly GitCheckout[];
    collapsed: string[];
    /* The change the preview has open and the checkout it belongs to, so the list marks the row. */
    reading: { cwd: string; path: string } | null;
    /* Set when the folder holds more repositories than the panel was given. */
    reposTruncated: boolean;
    busy: boolean;
    onOpen(cwd: string, file: GitFile): void;
    /* The file itself rather than its diff, in a tab of its own. */
    onOpenFile(cwd: string, file: GitFile): void;
    /* A row dragged onto the grid, which opens its diff where it lands. */
    onDrag(cwd: string, file: GitFile, transfer: DataTransfer): void;
    onStage(cwd: string, paths: string[], staged: boolean): void;
    onDiscard(work: GitWork[]): void;
    onDelete(work: GitWork[]): void;
}

/*
 * The changed files as one tree (`buildGitTree`): conflicts, then tracked changes, then what git has
 * never seen. Every row has a box that stages or unstages all of it, and opens its diff in the preview.
 */
export function GitFileList({ checkouts, reposTruncated, ...props }: ListProps) {
    const { t } = useTranslation('panels');
    const layout = useMemo(
        () =>
            buildGitTree(
                checkouts.map((checkout) => ({ path: checkout.path, label: checkout.label, entries: entriesOf(checkout.status?.files ?? []) })),
                (group) => t(`git.group.${group}`)
            ),
        [checkouts, t]
    );
    const branches = useMemo(() => new Map(checkouts.map((checkout) => [checkout.path, checkout.status?.branch ?? null])), [checkouts]);

    const read = checkouts.filter((checkout) => checkout.status !== null);
    if (checkouts.length === 0 || (read.length > 0 && read.every((checkout) => checkout.status?.repo !== true))) {
        return <PanelEmpty icon={GitBranch}>{t('git.list.noRepo')}</PanelEmpty>;
    }
    if (read.length === 0) {
        return <div className="grid min-h-0 grow place-items-center" />;
    }
    if (layout.paths.length === 0) {
        return <PanelEmpty icon={GitBranch}>{t('git.list.noChanges')}</PanelEmpty>;
    }
    const truncated = reposTruncated || read.some((checkout) => checkout.status?.truncated === true);
    return (
        <div className="flex min-h-0 grow flex-col">
            <GitTree layout={layout} branches={branches} {...props} />
            {truncated && <p className="px-3 py-2 text-xs text-text-faint">{t('diff.moreFiles')}</p>}
        </div>
    );
}

interface TreeProps extends Omit<ListProps, 'checkouts' | 'reposTruncated'> {
    layout: GitTreeLayout;
    /* The branch each checkout is on, by its path. */
    branches: ReadonlyMap<string, string | null>;
}

function GitTree({ layout, branches, collapsed, reading, busy, onOpen, onOpenFile, onDrag, onStage, onDiscard, onDelete }: TreeProps) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const folder = useProject((s) => s.current?.folder ?? null);
    /* The rows the open context menu acts on: one, or the whole selection when the row is part of one. */
    const [menuPaths, setMenuPaths] = useState<string[]>([]);
    /* What the tree's callbacks read, since it keeps the ones it was made with. */
    const layoutRef = useRef(layout);
    const collapsedRef = useRef<ReadonlySet<string>>(new Set());
    /* Set while this component folds the tree, so the folding is not read back as a person's doing. */
    const applyingRef = useRef(false);
    /* The collapse set the tree last stood by, to tell which folders just folded. */
    const foldedRef = useRef<readonly string[] | null>(null);
    /* The paths the tree was last built from: a status arrives every few seconds, and rebuilding a
       tree that did not change would throw away which folders stand folded. */
    const builtRef = useRef('');

    const keyOf = useCallback<FoldKeyOf>((rowPath) => {
        const node = nodeOf(layoutRef.current, rowPath);
        return node === undefined || node.kind === 'file' ? null : node.key;
    }, []);

    const decorate = useCallback(
        (item: FileTreeVisibleRow) => {
            const node = nodeOf(layout, item.path);
            if (node === undefined) {
                return null;
            }
            if (node.kind === 'file') {
                return <GitTreeMarks parts={entryParts(node.item.entry)} />;
            }
            if (node.kind === 'folder') {
                return <GitTreeMarks parts={[{ text: String(node.items.length), kind: 'count' }]} />;
            }
            const parts: DecorationPart[] = [{ text: t('git.list.files', { count: node.items.length }), color: COUNT_COLOR, kind: 'count' }];
            const branch = node.kind === 'repo' ? (branches.get(node.cwd) ?? null) : null;
            if (branch !== null) {
                parts.push({ text: branch, color: BRANCH_COLOR, kind: 'branch' });
            }
            return <GitTreeMarks parts={parts} />;
        },
        [branches, layout, t]
    );

    const { model } = useFileTree({
        paths: [],
        // One file at a time, and never a conflict: its three versions are no diff to open.
        dragAndDrop: {
            canDrag: (paths) => {
                const node = paths.length === 1 ? nodeOf(layoutRef.current, paths[0]!) : undefined;
                return isFile(node) && node.group !== 'conflicts';
            },
            canDrop: () => false
        },
        flattenEmptyDirectories: false,
        initialExpansion: 'open',
        sort: (left, right) => compareGitRows(layoutRef.current, left, right),
        unsafeCSS: GIT_TREE_CSS
    });

    useEffect(() => {
        collapsedRef.current = new Set(collapsed);
    }, [collapsed]);

    useEffect(() => {
        layoutRef.current = layout;
        const key = layout.paths.join('\n');
        if (builtRef.current === key) {
            return;
        }
        builtRef.current = key;
        const selected = model.getSelectedPaths();
        const focused = model.getFocusedPath();
        const typing = document.activeElement !== null && document.activeElement === model.getFileTreeContainer();
        applyingRef.current = true;
        model.resetPaths(layout.paths);
        applyExpansion(model, collapsedRef.current, keyOf);
        applyingRef.current = false;
        for (const path of selected) {
            model.getItem(path)?.select();
        }
        // A row that went (discarded, deleted) hands the keyboard to the one nearest to it.
        const next = !typing || focused === null ? null : model.getItem(focused) !== null ? focused : model.focusNearestPath(focused);
        if (next !== null) {
            focusRow(model, next);
        }
    }, [branches, keyOf, layout, model, t]);

    useEffect(() => {
        const before = foldedRef.current;
        foldedRef.current = collapsed;
        const branchPaths = before === null ? [] : foldedBranches(layoutRef.current, before, collapsed);
        applyingRef.current = true;
        for (const path of branchPaths) {
            directoryHandle(model, path)?.collapse();
        }
        applyExpansion(model, new Set(collapsed), keyOf);
        applyingRef.current = false;
        const current = useGit.getState().collapsedDirs;
        const added = branchPaths.map((path) => keyOf(path)).filter((key): key is string => key !== null && !current.includes(key));
        if (added.length > 0) {
            useGit.getState().setCollapsedDirs([...current, ...added]);
        }
    }, [collapsed, keyOf, model]);

    /* The tree reports a fold nowhere, so every change of its own is the moment to read back which rows stand closed. */
    useEffect(
        () =>
            model.subscribe(() => {
                if (applyingRef.current) {
                    return;
                }
                const current = useGit.getState().collapsedDirs;
                const next = mergeCollapsedPaths(current, visibleRows(model), keyOf);
                if (next !== current) {
                    useGit.getState().setCollapsedDirs(next);
                }
            }),
        [keyOf, model]
    );

    /* The tree follows the preview: the file whose diff is open is the row that reads as selected. A
       selection of several rows is a person's own, and a new tab does not take it away. */
    const readingPath = reading === null ? null : (layout.files.get(fileId(reading.cwd, reading.path)) ?? null);
    useEffect(() => {
        if (model.getSelectedPaths().length > 1) {
            return;
        }
        selectOnly(model, readingPath !== null && model.getItem(readingPath) !== null ? readingPath : null);
    }, [model, readingPath]);

    const nodesOf = (rows: readonly string[]): GitTreeNode[] =>
        rows.map((row) => nodeOf(layout, row)).filter((node): node is GitTreeNode => node !== undefined);

    const toggleRows = (rows: readonly string[]): void => {
        if (busy) {
            return;
        }
        const { staged, work } = toggleItems(itemsOfNodes(nodesOf(rows)));
        for (const step of work) {
            onStage(step.cwd, step.paths, staged);
        }
    };

    const openNode = (node: FileNode): void => {
        onOpen(node.cwd, shownFile(node.item.entry));
    };

    const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLElement>): void => {
        if (
            event.nativeEvent.composedPath().some((node) => node instanceof HTMLElement && node.hasAttribute('data-tree-control')) ||
            event.key !== ' ' ||
            event.altKey ||
            event.metaKey ||
            event.ctrlKey
        ) {
            return;
        }
        const path = model.getFocusedPath();
        if (path !== null) {
            event.preventDefault();
            event.stopPropagation();
            toggleRows(menuTargetsOf(path, model.getSelectedPaths()));
        }
    };

    const openPath = (path: string): void => {
        const node = nodeOf(layout, path);
        if (isFile(node)) {
            openNode(node);
        }
    };

    const onDragStart = (path: string, _targets: readonly string[], event: DragEvent): void => {
        const node = nodeOf(layout, path);
        if (isFile(node) && node.group !== 'conflicts' && event.dataTransfer !== null) {
            event.dataTransfer.setData('text/plain', node.path);
            onDrag(node.cwd, shownFile(node.item.entry), event.dataTransfer);
        }
    };

    const renderControl = (row: FileTreeVisibleRow) => {
        const node = nodeOf(layout, row.path);
        if (node === undefined || node.group === 'conflicts') {
            return null;
        }
        const state = node.kind === 'file' ? checkOf(node.item.entry) : checkOfItems(node.items);
        return (
            <FileTree.Checkbox
                label={state === 'checked' ? t('git.list.unstage') : t('git.list.stage')}
                checked={state === 'checked'}
                indeterminate={state === 'mixed'}
                disabled={busy}
                onCheckedChange={() => toggleRows([row.path])}
            />
        );
    };

    const menuNodes = nodesOf(menuPaths);
    const manyTargets = menuNodes.length > 1;
    const single = manyTargets ? undefined : menuNodes[0];
    const menuItems = itemsOfNodes(menuNodes);
    const boxed = menuItems.filter((item) => item.entry.group !== 'conflicts');
    const toStage = boxed.filter((item) => item.entry.worktree !== null);
    const toUnstage = boxed.filter((item) => item.entry.staged !== null);
    const newFiles = menuItems.filter((item) => item.entry.group === 'unversioned');
    const stageAll = (items: readonly GitItem[], staged: boolean): void => {
        for (const [cwd, entries] of byCheckout(items)) {
            onStage(
                cwd,
                entries.map((entry) => entry.path),
                staged
            );
        }
    };
    const copyTargets = menuItems.map((item) => ({
        absolute: `${item.cwd}/${item.entry.path}`.replace(/\/+$/, ''),
        relative: item.entry.path,
        gone: isGone(item.entry)
    }));
    const singleKey = single !== undefined && single.kind !== 'file' ? single.key : null;
    /* A conflict is staged file by file, after it has been looked at, and only as resolved; a whole
       folder or a selection of them at once is not a thing to offer behind one click. */
    const stageItems = (
        <>
            {toStage.length > 0 && (
                <ContextMenu.Item disabled={busy} onClick={() => stageAll(toStage, true)}>
                    <Icon icon={Plus} size={14} />
                    {manyTargets ? t('git.list.stageMany', { count: toStage.length }) : single?.kind === 'file' ? t('git.list.stage') : t('git.list.stageHere')}
                </ContextMenu.Item>
            )}
            {toUnstage.length > 0 && (
                <ContextMenu.Item disabled={busy} onClick={() => stageAll(toUnstage, false)}>
                    <Icon icon={Minus} size={14} />
                    {manyTargets
                        ? t('git.list.unstageMany', { count: toUnstage.length })
                        : single?.kind === 'file'
                          ? t('git.list.unstage')
                          : t('git.list.unstageHere')}
                </ContextMenu.Item>
            )}
        </>
    );

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                className="min-h-0 grow overflow-hidden pt-1"
                onKeyDownCapture={onKeyDownCapture}
                onContextMenu={(event) => {
                    const row = rowPathOf(event);
                    setMenuPaths(row === null ? [] : menuTargetsOf(row, model.getSelectedPaths()));
                }}
            >
                <FileTree.Root
                    model={model}
                    className="h-full min-h-0"
                    label={t('shell:panel.names.git')}
                    resetKey={folder ?? ''}
                    onActivate={openPath}
                    onFocusMove={(path) => {
                        const node = nodeOf(layout, path);
                        if (isFile(node) && node.group !== 'conflicts') {
                            openNode(node);
                        }
                    }}
                    onRowDragStart={onDragStart}
                    onDragEnd={() => setDragging(null)}
                    renderControl={renderControl}
                    renderDecoration={decorate}
                />
            </ContextMenu.Trigger>
            <ContextMenu.Popup>
                {manyTargets && menuItems.length > 0 && (
                    <>
                        {stageItems}
                        {boxed.length > 0 && (
                            <ContextMenu.Item disabled={busy} onClick={() => onDiscard(workOf(boxed, shownFile))}>
                                <Icon icon={Trash2} size={14} /> {t('git.list.discardMany', { count: boxed.length })}
                            </ContextMenu.Item>
                        )}
                        {newFiles.length > 0 && (
                            <ContextMenu.Item disabled={busy} onClick={() => onDelete(workOf(newFiles, newFileOf))}>
                                <Icon icon={FileX} size={14} /> {t('git.list.deleteMany', { count: newFiles.length })}
                            </ContextMenu.Item>
                        )}
                        <ContextMenu.Separator />
                        <FileCopyRow targets={copyTargets} />
                    </>
                )}
                {single?.kind === 'file' && (
                    <>
                        <ContextMenu.Item onClick={() => openNode(single)}>
                            <Icon icon={FileDiff} size={14} /> {t('git.list.openChanges')}
                        </ContextMenu.Item>
                        <ContextMenu.Item disabled={isGone(single.item.entry)} onClick={() => onOpenFile(single.cwd, shownFile(single.item.entry))}>
                            <Icon icon={FileText} size={14} /> {t('file.tab.openItself')}
                        </ContextMenu.Item>
                        <ContextMenu.Separator />
                        {/* A conflict has no box: staging one says it is resolved, which is a choice
                            made on purpose, here. */}
                        {single.group === 'conflicts' && (
                            <ContextMenu.Item disabled={busy} onClick={() => onStage(single.cwd, [single.path], true)}>
                                <Icon icon={Plus} size={14} /> {t('git.list.stageResolved')}
                            </ContextMenu.Item>
                        )}
                        {stageItems}
                        {/* A conflict is resolved by staging it or by a merge tool; discarding one side of it
                            silently is the one way out that loses work nobody can name afterwards. */}
                        {single.group !== 'conflicts' && (
                            <ContextMenu.Item disabled={busy} onClick={() => onDiscard(workOf([single.item], shownFile))}>
                                <Icon icon={Trash2} size={14} /> {t('git.list.discard')}
                            </ContextMenu.Item>
                        )}
                        {single.group === 'unversioned' && (
                            <ContextMenu.Item disabled={busy} onClick={() => onDelete(workOf([single.item], newFileOf))}>
                                <Icon icon={FileX} size={14} /> {t('git.list.deleteFile')}
                            </ContextMenu.Item>
                        )}
                        <ContextMenu.Separator />
                        <RowPathItems
                            absolute={`${single.cwd}/${single.path}`}
                            relative={single.path}
                            folder={folder}
                            platform={platform}
                            gone={isGone(single.item.entry)}
                        />
                    </>
                )}
                {single?.kind === 'folder' && singleKey !== null && (
                    <>
                        <ContextMenu.Item onClick={() => useGit.getState().toggleDir(singleKey)}>
                            <Icon icon={collapsed.includes(singleKey) ? ChevronsUpDown : ChevronsDownUp} size={14} />
                            {collapsed.includes(singleKey) ? t('git.list.expandFolder') : t('git.list.collapseFolder')}
                        </ContextMenu.Item>
                        {stageItems}
                        <ContextMenu.Separator />
                        <RowPathItems absolute={`${single.cwd}/${single.path}`} relative={single.path} folder={folder} platform={platform} gone={false} />
                    </>
                )}
                {single?.kind === 'repo' && (
                    <>
                        {stageItems}
                        {boxed.length > 0 && <ContextMenu.Separator />}
                        <ContextMenu.Item onClick={() => useGit.getState().toggleRepo(single.label)}>
                            <Icon icon={EyeOff} size={14} /> {t('git.repo.hide')}
                        </ContextMenu.Item>
                        <ContextMenu.Separator />
                        <RowPathItems absolute={single.cwd} relative={single.label} folder={folder} platform={platform} gone={false} />
                    </>
                )}
                {single?.kind === 'group' && stageItems}
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

/* The two reveals and the copy row, which every row of the list offers for whatever it points at. */
function RowPathItems({
    absolute,
    relative,
    folder,
    platform,
    gone
}: {
    absolute: string;
    relative: string;
    folder: string | null;
    platform: string | null;
    gone: boolean;
}) {
    const { t } = useTranslation('panels');
    const transport = useTransport();
    return (
        <>
            <ContextMenu.Item disabled={gone || !revealableInFiles(folder, absolute)} onClick={() => useFiles.getState().revealInFiles(absolute)}>
                <Icon icon={Folder} size={14} /> {t('file.menu.revealInFiles')}
            </ContextMenu.Item>
            <ContextMenu.Item
                disabled={gone}
                onClick={() => {
                    revealFile(transport, absolute);
                }}
            >
                <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <FileCopyRow targets={[{ absolute, relative, gone }]} />
        </>
    );
}

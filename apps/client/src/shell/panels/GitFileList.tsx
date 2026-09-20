import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import type { FileTree as FileTreeModel, FileTreeRowDecoration, FileTreeRowDecorationContext, FileTreeVisibleRow } from '@pierre/trees';
import { FileTree, useFileTree, useFileTreeSelector } from '@pierre/trees/react';
import { ChevronsDownUp, ChevronsUpDown, Copy, CornerUpRight, FileDiff, FileText, Folder, GitBranch, Minus, Plus, Trash2 } from 'lucide-react';
import type { GitFile, GitFileState, GitStatus } from '@ruimte/contracts';
import { GIT_GROUP } from '@/shell/panels/classes';
import { revealableInFiles } from '@/shell/panels/files-tree';
import { dirPathOf, expansionChanges, mergeCollapsedPaths, pathsUnder, statusColor, type GitTreeRow } from '@/shell/panels/git-tree';
import { directoryHandle, rowPathOf, PANEL_TREE_CSS, PANEL_TREE_ROW_HEIGHT } from '@/shell/panels/panel-tree';
import { useFiles } from '@/state/files';
import { useGit } from '@/state/git';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { MENU_SEPARATOR, SECTION_LABEL } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { FILE_TREE_ICONS } from '@/ui/file-icon';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { PanelEmpty } from '@/ui/PanelEmpty';

/* The groups in the order a person acts on them; each one reads its heading out of `git.group`. */
const GROUPS: readonly GitFileState[] = ['conflicted', 'staged', 'unstaged', 'untracked'];

/* Opening a folder brings rows into view that may have to fold up in turn, so folding settles over
   a few passes; a tree that never settles stops here rather than looping. */
const EXPANSION_PASSES = 32;

/* The tree draws inside a shadow root, which a custom property reaches and a utility class does not. */
const ADDED_COLOR = 'var(--color-term-green)';
const DELETED_COLOR = 'var(--color-term-red)';

interface DecorationPart {
    text: string;
    color?: string;
}

/*
 * This panel's own rules, over the shared ones. Every row here is a change, so the news rides on
 * the lane at the end and a name keeps the panel's color; the tree left to itself paints every name
 * and icon in its status. The lane is counts, so it is set in the mono face at the floor this app
 * puts under type, which keeps a column of them straight and a step behind the names. It keeps its
 * width and the name gives way, since a count cut in half reads as another number.
 */
const GIT_TREE_CSS = `
    ${PANEL_TREE_CSS}
    [data-item-section="content"] { flex: 1 1 auto; }
    [data-item-section="decoration"] { flex: none; font-family: var(--font-mono); font-size: 12px; }
    [data-item-section="decoration"] > span { display: inline-flex; gap: 6px; align-items: center; }
`;

/* A file git no longer has on disk: opening it or revealing it would point at nothing. */
const isGone = (file: GitFile): boolean => file.status.startsWith('D');

/* The absolute path of a row on the daemon's machine, which is what reveal and copy take. */
const absolutePathOf = (root: string | null, path: string): string => (root === null ? path : `${root}/${path}`);

/* A chain of folders nothing branches in is one row, which stands for the deepest of them. */
const pathOfRow = (row: FileTreeVisibleRow): string =>
    row.isFlattened ? (row.flattenedSegments?.findLast((segment) => segment.isTerminal)?.path ?? row.path) : row.path;

/* Every row the tree shows, which is every row but the ones a folded folder holds. */
const visibleRows = (model: FileTreeModel): GitTreeRow[] =>
    model.getVisibleRows(0, model.getVisibleCount()).map((row) => ({ path: pathOfRow(row), kind: row.kind, isExpanded: row.isExpanded }));

/* Folds the tree the way the collapse set says. */
const applyExpansion = (model: FileTreeModel, collapsed: ReadonlySet<string>): void => {
    for (let pass = 0; pass < EXPANSION_PASSES; pass++) {
        const { collapse, expand } = expansionChanges(visibleRows(model), collapsed);
        if (collapse.length === 0 && expand.length === 0) {
            return;
        }
        for (const path of collapse) {
            directoryHandle(model, path)?.collapse();
        }
        for (const path of expand) {
            directoryHandle(model, path)?.expand();
        }
    }
};

interface ListProps {
    status: GitStatus | null;
    collapsed: string[];
    /* The path of the change the preview has open, which is the row that reads as selected. */
    reading: string | null;
    busy: boolean;
    onOpen(file: GitFile): void;
    /* The file itself rather than its diff, in a tab of its own. */
    onOpenFile(file: GitFile): void;
    onStage(paths: string[], staged: boolean): void;
    onDiscard(file: GitFile): void;
}

/*
 * The changed files, grouped the way a person acts on them: conflicts first, then the index, then
 * the working tree, then what git has never seen. Every group is a tree of the folders its files
 * sit in, the same tree the Files panel draws, so a path reads the same on both sides of the
 * window. A row opens its diff in the preview panel; a right click stages it, discards it behind a
 * confirm, and offers the things a row has no room for: the file itself, the two reveals, the paths.
 */
export function GitFileList({ status, collapsed, reading, busy, onOpen, onOpenFile, onStage, onDiscard }: ListProps) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const folder = useProject((s) => s.current?.folder ?? null);

    if (status === null) {
        return <div className="grid min-h-0 grow place-items-center" />;
    }
    if (!status.repo) {
        return <PanelEmpty icon={GitBranch}>{t('git.list.noRepo')}</PanelEmpty>;
    }
    if (status.files.length === 0) {
        return <PanelEmpty icon={GitBranch}>{t('git.list.noChanges')}</PanelEmpty>;
    }
    return (
        <div className="min-h-0 grow overflow-y-auto py-1">
            {GROUPS.map((state) => {
                const files = status.files.filter((file) => file.state === state);
                if (files.length === 0) {
                    return null;
                }
                return (
                    <GitGroup
                        key={state}
                        label={t(`git.group.${state}`)}
                        state={state}
                        files={files}
                        root={status.root}
                        folder={folder}
                        platform={platform}
                        collapsed={collapsed}
                        reading={reading}
                        busy={busy}
                        onOpen={onOpen}
                        onOpenFile={onOpenFile}
                        onStage={onStage}
                        onDiscard={onDiscard}
                    />
                );
            })}
            {status.truncated && <p className="px-3 py-2 text-xs text-text-faint">{t('diff.moreFiles')}</p>}
        </div>
    );
}

interface GroupProps extends Omit<ListProps, 'status'> {
    label: string;
    state: GitFileState;
    files: GitFile[];
    root: string | null;
    folder: string | null;
    platform: string | null;
}

/*
 * One group as a tree of its own. The trees share the folded-up folders and nothing else: a folder
 * that is staged and changed again is one folder to a person, so closing it in one group closes it
 * in the other. Each tree is exactly as tall as its rows, so the four of them scroll as one list.
 */
function GitGroup({ label, state, files, root, folder, platform, collapsed, reading, busy, onOpen, onOpenFile, onStage, onDiscard }: GroupProps) {
    const { t } = useTranslation('panels');
    const staged = state === 'staged';
    const conflicted = state === 'conflicted';
    const [menuPath, setMenuPath] = useState<string | null>(null);
    const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
    const filesRef = useRef<ReadonlyMap<string, GitFile>>(new Map());
    const collapsedRef = useRef<ReadonlySet<string>>(new Set());
    /* Set while this component folds the tree, so the folding is not read back as a person's doing. */
    const applyingRef = useRef(false);

    /* The tree keeps the renderer it was made with, so this reads the files of the moment. */
    const decorate = useCallback(({ item }: FileTreeRowDecorationContext): FileTreeRowDecoration | null => {
        if (item.kind === 'directory') {
            const prefix = item.path.endsWith('/') ? item.path : `${item.path}/`;
            const count = [...filesRef.current.keys()].filter((path) => path.startsWith(prefix)).length;
            return count === 0 ? null : { text: String(count) };
        }
        const file = filesRef.current.get(item.path);
        if (file === undefined) {
            return null;
        }
        const parts: DecorationPart[] = [];
        if (file.added > 0) {
            parts.push({ text: `+${file.added}`, color: ADDED_COLOR });
        }
        if (file.deleted > 0) {
            parts.push({ text: `-${file.deleted}`, color: DELETED_COLOR });
        }
        parts.push({ text: file.status, color: statusColor(file.status) });
        return { text: parts.map((part) => part.text).join(' '), parts };
    }, []);

    const { model } = useFileTree({
        paths: [],
        composition: { contextMenu: { enabled: false } },
        density: 'compact',
        itemHeight: PANEL_TREE_ROW_HEIGHT,
        dragAndDrop: false,
        flattenEmptyDirectories: true,
        icons: FILE_TREE_ICONS,
        initialExpansion: 'open',
        renderRowDecoration: decorate,
        search: false,
        stickyFolders: false,
        unsafeCSS: GIT_TREE_CSS
    });

    const rowCount = useFileTreeSelector(model, (current) => current.getVisibleCount());
    /* The paths the tree was last built from: a status arrives every few seconds, and rebuilding a
       tree that did not change would throw away which folders stand folded. */
    const builtRef = useRef('');

    useEffect(() => {
        filesRef.current = byPath;
        collapsedRef.current = new Set(collapsed);
    }, [byPath, collapsed]);

    useEffect(() => {
        const paths = files.map((file) => file.path);
        const key = paths.join('\n');
        if (builtRef.current === key) {
            return;
        }
        builtRef.current = key;
        applyingRef.current = true;
        model.resetPaths(paths);
        applyExpansion(model, collapsedRef.current);
        applyingRef.current = false;
    }, [files, model]);

    useEffect(() => {
        applyingRef.current = true;
        applyExpansion(model, new Set(collapsed));
        applyingRef.current = false;
    }, [collapsed, model]);

    /*
     * The tree reports a fold nowhere, so every change of its own is the moment to read back which
     * folders stand closed. It only answers for the folders it shows: the set is shared, and one
     * group has nothing to say about a folder that changed in another.
     */
    useEffect(
        () =>
            model.subscribe(() => {
                if (applyingRef.current) {
                    return;
                }
                const current = useGit.getState().collapsedDirs;
                const next = mergeCollapsedPaths(current, visibleRows(model));
                if (next !== current) {
                    useGit.getState().setCollapsedDirs(next);
                }
            }),
        [model]
    );

    /* The tree follows the preview: the file whose diff is open is the row that reads as selected. */
    useEffect(() => {
        for (const path of model.getSelectedPaths()) {
            model.getItem(path)?.deselect();
        }
        if (reading !== null) {
            model.getItem(reading)?.select();
        }
    }, [files, model, reading]);

    const onClick = (event: ReactMouseEvent<HTMLElement>): void => {
        const path = rowPathOf(event);
        const file = path === null ? undefined : byPath.get(path);
        if (file !== undefined) {
            onOpen(file);
        }
    };

    const menuFile = menuPath === null ? undefined : byPath.get(menuPath);
    const menuDir = menuFile === undefined && menuPath !== null ? dirPathOf(menuPath) : null;
    const height = rowCount * model.getItemHeight();

    return (
        <section>
            <header className={GIT_GROUP}>
                <span className={SECTION_LABEL}>{label}</span>
                <span className="tabular-nums text-text-faint">{files.length}</span>
                <span className="grow" />
                {!conflicted && (
                    <Tooltip label={staged ? t('git.list.unstageGroup', { group: label }) : t('git.list.stageGroup', { group: label })} name>
                        <button
                            className="icon-btn h-6 w-6"
                            disabled={busy}
                            onClick={() =>
                                onStage(
                                    files.map((file) => file.path),
                                    !staged
                                )
                            }
                        >
                            <Icon icon={staged ? Minus : Plus} size={12} />
                        </button>
                    </Tooltip>
                )}
            </header>
            <ContextMenu.Root>
                <ContextMenu.Trigger render={<div />} style={{ height }} onContextMenu={(event) => setMenuPath(rowPathOf(event))}>
                    <FileTree model={model} className="panel-tree" onClick={onClick} />
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                    <ContextMenu.Positioner className="z-(--z-popup)">
                        <ContextMenu.Popup className="menu-popup">
                            {menuFile !== undefined && (
                                <>
                                    <ContextMenu.Item className="menu-item" onClick={() => onOpen(menuFile)}>
                                        <Icon icon={FileDiff} size={14} /> {t('git.list.openChanges')}
                                    </ContextMenu.Item>
                                    <ContextMenu.Item className="menu-item" disabled={isGone(menuFile)} onClick={() => onOpenFile(menuFile)}>
                                        <Icon icon={FileText} size={14} /> {t('file.tab.openItself')}
                                    </ContextMenu.Item>
                                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                                    <ContextMenu.Item className="menu-item" disabled={busy} onClick={() => onStage([menuFile.path], !staged)}>
                                        <Icon icon={staged ? Minus : Plus} size={14} />
                                        {staged ? t('git.list.unstage') : conflicted ? t('git.list.stageResolved') : t('git.list.stage')}
                                    </ContextMenu.Item>
                                    {/* A conflict is resolved by staging it or by a merge tool; discarding one side of it
                                        silently is the one way out that loses work nobody can name afterwards. */}
                                    {!conflicted && (
                                        <ContextMenu.Item className="menu-item" disabled={busy} onClick={() => onDiscard(menuFile)}>
                                            <Icon icon={Trash2} size={14} /> {t('git.list.discard')}
                                        </ContextMenu.Item>
                                    )}
                                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                                    <RowPathItems
                                        absolute={absolutePathOf(root, menuFile.path)}
                                        relative={menuFile.path}
                                        folder={folder}
                                        platform={platform}
                                        gone={isGone(menuFile)}
                                    />
                                </>
                            )}
                            {menuDir !== null && (
                                <>
                                    <ContextMenu.Item className="menu-item" onClick={() => useGit.getState().toggleDir(menuDir)}>
                                        <Icon icon={collapsed.includes(menuDir) ? ChevronsUpDown : ChevronsDownUp} size={14} />
                                        {collapsed.includes(menuDir) ? t('git.list.expandFolder') : t('git.list.collapseFolder')}
                                    </ContextMenu.Item>
                                    {/* A conflict is staged file by file, after it has been looked at; a whole
                                        folder of them at once is not a thing to offer behind one click. */}
                                    {!conflicted && (
                                        <ContextMenu.Item className="menu-item" disabled={busy} onClick={() => onStage(pathsUnder(files, menuDir), !staged)}>
                                            <Icon icon={staged ? Minus : Plus} size={14} /> {staged ? t('git.list.unstageHere') : t('git.list.stageHere')}
                                        </ContextMenu.Item>
                                    )}
                                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                                    <RowPathItems
                                        absolute={absolutePathOf(root, menuDir)}
                                        relative={menuDir}
                                        folder={folder}
                                        platform={platform}
                                        gone={false}
                                    />
                                </>
                            )}
                        </ContextMenu.Popup>
                    </ContextMenu.Positioner>
                </ContextMenu.Portal>
            </ContextMenu.Root>
        </section>
    );
}

/* The two reveals and the two paths, which every row of the list offers for whatever it points at. */
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
            <ContextMenu.Item
                className="menu-item"
                disabled={gone || !revealableInFiles(folder, absolute)}
                onClick={() => useFiles.getState().revealInFiles(absolute)}
            >
                <Icon icon={Folder} size={14} /> {t('file.menu.revealInFiles')}
            </ContextMenu.Item>
            <ContextMenu.Item
                className="menu-item"
                disabled={gone}
                onClick={() => {
                    void transport.request('fs.reveal', { path: absolute }).catch(() => undefined);
                }}
            >
                <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
            </ContextMenu.Item>
            <ContextMenu.Separator className={MENU_SEPARATOR} />
            <ContextMenu.Item className="menu-item" onClick={() => copyText(absolute)}>
                <Icon icon={Copy} size={14} /> {t('file.menu.copyPath')}
            </ContextMenu.Item>
            <ContextMenu.Item className="menu-item" onClick={() => copyText(relative)}>
                <Icon icon={Copy} size={14} /> {t('file.menu.copyRelativePath')}
            </ContextMenu.Item>
        </>
    );
}

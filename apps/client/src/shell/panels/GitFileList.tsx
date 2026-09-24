import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import type { FileTree as FileTreeModel, FileTreeRowDecoration, FileTreeRowDecorationContext, FileTreeVisibleRow } from '@pierre/trees';
import { FileTree, useFileTree, useFileTreeSelector } from '@pierre/trees/react';
import {
    AtSign,
    Boxes,
    ChevronsDownUp,
    ChevronsUpDown,
    Copy,
    CornerUpRight,
    EyeOff,
    FileDiff,
    FileText,
    Folder,
    FolderGit2,
    GitBranch,
    Minus,
    Plus,
    Trash2
} from 'lucide-react';
import type { GitFile, GitFileState } from '@ruimte/contracts';
import { GIT_GROUP, GIT_REPO } from '@/shell/panels/classes';
import { mentionOf, revealableInFiles } from '@/shell/panels/files-tree';
import {
    allDirs,
    branchesUnder,
    collapseKey,
    dirPathOf,
    expansionChanges,
    mergeCollapsedPaths,
    pathsUnder,
    statusColor,
    type GitTreeRow
} from '@/shell/panels/git-tree';
import { directoryHandle, rowPathOf, PANEL_TREE_CSS, PANEL_TREE_ROW_HEIGHT } from '@/shell/panels/panel-tree';
import { useFiles } from '@/state/files';
import { useGit } from '@/state/git';
import type { GitCheckout } from '@/state/git-repos';
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
const applyExpansion = (model: FileTreeModel, collapsed: ReadonlySet<string>, scope: string): void => {
    for (let pass = 0; pass < EXPANSION_PASSES; pass++) {
        const { collapse, expand } = expansionChanges(visibleRows(model), collapsed, scope);
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

/* The changes of one checkout in one group. */
interface Section {
    checkout: GitCheckout;
    files: GitFile[];
}

interface ListProps {
    checkouts: readonly GitCheckout[];
    collapsed: string[];
    /* The change the preview has open and the checkout it belongs to, so that list marks the row. */
    reading: { cwd: string; path: string } | null;
    /* Set when the folder holds more repositories than the panel was given. */
    reposTruncated: boolean;
    busy: boolean;
    onOpen(cwd: string, file: GitFile): void;
    /* The file itself rather than its diff, in a tab of its own. */
    onOpenFile(cwd: string, file: GitFile): void;
    onStage(cwd: string, paths: string[], staged: boolean): void;
    onDiscard(cwd: string, file: GitFile): void;
}

/*
 * The changed files, grouped the way a person acts on them: conflicts first, then the index, then
 * the working tree, then what git has never seen. A group holds a tree per repository, each of the
 * folders its files sit in, the same tree the Files panel draws, so a path reads the same on both
 * sides of the window. A folder with one repository has no row for it and reads as it always did.
 * A row opens its diff in the preview panel; a right click stages it, discards it behind a confirm,
 * and offers the things a row has no room for: the file itself, the two reveals, the paths.
 */
export function GitFileList({ checkouts, collapsed, reading, reposTruncated, busy, onOpen, onOpenFile, onStage, onDiscard }: ListProps) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const folder = useProject((s) => s.current?.folder ?? null);

    const read = checkouts.filter((checkout) => checkout.status !== null);
    if (checkouts.length === 0 || (read.length > 0 && read.every((checkout) => checkout.status?.repo !== true))) {
        return <PanelEmpty icon={GitBranch}>{t('git.list.noRepo')}</PanelEmpty>;
    }
    if (read.length === 0) {
        return <div className="grid min-h-0 grow place-items-center" />;
    }
    const changes = read.reduce((count, checkout) => count + (checkout.status?.files.length ?? 0), 0);
    if (changes === 0) {
        return <PanelEmpty icon={GitBranch}>{t('git.list.noChanges')}</PanelEmpty>;
    }

    /* A folder with one repository names none: the row would say what the header already says. */
    const named = checkouts.length > 1;
    const truncated = reposTruncated || read.some((checkout) => checkout.status?.truncated === true);

    return (
        <div className="min-h-0 grow overflow-y-auto py-1">
            {GROUPS.map((state) => {
                const sections: Section[] = checkouts
                    .map((checkout) => ({ checkout, files: (checkout.status?.files ?? []).filter((file) => file.state === state) }))
                    .filter((section) => section.files.length > 0);
                if (sections.length === 0) {
                    return null;
                }
                const label = t(`git.group.${state}`);
                const count = sections.reduce((sum, section) => sum + section.files.length, 0);
                const staged = state === 'staged';
                return (
                    <section key={state}>
                        <header className={GIT_GROUP}>
                            <span className={SECTION_LABEL}>{label}</span>
                            <span className="tabular-nums text-text-faint">{count}</span>
                            <span className="grow" />
                            {state !== 'conflicted' && (
                                <Tooltip label={staged ? t('git.list.unstageGroup', { group: label }) : t('git.list.stageGroup', { group: label })} name>
                                    <button
                                        className="icon-btn h-6 w-6"
                                        disabled={busy}
                                        onClick={() => {
                                            for (const section of sections) {
                                                onStage(
                                                    section.checkout.path,
                                                    section.files.map((file) => file.path),
                                                    !staged
                                                );
                                            }
                                        }}
                                    >
                                        <Icon icon={staged ? Minus : Plus} size={12} />
                                    </button>
                                </Tooltip>
                            )}
                        </header>
                        {sections.map(({ checkout, files }) => (
                            <GitRepoTree
                                key={checkout.path}
                                state={state}
                                checkout={checkout}
                                files={files}
                                named={named}
                                folder={folder}
                                platform={platform}
                                collapsed={collapsed}
                                reading={reading?.cwd === checkout.path ? reading.path : null}
                                busy={busy}
                                onOpen={(file) => onOpen(checkout.path, file)}
                                onOpenFile={(file) => onOpenFile(checkout.path, file)}
                                onStage={(paths, next) => onStage(checkout.path, paths, next)}
                                onDiscard={(file) => onDiscard(checkout.path, file)}
                            />
                        ))}
                    </section>
                );
            })}
            {truncated && <p className="px-3 py-2 text-xs text-text-faint">{t('diff.moreFiles')}</p>}
        </div>
    );
}

/* The mark a repository row carries: a module git tracks for the project reads apart from one that
   only happens to sit beside it. */
const REPO_ICONS = { root: FolderGit2, nested: FolderGit2, submodule: Boxes, worktree: GitBranch } as const;

interface TreeProps {
    state: GitFileState;
    checkout: GitCheckout;
    files: GitFile[];
    /* Whether the repository gets a row of its own above its tree. */
    named: boolean;
    folder: string | null;
    platform: string | null;
    collapsed: string[];
    reading: string | null;
    busy: boolean;
    onOpen(file: GitFile): void;
    onOpenFile(file: GitFile): void;
    onStage(paths: string[], staged: boolean): void;
    onDiscard(file: GitFile): void;
}

/*
 * One repository's share of one group, as a tree of its own. The trees share the folded-up folders
 * and nothing else: a folder that is staged and changed again is one folder to a person, so closing
 * it in one group closes it in the other, while the same folder name in another repository stays its
 * own. Each tree is exactly as tall as its rows, so all of them scroll as one list.
 */
function GitRepoTree({ state, checkout, files, named, folder, platform, collapsed, reading, busy, onOpen, onOpenFile, onStage, onDiscard }: TreeProps) {
    const { t } = useTranslation('panels');
    const staged = state === 'staged';
    const conflicted = state === 'conflicted';
    const root = checkout.path;
    /* While the folder holds one repository the folds are keyed as they always were. */
    const scope = named ? checkout.label : '';
    const [menuPath, setMenuPath] = useState<string | null>(null);
    const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
    const filesRef = useRef<ReadonlyMap<string, GitFile>>(new Map());
    const collapsedRef = useRef<ReadonlySet<string>>(new Set());
    const scopeRef = useRef(scope);
    /* Set while this component folds the tree, so the folding is not read back as a person's doing. */
    const applyingRef = useRef(false);
    /* The collapse set the tree last stood by, to tell which folders just folded. */
    const foldedRef = useRef<readonly string[] | null>(null);

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
        scopeRef.current = scope;
    }, [byPath, collapsed, scope]);

    useEffect(() => {
        const paths = files.map((file) => file.path);
        const key = paths.join('\n');
        if (builtRef.current === key) {
            return;
        }
        builtRef.current = key;
        applyingRef.current = true;
        model.resetPaths(paths);
        applyExpansion(model, collapsedRef.current, scopeRef.current);
        applyingRef.current = false;
    }, [files, model]);

    useEffect(() => {
        const before = foldedRef.current;
        foldedRef.current = collapsed;
        const branches = before === null ? [] : branchesUnder(before, collapsed, allDirs([...filesRef.current.values()]), scope);
        applyingRef.current = true;
        for (const dir of branches) {
            directoryHandle(model, dir)?.collapse();
        }
        applyExpansion(model, new Set(collapsed), scope);
        applyingRef.current = false;
        if (branches.length === 0) {
            return;
        }
        const current = useGit.getState().collapsedDirs;
        const added = branches.map((dir) => collapseKey(scope, dir)).filter((key) => !current.includes(key));
        if (added.length > 0) {
            useGit.getState().setCollapsedDirs([...current, ...added]);
        }
    }, [collapsed, scope, model]);

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
                const next = mergeCollapsedPaths(current, visibleRows(model), scopeRef.current);
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
    const menuDirKey = menuDir === null ? null : scope === '' ? menuDir : `${scope}/${menuDir}`;
    const height = rowCount * model.getItemHeight();

    return (
        <>
            {named && (
                <div className={GIT_REPO}>
                    <ContextMenu.Root>
                        <ContextMenu.Trigger
                            render={
                                <span className="flex min-w-0 items-center gap-1.5">
                                    <Icon icon={REPO_ICONS[checkout.kind]} size={12} className="shrink-0 text-text-faint" />
                                    <span className="truncate text-text-muted">{checkout.label}</span>
                                </span>
                            }
                        />
                        <ContextMenu.Portal>
                            <ContextMenu.Positioner className="z-(--z-popup)">
                                <ContextMenu.Popup className="menu-popup">
                                    <ContextMenu.Item className="menu-item" onClick={() => useGit.getState().toggleRepo(checkout.label)}>
                                        <Icon icon={EyeOff} size={14} /> {t('git.repo.hide')}
                                    </ContextMenu.Item>
                                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                                    <RowPathItems absolute={root} relative={checkout.label} folder={folder} platform={platform} gone={false} />
                                </ContextMenu.Popup>
                            </ContextMenu.Positioner>
                        </ContextMenu.Portal>
                    </ContextMenu.Root>
                    <span className="grow" />
                    <span className="tabular-nums text-text-faint">{files.length}</span>
                    {!conflicted && (
                        <Tooltip label={staged ? t('git.repo.unstageAll', { repo: checkout.label }) : t('git.repo.stageAll', { repo: checkout.label })} name>
                            <button
                                className="icon-btn h-5 w-5"
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
                </div>
            )}
            <ContextMenu.Root>
                <ContextMenu.Trigger render={<div />} style={{ height }} onContextMenu={(event) => setMenuPath(rowPathOf(event))}>
                    <FileTree model={model} className={clsx('panel-tree', named && 'panel-tree-indented')} onClick={onClick} />
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
                            {menuDir !== null && menuDirKey !== null && (
                                <>
                                    <ContextMenu.Item className="menu-item" onClick={() => useGit.getState().toggleDir(menuDirKey)}>
                                        <Icon icon={collapsed.includes(menuDirKey) ? ChevronsUpDown : ChevronsDownUp} size={14} />
                                        {collapsed.includes(menuDirKey) ? t('git.list.expandFolder') : t('git.list.collapseFolder')}
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
        </>
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
    // A file that is gone is nothing to point a chat at.
    const mention = gone ? null : mentionOf(folder, absolute);
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
            {mention !== null && (
                <ContextMenu.Item className="menu-item" onClick={() => copyText(mention)}>
                    <Icon icon={AtSign} size={14} /> {t('file.menu.copyMention')}
                </ContextMenu.Item>
            )}
        </>
    );
}

import { performAsPerson } from '@/actions/client-actions';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type DragEvent as ReactDragEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';
import { FileTree, useFileTree } from '@pierre/trees/react';
import {
    AtSign,
    ChevronsDownUp,
    ChevronsUpDown,
    Columns2,
    Copy,
    CornerUpRight,
    FileDiff,
    FileSearch,
    Folder,
    FolderOpen,
    Frame,
    MoreHorizontal,
    RefreshCw,
    Search,
    Trash2
} from 'lucide-react';
import { PATHS_DRAG_TYPE } from '@/canvas/drop';
import { MENTION_DRAG_TYPE } from '@ruimte/agents-react/chat/mentions';
import { createViewAction } from '@/actions/client-actions';
import { showFileOnCanvas } from '@/project/views';
import { FILE_TOOLBAR } from '@/shell/panels/classes';
import {
    LOADING_NAME,
    absoluteOf,
    ancestorDirsOf,
    basenameOf,
    buildTreeInput,
    compareRows,
    gitStatusEntries,
    isDirectoryPath,
    mentionOf,
    mergeExpanded,
    newlyExpanded,
    relativeTo,
    treePathOf,
    withoutClosedBranches,
    type EntryCache
} from '@/shell/panels/files-tree';
import {
    directoryHandle,
    extendsSelection,
    followFocus,
    menuTargetsOf,
    movesFocus,
    resetExpandedPaths,
    rowPathOf,
    PANEL_TREE_CSS,
    PANEL_TREE_ROW_HEIGHT
} from '@/shell/panels/panel-tree';
import { hasActiveCanvas, useDocument } from '@/state/document';
import { useFiles } from '@/state/files';
import { folderWatches } from '@/state/fs-watch';
import { useGit } from '@/state/git';
import { useEndpointId } from '@/state/keys';
import { useGitStatus } from '@/state/git-watch';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { fileManagerName, useServer } from '@/state/server';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { useTransport } from '@/transport/context';
import { copyText, EmptyState, FILE_TREE_ICONS, Icon, IconButton, Input, Menu, Kbd, PanelEmpty, ContextMenu, PromptDialog } from '@basmilius/desktop-ui';
import { APP_SHORTCUTS } from '@/shell/shortcuts';

const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_LIMIT = 200;

/*
 * Two rules of this panel's own, over the shared ones. The first hides the row that keeps an
 * unloaded directory's chevron. The second turns the letter the git lane draws into a dot, in the
 * color the lane already carries: a directory with changes under it gets a dot of the tree's own,
 * so one shape says "this differs from HEAD" everywhere in the panel. An ignored file leaves that
 * lane empty, which is why it is left out.
 */
const FILES_TREE_CSS = `
    [data-item-path$="/${LOADING_NAME}"] { display: none !important; }
    [data-item-git-status]:not([data-item-git-status="ignored"]) > [data-item-section="git"] > * { display: none; }
    [data-item-git-status]:not([data-item-git-status="ignored"]) > [data-item-section="git"]::after {
        content: "";
        width: 6px;
        height: 6px;
        border-radius: 9999px;
        background: currentColor;
    }
    ${PANEL_TREE_CSS}
`;

const EMPTY_CACHE: EntryCache = new Map();

/*
 * The folder of the open project as a tree; the file it opens is drawn by the preview panel next to
 * it. Directories are listed one at a time: the first `fs.list` is the folder itself, and every
 * expand asks for what it opened. The daemon watches the folder while the panel is up, so a file an
 * agent writes shows up on its own.
 */
export function FilesPanel() {
    const { t } = useTranslation('panels');
    const folder = useProject((s) => s.current?.folder ?? null);
    const onCanvas = useDocument(hasActiveCanvas);
    const platform = useServer((s) => s.platform);
    const showHidden = useSettings((s) => s.filesShowHidden);
    const endpointId = useEndpointId();
    /* Which file the preview has up; a diff tab points at the same file and counts as well. */
    const activeFile = useFiles((s) => s.tabs.find((tab) => tab.key === s.active)?.path ?? null);
    const tabLimit = useSettings((s) => s.filesTabLimit);
    const transport = useTransport();
    /* What git says about the project folder, so a changed file carries a dot. The git panel reads
       the same watch; whichever of the two is up holds it. */
    const gitStatus = useGitStatus(folder);

    /* The listings carry the folder they belong to, so a project switch drops them without an
       effect that would render twice to empty the tree. */
    const [listed, setListed] = useState<{ folder: string | null; byDir: EntryCache }>({ folder: null, byDir: EMPTY_CACHE });
    const [query, setQuery] = useState('');
    const [matches, setMatches] = useState<readonly string[]>([]);
    const cacheRef = useRef<EntryCache>(EMPTY_CACHE);
    const expandedRef = useRef<ReadonlySet<string>>(new Set());
    const directoriesRef = useRef<ReadonlySet<string>>(new Set());
    const resettingRef = useRef(false);
    const selectionRef = useRef<readonly string[]>([]);
    /* The file the tree last followed the preview to, so a click of the person's own is never undone. */
    const revealedRef = useRef<string | null>(null);
    const [menuPath, setMenuPath] = useState<string | null>(null);
    /* The rows the open context menu acts on: one, or the whole selection when the row is part of one. */
    const [menuTargets, setMenuTargets] = useState<string[]>([]);
    const [deleting, setDeleting] = useState<{ absolutes: string[]; directory: boolean } | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    /* The reveal that was answered, so a listing arriving later does not scroll the tree again. */
    const answeredReveal = useRef(0);
    const cache = listed.folder === folder ? listed.byDir : EMPTY_CACHE;
    const reveal = useFiles((s) => s.reveal);

    const { model } = useFileTree({
        paths: [],
        composition: { contextMenu: { enabled: false } },
        density: 'compact',
        itemHeight: PANEL_TREE_ROW_HEIGHT,
        dragAndDrop: { canDrag: () => true, canDrop: () => false },
        flattenEmptyDirectories: false,
        icons: FILE_TREE_ICONS,
        initialExpansion: 'closed',
        onSelectionChange: (paths) => {
            selectionRef.current = paths;
        },
        search: false,
        sort: compareRows,
        unsafeCSS: FILES_TREE_CSS
    });

    /* A search answers with paths and nothing else, so it gets a model of its own: lazy loading and
       a flat result list would otherwise fight over the same rows. */
    const { model: searchModel } = useFileTree({
        paths: [],
        composition: { contextMenu: { enabled: false } },
        density: 'compact',
        itemHeight: PANEL_TREE_ROW_HEIGHT,
        dragAndDrop: { canDrag: () => true, canDrop: () => false },
        icons: FILE_TREE_ICONS,
        initialExpansion: 'open',
        onSelectionChange: (paths) => {
            selectionRef.current = paths;
        },
        search: false,
        sort: compareRows,
        unsafeCSS: FILES_TREE_CSS
    });

    const searching = query.trim() !== '';
    const activeModel = searching ? searchModel : model;
    /* The rows the tree is fed, kept here as well because what they add up to is what says whether
       the panel has anything to show. */
    const treeInput = useMemo(() => buildTreeInput(folder ?? '', cache, showHidden), [cache, folder, showHidden]);
    const changed = useMemo(() => (folder === null ? [] : gitStatusEntries(folder, gitStatus?.root ?? null, gitStatus?.files ?? [])), [folder, gitStatus]);
    /* Which side of git the row the menu is on sits on, or null for a file git has nothing to say
       about; it is what decides whether that menu offers the diff. */
    const changedStatus = useMemo(() => {
        const root = gitStatus?.root ?? null;
        if (folder === null || menuPath === null || root === null || isDirectoryPath(menuPath)) {
            return null;
        }
        const repoPath = relativeTo(root, absoluteOf(folder, menuPath));
        return gitStatus?.files.find((file) => file.path === repoPath)?.state ?? null;
    }, [folder, gitStatus, menuPath]);

    const load = useCallback(
        async (dir: string): Promise<void> => {
            try {
                // Always with the hidden entries: the eye button then rebuilds from the cache alone.
                const result = await performAsPerson('file.list', { path: dir, hidden: true });
                setListed((current) => ({ folder, byDir: new Map(current.folder === folder ? current.byDir : []).set(dir, result.entries) }));
            } catch {
                // A folder that went away keeps the rows it had until the next refresh.
            }
        },
        [folder]
    );

    useEffect(() => {
        cacheRef.current = cache;
    }, [cache]);

    useEffect(() => {
        // What the project remembered is where the tree starts, and what it has to fetch to get there.
        expandedRef.current = new Set(useFiles.getState().expandedDirs);
        if (!folder) {
            return;
        }
        const loadAll = (): void => {
            const dirs = new Set([folder, ...[...expandedRef.current].map((dir) => absoluteOf(folder, dir)), ...cacheRef.current.keys()]);
            for (const dir of dirs) {
                void load(dir);
            }
        };
        // The watch goes up before the first listing, so a write in between is reported, not missed.
        const watch = folderWatches.watch(endpointId, folder, loadAll);
        void watch.ready.then(loadAll);
        return watch.release;
    }, [endpointId, folder, load]);

    useEffect(() => {
        if (!folder) {
            return;
        }
        return transport.on('fs.changed', (payload) => {
            for (const path of payload.paths) {
                if (cacheRef.current.has(path)) {
                    void load(path);
                }
            }
        });
    }, [transport, folder, load]);

    useEffect(() => {
        if (!folder) {
            return;
        }
        directoriesRef.current = new Set(
            [...cache.values()].flatMap((entries) => entries.filter((entry) => entry.kind === 'directory').map((entry) => treePathOf(folder, entry)))
        );
        resettingRef.current = true;
        try {
            resetExpandedPaths(model, treeInput.paths, expandedRef.current);
        } finally {
            resettingRef.current = false;
        }
    }, [cache, folder, model, treeInput]);

    /* The marks the tree draws, on both models: what git ignores and what it says changed. They are
       set apart from the rows, because a status arrives on its own schedule and the rows do not. */
    useEffect(() => {
        const entries = [...treeInput.ignored.map((path) => ({ path, status: 'ignored' as const })), ...changed];
        model.setGitStatus(entries);
        searchModel.setGitStatus(entries);
    }, [changed, model, searchModel, treeInput]);

    /*
     * The tree reports an expansion nowhere, so every change of its own is the moment to compare
     * what it says is open against what was open before. A directory that just opened and has never
     * been listed is the one the daemon hears about.
     */
    useEffect(() => {
        if (!folder) {
            return;
        }
        return model.subscribe(() => {
            if (resettingRef.current) {
                return;
            }
            const reported = new Set<string>();
            for (const dir of directoriesRef.current) {
                if (directoryHandle(model, dir)?.isExpanded()) {
                    reported.add(dir);
                }
            }
            const open = withoutClosedBranches(mergeExpanded(expandedRef.current, reported, directoriesRef.current), directoriesRef.current);
            const opened = newlyExpanded(expandedRef.current, open);
            expandedRef.current = open;
            useFiles.getState().setExpandedDirs([...open]);
            for (const path of opened) {
                const absolute = absoluteOf(folder, path);
                if (!cacheRef.current.has(absolute)) {
                    void load(absolute);
                }
            }
            // The tree keeps a folder under a closed one open, so it would open again with its parent.
            for (const dir of reported) {
                if (!open.has(dir)) {
                    directoryHandle(model, dir)?.collapse();
                }
            }
        });
    }, [folder, load, model]);

    /*
     * Brings one row into view: the directories on the way to it open, it becomes the selection, and
     * the tree scrolls only as far as it has to. False while the row is not there yet, which is
     * before the listings a directory on the way asked for have landed.
     */
    const bringIntoView = useCallback(
        (treePath: string): boolean => {
            for (const dir of ancestorDirsOf(treePath)) {
                directoryHandle(model, dir)?.expand();
            }
            // A directory is a row of its own, which the tree names with a trailing slash.
            const path = model.getItem(treePath) !== null ? treePath : `${treePath}/`;
            if (model.getItem(path) === null) {
                return false;
            }
            // The tree selects per item, so what was selected has to let go first.
            for (const selected of model.getSelectedPaths()) {
                model.getItem(selected)?.deselect();
            }
            model.getItem(path)?.select();
            model.scrollToPath(path, { offset: 'nearest' });
            return true;
        },
        [model]
    );

    /*
     * The tree follows the preview: the file of the active tab is the selected row. It runs on a tab
     * change and on the listings that a reveal asks for, never on a selection the person makes here.
     */
    useEffect(() => {
        if (!folder || searching || activeFile === null || revealedRef.current === activeFile) {
            return;
        }
        if (bringIntoView(relativeTo(folder, activeFile))) {
            revealedRef.current = activeFile;
        }
    }, [activeFile, bringIntoView, cache, folder, searching]);

    /*
     * A reveal asked for somewhere else in the app: a menu in the git panel, on a tab, or in the
     * preview's toolbar. The filter goes first, since a row a filter hides cannot be shown, and the
     * ask is answered once however many listings it takes to get there.
     */
    useEffect(() => {
        if (!folder || reveal === null || answeredReveal.current === reveal.nonce) {
            return;
        }
        if (searching) {
            // A reveal can wait on more than one listing, so the filter is cleared where that wait is.
            // oxlint-disable-next-line react/set-state-in-effect
            setQuery('');
            return;
        }
        if (bringIntoView(relativeTo(folder, reveal.path))) {
            answeredReveal.current = reveal.nonce;
            revealedRef.current = reveal.path;
        }
    }, [bringIntoView, cache, folder, reveal, searching]);

    useEffect(() => {
        if (!folder || !searching) {
            return;
        }
        const timer = window.setTimeout(() => {
            performAsPerson('file.search', { query: query.trim(), limit: SEARCH_LIMIT })
                .then((result) => setMatches(result.files))
                .catch(() => setMatches([]));
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            window.clearTimeout(timer);
        };
    }, [folder, query, searching]);

    useEffect(() => {
        searchModel.resetPaths([...matches]);
    }, [matches, searchModel]);

    /* The file opens beside the panel and the keyboard stays in the tree, so the next arrow moves on. */
    const openPath = (treePath: string | null): void => {
        if (!folder || !treePath || isDirectoryPath(treePath)) {
            return;
        }
        useFiles.getState().open(absoluteOf(folder, treePath), tabLimit, undefined, undefined, { focus: false });
    };

    /* One click opens a file, the way every row in this app opens what it points at. A directory
       is left to the tree, which folds it open on the same click. */
    const onClick = (event: ReactMouseEvent<HTMLElement>): void => {
        if (extendsSelection(event)) {
            return;
        }
        openPath(rowPathOf(event));
    };

    const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
        if (event.key !== 'Enter') {
            return;
        }
        const focused = activeModel.getFocusedPath();
        if (focused !== null && isDirectoryPath(focused)) {
            directoryHandle(activeModel, focused)?.toggle();
            return;
        }
        openPath(focused);
    };

    const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLElement>): void => {
        if (movesFocus(event)) {
            followFocus(activeModel);
        }
    };

    const onDragStart = (event: ReactDragEvent<HTMLElement>): void => {
        const path = rowPathOf(event);
        if (!path) {
            return;
        }
        const selected = selectionRef.current;
        const paths = selected.includes(path) && selected.length > 1 ? [...selected] : [path];
        // The canvas needs the trailing slash to leave a directory alone; a mention has no use for it.
        event.dataTransfer.setData(PATHS_DRAG_TYPE, paths.join(' '));
        event.dataTransfer.setData(MENTION_DRAG_TYPE, paths.map((entry) => (isDirectoryPath(entry) ? entry.slice(0, -1) : entry)).join(' '));
    };

    const expandAll = (): void => {
        // Over the directories the tree already holds, and no further: what a directory opens is
        // listed only once it is open, so the level under it unfolds on the next click.
        for (const dir of directoriesRef.current) {
            directoryHandle(model, dir)?.expand();
        }
    };

    const collapseAll = (): void => {
        // Emptied first, so a directory that is remembered but not in the tree yet closes with the rest.
        expandedRef.current = new Set();
        for (const dir of directoriesRef.current) {
            directoryHandle(model, dir)?.collapse();
        }
        useFiles.getState().setExpandedDirs([]);
    };

    const refresh = (): void => {
        for (const dir of cache.keys()) {
            void load(dir);
        }
    };

    /* Every menu item acts on the row that was right-clicked, absolute path and tree path both. */
    /* Directories too, the way a row dragged into the composer mentions one. */
    const menuMention = folder && menuPath ? mentionOf(folder, absoluteOf(folder, menuPath)) : null;

    const manyTargets = menuTargets.length > 1;

    /* What every selected row stands for, as the lines a person pastes: one row per line. */
    const copyTargets = (line: (absolute: string, treePath: string) => string | null): void => {
        if (folder) {
            copyText(
                menuTargets
                    .map((treePath) => line(absoluteOf(folder, treePath).replace(/\/+$/, ''), treePath))
                    .filter((text): text is string => text !== null)
                    .join('\n')
            );
        }
    };

    const onMenuPath = (act: (absolute: string, treePath: string) => void) => (): void => {
        if (folder && menuPath) {
            act(absoluteOf(folder, menuPath), menuPath);
        }
    };

    const confirmDelete = (): void => {
        if (deleting === null) {
            return;
        }
        setDeleteBusy(true);
        performAsPerson('file.delete', { paths: deleting.absolutes })
            .then(() => setDeleting(null))
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : t('error.generic');
                useToasts.getState().show({ title: t('files.deleteFailed'), description: message, kind: 'error', output: message });
            })
            .finally(() => setDeleteBusy(false));
    };

    /* The diff of the row the menu is on, which only a file git says changed has. */
    const openChanges = (): void => {
        const root = gitStatus?.root ?? null;
        if (folder && menuPath && root !== null) {
            const file = absoluteOf(folder, menuPath);
            const staged = changedStatus === 'staged';
            useFiles.getState().open(file, tabLimit, { kind: 'diff', cwd: root, scope: useGit.getState().scope, staged });
        }
    };

    if (!folder) {
        return <PanelEmpty icon={Folder}>{t('git.panel.noFolder')}</PanelEmpty>;
    }

    /* What stands where the tree would be while it holds no rows: the first listing still on its
       way, a folder with nothing in it, or a filter nothing here answers to. */
    const placeholder = (): ReactNode => {
        if (searching) {
            return matches.length > 0 ? null : <EmptyState icon={Search}>{t('files.noMatch')}</EmptyState>;
        }
        if (!cache.has(folder)) {
            return <EmptyState busy>{t('files.reading', { name: basenameOf(folder) })}</EmptyState>;
        }
        if (treeInput.paths.length > 0) {
            return null;
        }
        if (!showHidden && (cache.get(folder)?.length ?? 0) > 0) {
            return <EmptyState icon={Folder}>{t('files.onlyHidden')}</EmptyState>;
        }
        return <EmptyState icon={Folder}>{t('files.empty')}</EmptyState>;
    };

    const empty = placeholder();

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <div className={FILE_TOOLBAR}>
                <span className="relative min-w-0 grow">
                    <Icon icon={Search} size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-text-faint" aria-hidden />
                    <Input
                        size="sm"
                        className="pl-8"
                        placeholder={t('files.filter')}
                        aria-label={t('files.filter')}
                        spellCheck={false}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape' && query !== '') {
                                e.stopPropagation();
                                setQuery('');
                            }
                        }}
                    />
                </span>
                <Menu.Root>
                    <IconButton icon={MoreHorizontal} size="sm" label={t('common:action.more')} render={<Menu.Trigger />} />
                    <Menu.Popup align="end">
                        <Menu.Item onClick={() => useUi.getState().openFindInFiles()}>
                            <Icon icon={FileSearch} size={14} /> {t('file.empty.findInFiles')} <Kbd shortcut={APP_SHORTCUTS.findInFiles} />
                        </Menu.Item>
                        <Menu.Separator />
                        <Menu.CheckboxItem
                            checked={showHidden}
                            onCheckedChange={(checked) => useSettings.getState().update({ filesShowHidden: checked })}
                            closeOnClick={false}
                        >
                            {t('files.showHidden')}
                        </Menu.CheckboxItem>
                        <Menu.Separator />
                        <Menu.Item onClick={expandAll}>
                            <Icon icon={ChevronsUpDown} size={14} /> {t('git.panel.expandAll')}
                        </Menu.Item>
                        <Menu.Item onClick={collapseAll}>
                            <Icon icon={ChevronsDownUp} size={14} /> {t('git.panel.collapseAll')}
                        </Menu.Item>
                        <Menu.Separator />
                        <Menu.Item onClick={refresh}>
                            <Icon icon={RefreshCw} size={14} /> {t('file.menu.refresh')}
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Root>
            </div>
            {empty !== null ? (
                <div className="grid min-h-0 grow place-items-center">{empty}</div>
            ) : (
                <ContextMenu.Root>
                    <ContextMenu.Trigger
                        render={<div />}
                        /* The padding is on the frame, not the scroller, so the first row keeps its
                           distance from the toolbar instead of sliding under it. */
                        className="min-h-0 grow overflow-hidden pt-2"
                        onKeyDownCapture={onKeyDownCapture}
                        onContextMenu={(event) => {
                            const path = rowPathOf(event);
                            setMenuPath(path);
                            if (path === null) {
                                setMenuTargets([]);
                                return;
                            }
                            const targets = menuTargetsOf(path, selectionRef.current);
                            if (targets.length === 1 && !selectionRef.current.includes(path)) {
                                // A right click outside the selection acts on its own row, so the selection lets go first.
                                for (const selected of activeModel.getSelectedPaths()) {
                                    activeModel.getItem(selected)?.deselect();
                                }
                                activeModel.getItem(path)?.select();
                            }
                            setMenuTargets(targets);
                        }}
                    >
                        <FileTree
                            key={searching ? 'search' : 'tree'}
                            model={activeModel}
                            className="panel-tree"
                            onClick={onClick}
                            onKeyDown={onKeyDown}
                            onDragStart={onDragStart}
                        />
                    </ContextMenu.Trigger>
                    <ContextMenu.Popup>
                        {manyTargets ? (
                            <>
                                <ContextMenu.Item
                                    onClick={() =>
                                        folder &&
                                        setDeleting({
                                            absolutes: menuTargets.map((treePath) => absoluteOf(folder, treePath).replace(/\/+$/, '')),
                                            directory: false
                                        })
                                    }
                                >
                                    <Icon icon={Trash2} size={14} /> {t('files.deleteMany', { count: menuTargets.length })}
                                </ContextMenu.Item>
                                <ContextMenu.Separator />
                                <ContextMenu.Item onClick={() => copyTargets((absolute) => basenameOf(absolute))}>
                                    <Icon icon={Copy} size={14} /> {t('files.copyNames')}
                                </ContextMenu.Item>
                                <ContextMenu.Item onClick={() => copyTargets((absolute) => absolute)}>
                                    <Icon icon={Copy} size={14} /> {t('files.copyPaths')}
                                </ContextMenu.Item>
                                <ContextMenu.Item
                                    onClick={() => copyTargets((_absolute, treePath) => (isDirectoryPath(treePath) ? treePath.slice(0, -1) : treePath))}
                                >
                                    <Icon icon={Copy} size={14} /> {t('files.copyRelativePaths')}
                                </ContextMenu.Item>
                                <ContextMenu.Item onClick={() => copyTargets((absolute) => mentionOf(folder, absolute))}>
                                    <Icon icon={AtSign} size={14} /> {t('files.copyMentions')}
                                </ContextMenu.Item>
                            </>
                        ) : (
                            <>
                                <ContextMenu.Item onClick={onMenuPath((_absolute, treePath) => openPath(treePath))}>
                                    <Icon icon={FolderOpen} size={14} /> {t('common:action.open')}
                                </ContextMenu.Item>
                                {changedStatus !== null && (
                                    <ContextMenu.Item onClick={openChanges}>
                                        <Icon icon={FileDiff} size={14} /> {t('git.list.openChanges')}
                                    </ContextMenu.Item>
                                )}
                                <ContextMenu.Item
                                    onClick={onMenuPath((absolute) => {
                                        void transport.request('fs.reveal', { path: absolute }).catch(() => undefined);
                                    })}
                                >
                                    <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
                                </ContextMenu.Item>
                                {menuPath !== null && !isDirectoryPath(menuPath) && (
                                    <>
                                        <ContextMenu.Separator />
                                        {onCanvas && (
                                            <ContextMenu.Item onClick={onMenuPath((absolute) => void showFileOnCanvas(absolute))}>
                                                <Icon icon={Frame} size={14} /> {t('file.menu.showOnCanvas')}
                                            </ContextMenu.Item>
                                        )}
                                        <ContextMenu.Item onClick={onMenuPath((absolute) => void createViewAction('file', { path: absolute }))}>
                                            <Icon icon={Columns2} size={14} /> {t('file.menu.openAsView')}
                                        </ContextMenu.Item>
                                    </>
                                )}
                                <ContextMenu.Separator />
                                <ContextMenu.Item onClick={onMenuPath((absolute) => copyText(basenameOf(absolute)))}>
                                    <Icon icon={Copy} size={14} /> {t('files.copyName')}
                                </ContextMenu.Item>
                                <ContextMenu.Item onClick={onMenuPath((absolute) => copyText(absolute))}>
                                    <Icon icon={Copy} size={14} /> {t('file.menu.copyPath')}
                                </ContextMenu.Item>
                                <ContextMenu.Item
                                    onClick={onMenuPath((_absolute, treePath) => copyText(isDirectoryPath(treePath) ? treePath.slice(0, -1) : treePath))}
                                >
                                    <Icon icon={Copy} size={14} /> {t('file.menu.copyRelativePath')}
                                </ContextMenu.Item>
                                {menuMention !== null && (
                                    <ContextMenu.Item onClick={() => copyText(menuMention)}>
                                        <Icon icon={AtSign} size={14} /> {t('file.menu.copyMention')}
                                    </ContextMenu.Item>
                                )}
                                {menuPath !== null && (
                                    <>
                                        <ContextMenu.Separator />
                                        <ContextMenu.Item
                                            onClick={onMenuPath((absolute, treePath) =>
                                                setDeleting({ absolutes: [absolute.replace(/\/+$/, '')], directory: isDirectoryPath(treePath) })
                                            )}
                                        >
                                            <Icon icon={Trash2} size={14} /> {t('files.delete')}
                                        </ContextMenu.Item>
                                    </>
                                )}
                            </>
                        )}
                    </ContextMenu.Popup>
                </ContextMenu.Root>
            )}
            <PromptDialog
                open={deleting !== null}
                title={
                    deleting === null
                        ? t('files.deleteDialog.fallback')
                        : deleting.absolutes.length > 1
                          ? t('files.deleteDialog.manyTitle', { count: deleting.absolutes.length })
                          : t(deleting.directory ? 'files.deleteDialog.folderTitle' : 'files.deleteDialog.fileTitle', {
                                name: basenameOf(deleting.absolutes[0] ?? '')
                            })
                }
                description={
                    deleting !== null && deleting.absolutes.length > 1
                        ? t('files.deleteDialog.manyDescription')
                        : deleting?.directory
                          ? t('files.deleteDialog.folderDescription')
                          : t('files.deleteDialog.fileDescription')
                }
                confirmLabel={t('files.deleteDialog.confirm')}
                danger
                busy={deleteBusy}
                onConfirm={confirmDelete}
                onOpenChange={() => setDeleting(null)}
            />
        </div>
    );
}

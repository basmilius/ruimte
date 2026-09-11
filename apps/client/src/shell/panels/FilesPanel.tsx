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
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Menu } from '@base-ui-components/react/menu';
import type { FileTree as FileTreeModel, FileTreeDirectoryHandle } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import {
    Check,
    ChevronsDownUp,
    ChevronsUpDown,
    Copy,
    CornerUpRight,
    FileSearch,
    Folder,
    FolderOpen,
    LoaderCircle,
    MoreHorizontal,
    RefreshCw,
    Search
} from 'lucide-react';
import { MENTION_DRAG_TYPE } from '@/chat/mentions';
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
    mergeExpanded,
    newlyExpanded,
    relativeTo,
    treePathOf,
    type EntryCache
} from '@/shell/panels/files-tree';
import { useFiles } from '@/state/files';
import { useGitStatus } from '@/state/git-watch';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { transport } from '@/transport';
import { MENU_SEPARATOR } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { FILE_TREE_ICONS } from '@/ui/file-icon';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_LIMIT = 200;

/*
 * Two rules over the tree's own stylesheet. The first hides the row that keeps an unloaded
 * directory's chevron. The second turns the letter the git lane draws into a dot, in the color the
 * lane already carries: a directory with changes under it gets a dot of the tree's own, so one
 * shape says "this differs from HEAD" everywhere in the panel. An ignored file leaves that lane
 * empty, which is why it is left out.
 */
const TREE_CSS = `
    [data-item-path$="/${LOADING_NAME}"] { display: none !important; }
    [data-item-git-status]:not([data-item-git-status="ignored"]) > [data-item-section="git"] > * { display: none; }
    [data-item-git-status]:not([data-item-git-status="ignored"]) > [data-item-section="git"]::after {
        content: "";
        width: 6px;
        height: 6px;
        border-radius: 9999px;
        background: currentColor;
    }
`;

const EMPTY_CACHE: EntryCache = new Map();

const copyText = (text: string): void => {
    void navigator.clipboard.writeText(text).catch(() => undefined);
};

/* The tree's own handle type is a union whose two halves TypeScript cannot tell apart by method. */
const directoryHandle = (model: FileTreeModel, path: string): FileTreeDirectoryHandle | null => {
    const item = model.getItem(path);
    return item?.isDirectory() ? (item as FileTreeDirectoryHandle) : null;
};

/* The row a composed event came out of. The rows live in a shadow root, so the path is somewhere on
   the way up and never on the target React hands over. */
const rowPathOf = (event: { nativeEvent: Event }): string | null => {
    for (const node of event.nativeEvent.composedPath()) {
        const path = node instanceof HTMLElement ? node.dataset.itemPath : undefined;
        if (path) {
            return path;
        }
    }
    return null;
};

/*
 * The folder of the open project as a tree; the file it opens is drawn by the preview panel next to
 * it. Directories are listed one at a time: the first `fs.list` is the folder itself, and every
 * expand asks for what it opened. The daemon watches the folder while the panel is up, so a file an
 * agent writes shows up on its own.
 */
export function FilesPanel() {
    const folder = useProject((s) => s.current?.folder ?? null);
    const platform = useServer((s) => s.platform);
    const reachability = useServer((s) => s.reachability);
    const machine = useServer((s) => s.label);
    const showHidden = useSettings((s) => s.filesShowHidden);
    /* Which file the preview has up; a diff tab points at the same file and counts as well. */
    const activeFile = useFiles((s) => s.tabs.find((tab) => tab.key === s.active)?.path ?? null);
    const tabLimit = useSettings((s) => s.filesTabLimit);
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
    const selectionRef = useRef<readonly string[]>([]);
    /* The file the tree last followed the preview to, so a click of the person's own is never undone. */
    const revealedRef = useRef<string | null>(null);
    const menuPathRef = useRef<string | null>(null);
    const cache = listed.folder === folder ? listed.byDir : EMPTY_CACHE;

    const { model } = useFileTree({
        paths: [],
        composition: { contextMenu: { enabled: false } },
        density: 'compact',
        dragAndDrop: { canDrag: () => true, canDrop: () => false },
        flattenEmptyDirectories: false,
        icons: FILE_TREE_ICONS,
        initialExpansion: 'closed',
        onSelectionChange: (paths) => {
            selectionRef.current = paths;
        },
        search: false,
        sort: compareRows,
        unsafeCSS: TREE_CSS
    });

    /* A search answers with paths and nothing else, so it gets a model of its own: lazy loading and
       a flat result list would otherwise fight over the same rows. */
    const { model: searchModel } = useFileTree({
        paths: [],
        composition: { contextMenu: { enabled: false } },
        density: 'compact',
        dragAndDrop: { canDrag: () => true, canDrop: () => false },
        icons: FILE_TREE_ICONS,
        initialExpansion: 'open',
        onSelectionChange: (paths) => {
            selectionRef.current = paths;
        },
        search: false,
        sort: compareRows
    });

    const searching = query.trim() !== '';
    const activeModel = searching ? searchModel : model;
    /* The rows the tree is fed, kept here as well because what they add up to is what says whether
       the panel has anything to show. */
    const treeInput = useMemo(() => buildTreeInput(folder ?? '', cache, showHidden), [cache, folder, showHidden]);
    const changed = useMemo(() => (folder === null ? [] : gitStatusEntries(folder, gitStatus?.root ?? null, gitStatus?.files ?? [])), [folder, gitStatus]);

    const load = useCallback(
        async (dir: string): Promise<void> => {
            try {
                // Always with the hidden entries: the eye button then rebuilds from the cache alone.
                const result = await transport.request('fs.list', { path: dir, hidden: true });
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
        // The watch goes up before the first listing, so a write in between is reported, not missed.
        void transport
            .request('fs.watch', { path: folder })
            .catch(() => undefined)
            .then(() => {
                void load(folder);
                for (const dir of expandedRef.current) {
                    void load(absoluteOf(folder, dir));
                }
            });
        return () => {
            void transport.request('fs.unwatch', { path: folder }).catch(() => undefined);
        };
    }, [folder, load]);

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
    }, [folder, load]);

    useEffect(() => {
        if (!folder) {
            return;
        }
        model.resetPaths(treeInput.paths, { initialExpandedPaths: [...expandedRef.current] });
        directoriesRef.current = new Set(
            [...cache.values()].flatMap((entries) => entries.filter((entry) => entry.kind === 'directory').map((entry) => treePathOf(folder, entry)))
        );
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
            const reported = new Set<string>();
            for (const dir of directoriesRef.current) {
                if (directoryHandle(model, dir)?.isExpanded()) {
                    reported.add(dir);
                }
            }
            const open = mergeExpanded(expandedRef.current, reported, directoriesRef.current);
            const opened = newlyExpanded(expandedRef.current, open);
            expandedRef.current = open;
            useFiles.getState().setExpandedDirs([...open]);
            for (const path of opened) {
                const absolute = absoluteOf(folder, path);
                if (!cacheRef.current.has(absolute)) {
                    void load(absolute);
                }
            }
        });
    }, [folder, load, model]);

    /*
     * The tree follows the preview: the file of the active tab is the selected row. It runs on a tab
     * change and on the listings that a reveal asks for, never on a selection the person makes here,
     * and it scrolls only far enough to bring the row into view.
     */
    useEffect(() => {
        if (!folder || searching || activeFile === null || revealedRef.current === activeFile) {
            return;
        }
        const treePath = relativeTo(folder, activeFile);
        for (const dir of ancestorDirsOf(treePath)) {
            directoryHandle(model, dir)?.expand();
        }
        // The row is only there once the directories on the way to it have been listed.
        if (model.getItem(treePath) === null) {
            return;
        }
        revealedRef.current = activeFile;
        // The tree selects per item, so what was selected has to let go first.
        for (const selected of model.getSelectedPaths()) {
            model.getItem(selected)?.deselect();
        }
        model.getItem(treePath)?.select();
        model.scrollToPath(treePath, { offset: 'nearest' });
    }, [activeFile, cache, folder, model, searching]);

    useEffect(() => {
        if (!folder || !searching) {
            return;
        }
        const timer = window.setTimeout(() => {
            transport
                .request('fs.search', { cwd: folder, query: query.trim(), limit: SEARCH_LIMIT })
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

    const openPath = (treePath: string | null): void => {
        if (!folder || !treePath || isDirectoryPath(treePath)) {
            return;
        }
        useFiles.getState().open(absoluteOf(folder, treePath), tabLimit);
    };

    /* One click opens a file, the way every row in this app opens what it points at. A directory
       is left to the tree, which folds it open on the same click. */
    const onClick = (event: ReactMouseEvent<HTMLElement>): void => {
        openPath(rowPathOf(event));
    };

    const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
        if (event.key === 'Enter') {
            openPath(activeModel.getFocusedPath());
        }
    };

    const onDragStart = (event: ReactDragEvent<HTMLElement>): void => {
        const path = rowPathOf(event);
        if (!path) {
            return;
        }
        const selected = selectionRef.current;
        const paths = selected.includes(path) && selected.length > 1 ? [...selected] : [path];
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
    const onMenuPath = (act: (absolute: string, treePath: string) => void) => (): void => {
        const treePath = menuPathRef.current;
        if (folder && treePath) {
            act(absoluteOf(folder, treePath), treePath);
        }
    };

    if (!folder) {
        return (
            <div className="grid grow place-items-center">
                <EmptyState icon={<Icon icon={Folder} size={20} />}>This canvas has no folder, so there are no files to list.</EmptyState>
            </div>
        );
    }

    /* What stands where the tree would be while it holds no rows: the first listing still on its
       way, a folder with nothing in it, or a filter nothing here answers to. */
    const placeholder = (): ReactNode => {
        if (searching) {
            return matches.length > 0 ? null : <EmptyState icon={<Icon icon={Search} size={20} />}>No file in this folder matches the filter.</EmptyState>;
        }
        if (!cache.has(folder)) {
            return <EmptyState icon={<Icon icon={LoaderCircle} size={20} className="animate-spin" />}>Reading {basenameOf(folder)}.</EmptyState>;
        }
        if (treeInput.paths.length > 0) {
            return null;
        }
        if (!showHidden && (cache.get(folder)?.length ?? 0) > 0) {
            return <EmptyState icon={<Icon icon={Folder} size={20} />}>Everything in this folder is hidden; the eye button shows it.</EmptyState>;
        }
        return <EmptyState icon={<Icon icon={Folder} size={20} />}>This folder is empty.</EmptyState>;
    };

    const empty = placeholder();

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <div className={FILE_TOOLBAR}>
                <span className="relative min-w-0 grow">
                    <Icon icon={Search} size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-text-faint" aria-hidden />
                    <input
                        className="field h-7 pl-8 text-xs"
                        placeholder="Filter files"
                        aria-label="Filter files"
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
                    <Tooltip label="More" name>
                        <Menu.Trigger className="icon-btn h-7 w-7">
                            <Icon icon={MoreHorizontal} size={14} />
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-[var(--z-popup)]" side="bottom" align="end" sideOffset={6}>
                            <Menu.Popup className="menu-popup">
                                <Menu.Item className="menu-item" onClick={() => useUi.getState().openFindInFiles()}>
                                    <Icon icon={FileSearch} size={14} /> Find in files <kbd>⇧⌘F</kbd>
                                </Menu.Item>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.CheckboxItem
                                    className="menu-item"
                                    checked={showHidden}
                                    onCheckedChange={(checked) => useSettings.getState().update({ filesShowHidden: checked })}
                                    closeOnClick={false}
                                >
                                    <span className="grid h-4 w-4 place-items-center rounded border border-border-strong">
                                        <Menu.CheckboxItemIndicator>
                                            <Icon icon={Check} size={12} />
                                        </Menu.CheckboxItemIndicator>
                                    </span>
                                    Show hidden files
                                </Menu.CheckboxItem>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.Item className="menu-item" onClick={expandAll}>
                                    <Icon icon={ChevronsUpDown} size={14} /> Expand all folders
                                </Menu.Item>
                                <Menu.Item className="menu-item" onClick={collapseAll}>
                                    <Icon icon={ChevronsDownUp} size={14} /> Collapse all folders
                                </Menu.Item>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.Item className="menu-item" onClick={refresh}>
                                    <Icon icon={RefreshCw} size={14} /> Refresh
                                </Menu.Item>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
            </div>
            {reachability !== null && reachability !== 'loopback' && (
                <div className="flex h-7 shrink-0 items-center px-2">
                    <Pill>{machine ?? 'Remote machine'}</Pill>
                </div>
            )}
            {empty !== null ? (
                <div className="grid min-h-0 grow place-items-center">{empty}</div>
            ) : (
                <ContextMenu.Root>
                    <ContextMenu.Trigger
                        render={<div />}
                        /* The padding is on the frame, not the scroller, so the first row keeps its
                           distance from the toolbar instead of sliding under it. */
                        className="min-h-0 grow overflow-hidden pt-2"
                        onContextMenu={(event) => {
                            menuPathRef.current = rowPathOf(event);
                            if (menuPathRef.current) {
                                activeModel.getItem(menuPathRef.current)?.select();
                            }
                        }}
                    >
                        <FileTree
                            key={searching ? 'search' : 'tree'}
                            model={activeModel}
                            className="files-tree"
                            onClick={onClick}
                            onKeyDown={onKeyDown}
                            onDragStart={onDragStart}
                        />
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                        <ContextMenu.Positioner className="z-[var(--z-popup)]">
                            <ContextMenu.Popup className="menu-popup">
                                <ContextMenu.Item className="menu-item" onClick={onMenuPath((_absolute, treePath) => openPath(treePath))}>
                                    <Icon icon={FolderOpen} size={14} /> Open
                                </ContextMenu.Item>
                                <ContextMenu.Item
                                    className="menu-item"
                                    onClick={onMenuPath((absolute) => {
                                        void transport.request('fs.reveal', { path: absolute }).catch(() => undefined);
                                    })}
                                >
                                    <Icon icon={CornerUpRight} size={14} /> Reveal in {fileManagerName(platform)}
                                </ContextMenu.Item>
                                <ContextMenu.Item className="menu-item" onClick={onMenuPath((absolute) => copyText(absolute))}>
                                    <Icon icon={Copy} size={14} /> Copy path
                                </ContextMenu.Item>
                                <ContextMenu.Item
                                    className="menu-item"
                                    onClick={onMenuPath((_absolute, treePath) => copyText(isDirectoryPath(treePath) ? treePath.slice(0, -1) : treePath))}
                                >
                                    <Icon icon={Copy} size={14} /> Copy relative path
                                </ContextMenu.Item>
                            </ContextMenu.Popup>
                        </ContextMenu.Positioner>
                    </ContextMenu.Portal>
                </ContextMenu.Root>
            )}
        </div>
    );
}

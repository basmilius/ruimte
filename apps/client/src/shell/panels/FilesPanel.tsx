import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type DragEvent as ReactDragEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent
} from 'react';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import type { FileTree as FileTreeModel, FileTreeDirectoryHandle } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { ChevronsDownUp, Copy, CornerUpRight, Eye, EyeOff, Folder, FolderOpen, RefreshCw, Search } from 'lucide-react';
import { MENTION_DRAG_TYPE } from '@/chat/mentions';
import { FileViewer } from '@/shell/panels/FileViewer';
import { LOADING_NAME, absoluteOf, buildTreeInput, compareRows, isDirectoryPath, newlyExpanded, treePathOf, type EntryCache } from '@/shell/panels/files-tree';
import { useColumnResize } from '@/shell/useColumnResize';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useSettings } from '@/state/settings';
import { transport } from '@/transport';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

const TREE_WIDTH_KEY = 'ruimte.files.tree';
const TREE_DEFAULT_WIDTH = 280;
const TREE_MIN_WIDTH = 200;
// What the viewer needs to be worth opening, and the room the panel makes for it.
const VIEWER_MIN_WIDTH = 320;
const VIEWER_ROOM = 480;
const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_LIMIT = 200;

/* The placeholder that keeps an unloaded directory's chevron is a row nobody should see. */
const TREE_CSS = `[data-item-path$="/${LOADING_NAME}"] { display: none !important; }`;

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

interface FilesPanelProps {
    /* The panel's own width and how to change it: the first open file makes room for the viewer. */
    panelWidth: number;
    setPanelWidth(width: number): void;
}

/*
 * The folder of the open project as a tree, with a viewer beside it. Directories are listed one at a
 * time: the first `fs.list` is the folder itself, and every expand asks for what it opened. The
 * daemon watches the folder while the panel is up, so a file an agent writes shows up on its own.
 */
export function FilesPanel({ panelWidth, setPanelWidth }: FilesPanelProps) {
    const folder = useProject((s) => s.current?.folder ?? null);
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const platform = useServer((s) => s.platform);
    const reachability = useServer((s) => s.reachability);
    const machine = useServer((s) => s.label);
    const showHidden = useSettings((s) => s.filesShowHidden);
    const tabLimit = useSettings((s) => s.filesTabLimit);
    const hasTabs = useFiles((s) => s.tabs.length > 0);

    /* The listings carry the folder they belong to, so a project switch drops them without an
       effect that would render twice to empty the tree. */
    const [listed, setListed] = useState<{ folder: string | null; byDir: EntryCache }>({ folder: null, byDir: EMPTY_CACHE });
    const [query, setQuery] = useState('');
    const [matches, setMatches] = useState<readonly string[]>([]);
    const cacheRef = useRef<EntryCache>(EMPTY_CACHE);
    const expandedRef = useRef<ReadonlySet<string>>(new Set());
    const directoriesRef = useRef<readonly string[]>([]);
    const selectionRef = useRef<readonly string[]>([]);
    const menuPathRef = useRef<string | null>(null);
    const treeRef = useRef<HTMLDivElement>(null);
    const cache = listed.folder === folder ? listed.byDir : EMPTY_CACHE;

    const { model } = useFileTree({
        paths: [],
        composition: { contextMenu: { enabled: false } },
        density: 'compact',
        dragAndDrop: { canDrag: () => true, canDrop: () => false },
        flattenEmptyDirectories: false,
        icons: { set: 'standard', colored: false },
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
        icons: { set: 'standard', colored: false },
        initialExpansion: 'open',
        onSelectionChange: (paths) => {
            selectionRef.current = paths;
        },
        search: false,
        sort: compareRows
    });

    const searching = query.trim() !== '';
    const activeModel = searching ? searchModel : model;

    const { width: treeWidth, startResize } = useColumnResize(treeRef, {
        storageKey: TREE_WIDTH_KEY,
        defaultWidth: TREE_DEFAULT_WIDTH,
        min: TREE_MIN_WIDTH,
        from: 'left',
        max: () => panelWidth - VIEWER_MIN_WIDTH - 1
    });

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
        useFiles.getState().load(projectId);
    }, [projectId]);

    useEffect(() => {
        expandedRef.current = new Set();
        if (!folder) {
            return;
        }
        // The watch goes up before the first listing, so a write in between is reported, not missed.
        void transport
            .request('fs.watch', { path: folder })
            .catch(() => undefined)
            .then(() => load(folder));
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
        const { paths, ignored } = buildTreeInput(folder, cache, showHidden);
        model.resetPaths(paths, { initialExpandedPaths: [...expandedRef.current] });
        model.setGitStatus(ignored.map((path) => ({ path, status: 'ignored' as const })));
        directoriesRef.current = [...cache.values()].flatMap((entries) =>
            entries.filter((entry) => entry.kind === 'directory').map((entry) => treePathOf(folder, entry))
        );
    }, [cache, folder, model, showHidden]);

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
            const open = new Set<string>();
            for (const dir of directoriesRef.current) {
                if (directoryHandle(model, dir)?.isExpanded()) {
                    open.add(dir);
                }
            }
            const opened = newlyExpanded(expandedRef.current, open);
            expandedRef.current = open;
            for (const path of opened) {
                const absolute = absoluteOf(folder, path);
                if (!cacheRef.current.has(absolute)) {
                    void load(absolute);
                }
            }
        });
    }, [folder, load, model]);

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

    /* The viewer needs room the tree cannot give it, so the first open file widens the panel and the
       last close hands the width back. A drag of the panel's own edge forgets the width it kept. */
    useEffect(() => {
        const files = useFiles.getState();
        if (hasTabs) {
            if (files.panelWidthBefore === null && panelWidth < treeWidth + VIEWER_MIN_WIDTH + 1) {
                files.rememberPanelWidth(panelWidth);
                setPanelWidth(treeWidth + VIEWER_ROOM + 1);
            }
        } else if (files.panelWidthBefore !== null) {
            setPanelWidth(files.panelWidthBefore);
            files.forgetPanelWidth();
        }
    }, [hasTabs, panelWidth, setPanelWidth, treeWidth]);

    const openPath = (treePath: string | null): void => {
        if (!folder || !treePath || isDirectoryPath(treePath)) {
            return;
        }
        useFiles.getState().open(absoluteOf(folder, treePath), tabLimit);
    };

    const onDoubleClick = (event: ReactMouseEvent<HTMLElement>): void => {
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

    const collapseAll = (): void => {
        for (const dir of directoriesRef.current) {
            directoryHandle(model, dir)?.collapse();
        }
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
                <EmptyState icon={<Icon icon={Folder} size={20} />}>
                    This canvas has no folder, so there is nothing to list. Open a project folder first.
                </EmptyState>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 grow">
            <div ref={treeRef} className="flex min-w-0 flex-col" style={hasTabs ? { width: treeWidth, flexShrink: 0 } : { flexGrow: 1 }}>
                <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
                    <span className="relative min-w-0 grow">
                        <Icon icon={Search} size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-faint" />
                        <input
                            className="field h-6 w-full pl-7 pr-2 text-xs"
                            placeholder="Filter files"
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
                    <div className="btn-group">
                        <Tooltip label={showHidden ? 'Hide hidden files' : 'Show hidden files'} name>
                            <button
                                className="icon-btn h-6 w-6"
                                aria-pressed={showHidden}
                                onClick={() => useSettings.getState().update({ filesShowHidden: !showHidden })}
                            >
                                <Icon icon={showHidden ? Eye : EyeOff} size={14} />
                            </button>
                        </Tooltip>
                        <Tooltip label="Collapse all" name>
                            <button className="icon-btn h-6 w-6" onClick={collapseAll}>
                                <Icon icon={ChevronsDownUp} size={14} />
                            </button>
                        </Tooltip>
                        <Tooltip label="Refresh" name>
                            <button className="icon-btn h-6 w-6" onClick={refresh}>
                                <Icon icon={RefreshCw} size={14} />
                            </button>
                        </Tooltip>
                    </div>
                </div>
                {reachability !== null && reachability !== 'loopback' && (
                    <div className="flex h-7 shrink-0 items-center px-2">
                        <Pill>{machine ?? 'Remote machine'}</Pill>
                    </div>
                )}
                <ContextMenu.Root>
                    <ContextMenu.Trigger
                        render={<div />}
                        className="min-h-0 grow overflow-hidden"
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
                            onDoubleClick={onDoubleClick}
                            onKeyDown={onKeyDown}
                            onDragStart={onDragStart}
                        />
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                        <ContextMenu.Positioner className="popup-layer">
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
            </div>
            {hasTabs && (
                <div className="relative flex min-w-0 grow border-l border-border">
                    <div className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize" onPointerDown={startResize} />
                    <FileViewer />
                </div>
            )}
        </div>
    );
}

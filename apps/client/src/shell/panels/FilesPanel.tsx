import { revealFile } from './reveal-file';
import { ActionRefusal } from '@ruimte/actions';
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
    ChevronsDownUp,
    ChevronsUpDown,
    Columns2,
    CornerUpRight,
    FileDiff,
    FileSearch,
    FilePlus,
    Folder,
    FolderOpen,
    FolderPlus,
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
import { FileSearch as FileSearchFlow, type FileSearchResult } from './file-search';
import { FileCopyRow } from '@/shell/panels/FileCopyRow';
import {
    creationParentOf,
    newEntryPathOf,
    placeholderPathOf,
    validateNewEntry,
    PLACEHOLDER_CSS,
    type Creation,
    type NameFault,
    type NewEntryKind
} from '@/shell/panels/file-create';
import { NewEntryRow } from '@/shell/panels/NewEntryRow';
import type { CopyTarget } from '@/shell/panels/file-copy';
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
import { usePanelTreeShift } from '@/shell/panels/use-panel-tree-shift';
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
import {
    Button,
    ButtonGroup,
    EmptyState,
    FILE_TREE_ICONS,
    Icon,
    IconButton,
    Input,
    Menu,
    Kbd,
    PanelEmpty,
    ContextMenu,
    PromptDialog
} from '@basmilius/desktop-ui';
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
    ${PLACEHOLDER_CSS}
`;

const EMPTY_MATCHES: readonly string[] = [];
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
    const tabLimit = useSettings((s) => s.filesTabLimit);
    const transport = useTransport();
    /* What git says about the project folder, so a changed file carries a dot. The git panel reads
       the same watch; whichever of the two is up holds it. */
    const gitStatus = useGitStatus(folder);

    /* The listings carry the folder they belong to, so a project switch drops them without an
       effect that would render twice to empty the tree. */
    const [listed, setListed] = useState<{ folder: string | null; byDir: EntryCache }>({ folder: null, byDir: EMPTY_CACHE });
    const [query, setQuery] = useState('');
    const search = useRef(new FileSearchFlow());
    const [searchResult, setSearchResult] = useState<{ key: string; result: FileSearchResult } | null>(null);
    const [searchAttempt, setSearchAttempt] = useState(0);
    const searchKey = JSON.stringify([endpointId, folder, query.trim(), searchAttempt]);
    const currentSearch = searchResult?.key === searchKey ? searchResult.result : null;
    const matches = currentSearch?.kind === 'ready' ? currentSearch.files : EMPTY_MATCHES;

    const cacheRef = useRef<EntryCache>(EMPTY_CACHE);
    const expandedRef = useRef<ReadonlySet<string>>(new Set());
    const directoriesRef = useRef<ReadonlySet<string>>(new Set());
    const resettingRef = useRef(false);
    const selectionRef = useRef<readonly string[]>([]);
    const [menuPath, setMenuPath] = useState<string | null>(null);
    /* The rows the open context menu acts on: one, or the whole selection when the row is part of one. */
    const [menuTargets, setMenuTargets] = useState<string[]>([]);
    const [deleting, setDeleting] = useState<{ absolutes: string[]; directory: boolean } | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    /* The entry being named: where it is made and what kind it is. The tree holds a row open for it. */
    const [creation, setCreation] = useState<Creation | null>(null);
    const [entryName, setEntryName] = useState('');
    const [entryBusy, setEntryBusy] = useState(false);
    /* What the machine refused with, until the name changes. */
    const [entryFailure, setEntryFailure] = useState<string | null>(null);
    /* The entry that was made, until the listing that holds it has been drawn and the row is in view. */
    /* Set the moment the request goes out, since disabling the field blurs it before the state says so. */
    const submittingRef = useRef(false);
    const madeRef = useRef<{ treePath: string; kind: NewEntryKind } | null>(null);
    /* Set when a menu item started the entry, so the menu does not give the keyboard back to the tree as it closes. */
    const menuStartedRef = useRef(false);
    const createRequest = useFiles((s) => s.createRequest);
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
    const { attach: attachShift, bar: shiftBar } = usePanelTreeShift(activeModel, folder ?? '');
    /* The rows the tree is fed, kept here as well because what they add up to is what says whether
       the panel has anything to show. */
    const listedInput = useMemo(() => buildTreeInput(folder ?? '', cache, showHidden), [cache, folder, showHidden]);
    const treeInput = useMemo(
        () => (creation === null ? listedInput : { ...listedInput, paths: [...listedInput.paths, placeholderPathOf(creation.parent, creation.kind)] }),
        [listedInput, creation]
    );
    const fault: NameFault | null = useMemo(
        () =>
            folder === null || creation === null
                ? null
                : validateNewEntry(entryName, creation.kind, {
                      parent: absoluteOf(folder, creation.parent),
                      atRoot: creation.parent === '',
                      windows: platform === 'win32',
                      children: (directory) => cache.get(directory)
                  }),
        [cache, creation, entryName, folder, platform]
    );
    // An empty name is not yet a mistake, so the field stays quiet until something is typed.
    const entryMessage = entryFailure ?? (fault === null || entryName.trim() === '' ? null : t(`files.create.problem.${fault.problem}`, { name: fault.name }));
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

    const startCreate = useCallback(
        (kind: NewEntryKind, parent: string): void => {
            setQuery('');
            // The row is drawn in the folder, so a folder that is closed opens first.
            for (const dir of [...ancestorDirsOf(parent), parent]) {
                if (dir !== '') {
                    directoryHandle(model, dir)?.expand();
                }
            }
            setEntryName('');
            setEntryFailure(null);
            setEntryBusy(false);
            setCreation({ kind, parent });
        },
        [model]
    );

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
        }
    }, [bringIntoView, cache, folder, reveal, searching]);

    /* The entry that was just made shows up with the listing the machine's change brings, and is
       selected there; a folder opens too, so what a person is about to put in it is in view. */
    useEffect(() => {
        const made = madeRef.current;
        if (made === null || !bringIntoView(made.treePath)) {
            return;
        }
        madeRef.current = null;
        if (made.kind === 'directory') {
            directoryHandle(model, made.treePath)?.expand();
        }
    }, [bringIntoView, cache, model, treeInput]);

    /* A new file or folder asked from a menu or the palette goes in the folder that is selected here, or the project folder. */
    useEffect(() => {
        if (!folder || createRequest === null || !cache.has(folder)) {
            return;
        }
        useFiles.setState({ createRequest: null });
        // The ask is another surface's, and it can wait on the first listing, so it is answered here and not where it was made.
        // oxlint-disable-next-line react/set-state-in-effect
        startCreate(createRequest.kind, creationParentOf(selectionRef.current[0] ?? null));
    }, [cache, createRequest, folder, startCreate]);

    useEffect(() => {
        const flow = search.current;
        if (!folder || !searching) {
            flow.invalidate();
            return;
        }
        const timer = window.setTimeout(() => {
            void flow
                .search(() => performAsPerson('file.search', { query: query.trim(), limit: SEARCH_LIMIT }))
                .then((result) => {
                    if (result !== null) {
                        setSearchResult({ key: searchKey, result });
                    }
                });
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            window.clearTimeout(timer);
            flow.invalidate();
        };
    }, [endpointId, folder, query, searching, searchKey]);

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
        // A row is a button, and Enter would also click it: a folder would fold and unfold again.
        event.preventDefault();
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

    const cancelEntry = (): void => {
        setCreation(null);
        setEntryName('');
        setEntryFailure(null);
    };

    const submitEntry = async (): Promise<void> => {
        if (!folder || creation === null || submittingRef.current || fault !== null) {
            return;
        }
        submittingRef.current = true;
        const { kind, parent } = creation;
        const parentPath = absoluteOf(folder, parent);
        const path = newEntryPathOf(parentPath, entryName, kind);
        setEntryBusy(true);
        try {
            await performAsPerson('file.create', { path, kind, text: null });
        } catch (error: unknown) {
            setEntryFailure(
                error instanceof ActionRefusal
                    ? t(`files.create.refused.${error.code}`, { defaultValue: error.message })
                    : error instanceof Error
                      ? error.message
                      : t('error.generic')
            );
            submittingRef.current = false;
            setEntryBusy(false);
            return;
        }
        submittingRef.current = false;
        madeRef.current = { treePath: `${relativeTo(folder, path)}${kind === 'directory' ? '/' : ''}`, kind };
        cancelEntry();
        setEntryBusy(false);
        // The machine's change report settles for a moment; asking its listing now keeps the new row from blinking out and back.
        void load(parentPath);
        if (kind === 'file') {
            useFiles.getState().open(path, tabLimit);
            useFiles.getState().requestCaret(path);
        }
    };

    /* Leaving the field keeps a name that can be made and drops one that cannot; the window losing focus is not leaving it. */
    const onEntryBlur = (): void => {
        if (submittingRef.current || !document.hasFocus()) {
            return;
        }
        if (entryName.trim() !== '' && fault === null) {
            void submitEntry();
        } else {
            cancelEntry();
        }
    };

    const startFromMenu = (kind: NewEntryKind, parent: string): void => {
        menuStartedRef.current = true;
        startCreate(kind, parent);
    };

    const manyTargets = menuTargets.length > 1;

    const copyTargets: CopyTarget[] =
        folder === null
            ? []
            : menuTargets.map((treePath) => ({
                  absolute: absoluteOf(folder, treePath).replace(/\/+$/, ''),
                  relative: isDirectoryPath(treePath) ? treePath.slice(0, -1) : treePath
              }));

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
            if (currentSearch === null) {
                return <EmptyState busy>{t('files.searching')}</EmptyState>;
            }
            if (currentSearch.kind === 'error') {
                return (
                    <EmptyState icon={FileSearch}>
                        <span>{t('files.searchFailed', { reason: currentSearch.message })}</span>
                        <Button size="sm" onClick={() => setSearchAttempt((attempt) => attempt + 1)}>
                            {t('common:action.retry')}
                        </Button>
                    </EmptyState>
                );
            }
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
                <ButtonGroup className="shrink-0">
                    <IconButton
                        icon={FilePlus}
                        size="sm"
                        label={t('files.create.file')}
                        onClick={() => startCreate('file', creationParentOf(selectionRef.current[0] ?? null))}
                    />
                    <IconButton
                        icon={FolderPlus}
                        size="sm"
                        label={t('files.create.folder')}
                        onClick={() => startCreate('directory', creationParentOf(selectionRef.current[0] ?? null))}
                    />
                </ButtonGroup>
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
                <div className="relative flex min-h-0 grow flex-col overflow-hidden">
                    <ContextMenu.Root>
                        <ContextMenu.Trigger
                            ref={attachShift}
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
                            {shiftBar}
                        </ContextMenu.Trigger>
                        <ContextMenu.Popup
                            // A menu that started an entry has nothing to give the keyboard back to: the field has it.
                            finalFocus={() => {
                                const startedEntry = menuStartedRef.current;
                                menuStartedRef.current = false;
                                return !startedEntry;
                            }}
                        >
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
                                    <FileCopyRow targets={copyTargets} />
                                </>
                            ) : (
                                <>
                                    <ContextMenu.Item onClick={() => startFromMenu('file', creationParentOf(menuPath))}>
                                        <Icon icon={FilePlus} size={14} /> {t('files.create.file')}
                                    </ContextMenu.Item>
                                    <ContextMenu.Item onClick={() => startFromMenu('directory', creationParentOf(menuPath))}>
                                        <Icon icon={FolderPlus} size={14} /> {t('files.create.folder')}
                                    </ContextMenu.Item>
                                    {menuPath !== null && (
                                        <>
                                            <ContextMenu.Separator />
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
                                                    revealFile(transport, absolute);
                                                })}
                                            >
                                                <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
                                            </ContextMenu.Item>
                                            {!isDirectoryPath(menuPath) && (
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
                                            <FileCopyRow targets={copyTargets} />
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
                    {creation !== null && (
                        <NewEntryRow
                            model={model}
                            placeholder={placeholderPathOf(creation.parent, creation.kind)}
                            kind={creation.kind}
                            value={entryName}
                            message={entryMessage}
                            busy={entryBusy}
                            label={t(creation.kind === 'file' ? 'files.create.fileName' : 'files.create.folderName')}
                            onChange={(value) => {
                                setEntryName(value);
                                setEntryFailure(null);
                            }}
                            onSubmit={() => void submitEntry()}
                            onCancel={cancelEntry}
                            onBlur={onEntryBlur}
                        />
                    )}
                </div>
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

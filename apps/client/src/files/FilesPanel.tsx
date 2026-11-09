import { writeMentionDrag } from '@adecore/agents-react/chat';
import { FileTree, useFileTree, messageOf } from '@adecore/ui';
import { Button, ButtonGroup, EmptyState, Icon, IconButton, Input, Menu, PanelEmpty, ContextMenu, PromptDialog } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import type { FileTreeDropResult, FileTreeVisibleRow } from '@pierre/trees';
import { ActionRefusal } from '@ruimte/actions';
import { absoluteOf, relativeTo } from '@ruimte/contracts';
import type { Worktree } from '@ruimte/contracts';
import {
    ArrowLeft,
    ChevronsDownUp,
    ChevronsUpDown,
    CornerUpRight,
    FileDiff,
    FileSearch,
    FilePlus,
    Folder,
    FolderOpen,
    FolderGit2,
    FolderPlus,
    MoreHorizontal,
    Pencil,
    RefreshCw,
    Search,
    Trash2,
    X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/action-port/perform';
import { folderWatches } from '@/controllers/fs-watch';
import { soleRepo, useGitCheckouts, useProjectRepos, withoutNestedCheckouts, type GitCheckoutRef } from '@/controllers/git-repos';
import { useProjectNodes, useWorktrees, worktreeLists } from '@/controllers/worktrees';
import { fileInfoOf } from '@/extensions/file-info';
import { SlotRow } from '@/extensions/SlotSurfaces';
import { BranchMenu } from '@/files/BranchMenu';
import { dropMovesOf } from '@/files/file-rename';
import { FileSearch as FileSearchFlow, type FileSearchResult } from '@/files/file-search';
import { FileActionItems } from '@/files/FileActionItems';
import { FileCopyRow } from '@/files/FileCopyRow';
import { repoParts } from '@/files/git-tree';
import { GitTreeMarks } from '@/files/GitTreeMarks';
import { NewEntryRow } from '@/files/NewEntryRow';
import { isQuickLookKey, useQuickLook } from '@/files/quick-look';
import { revealFile } from '@/files/reveal-file';
import { basenameOf, dirnameOf } from '@/paths/file-path';
import { useCanvas } from '@/state/canvas';
import { useEndpointId } from '@/state/current-endpoint';
import { useFiles } from '@/state/files';
import { filesRootOf, useFilesRoot } from '@/state/files-root';
import { useGit } from '@/state/git';
import { gitTargets, type GitTarget } from '@/state/git-target';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { PATHS_DRAG_TYPE } from '@/surface/canvas/drop';
import { PanelHeaderActions, PanelHeaderLeadingSlot, PanelHeaderSlot, PanelHeaderTitleHidden } from '@/surface/PanelHeaderSlot';
import type { CopyTarget } from '@/surface/panels/file-copy';
import {
    creationParentOf,
    newEntryPathOf,
    placeholderPathOf,
    validateNewEntry,
    PLACEHOLDER_CSS,
    type Creation,
    type NameFault,
    type NewEntryKind
} from '@/surface/panels/file-create';
import {
    LOADING_NAME,
    ancestorDirsOf,
    buildTreeInput,
    checkoutOfPath,
    checkoutStatusEntries,
    compareRows,
    isDirectoryPath,
    mergeExpanded,
    newlyExpanded,
    repoRowsOf,
    revealableInFiles,
    treePathOf,
    withoutClosedBranches,
    sameEntries,
    type EntryCache
} from '@/surface/panels/files-tree';
import { RowKbd } from '@/surface/RowKbd';
import { FilesScene } from '@/ui/EmptyScenes';
import { useTransport } from '@/workspace/context';
import { nodeNames, nodesInWorktree, worktreeBase } from '@/worktree-rules/worktree-rows';
import { WorktreeBar } from '@/worktrees/WorktreeMenu';

const { directoryHandle, menuTargetsOf, resetExpandedPaths, rowPathOf } = FileTree;

const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_LIMIT = 200;

/*
 * The first rule hides the row that keeps an unloaded directory's chevron. The second draws the dot
 * of a folder with changes at full strength, in the color of the letters on the files inside it.
 */
const FILES_TREE_CSS = `
    [data-item-path$="/${LOADING_NAME}"] { display: none !important; }
    [data-item-contains-git-change="true"] > [data-item-section="git"] { opacity: 1; }
    ${PLACEHOLDER_CSS}
`;

/* A key typed into a field inside the tree, such as its own search, is text and no command. */
function typing(event: Event): boolean {
    const origin = event.composedPath()[0];
    return origin instanceof HTMLElement && (origin instanceof HTMLInputElement || origin instanceof HTMLTextAreaElement || origin.isContentEditable);
}

const EMPTY_MATCHES: readonly string[] = [];
const EMPTY_CACHE: EntryCache = new Map();

/*
 * The folder of the open project, or one of its worktrees, as a tree; the file it opens is drawn by
 * the preview panel next to it. Directories are listed one at a time: the first `fs.list` is the
 * folder itself, and every expand asks for what it opened. The daemon watches the folder while the
 * panel is up, so a file an agent writes shows up on its own. The React Compiler leaves this as written
 * (a try without a catch), so its memos stay by hand.
 */
export function FilesPanel() {
    const { t } = useTranslation('panels');
    const folder = useProject((s) => s.current?.folder ?? null);
    const platform = useServer((s) => s.platform);
    const showHidden = useSettings((s) => s.filesShowHidden);
    const endpointId = useEndpointId();
    const tabLimit = useSettings((s) => s.filesTabLimit);
    const transport = useTransport();
    const nodes = useCanvas((s) => s.nodes);
    const projectNodes = useProjectNodes();
    const worktrees = useWorktrees(transport, endpointId, folder);
    const { repos } = useProjectRepos(folder);
    /* The worktree this panel was pointed at is its own, apart from the git panel's: the tree a person
       reads and the checkout they commit in need not be the same. */
    const rootKey = endpointKey(endpointId, folder ?? '');
    const picked = useFilesRoot((s) => s.picked[rootKey] ?? null);
    const place = folder === null ? null : filesRootOf(folder, picked, worktrees);
    const root = place?.root ?? null;
    const worktree = place?.worktree ?? null;

    /* What git says about every checkout the tree shows, so a changed file carries its letter and a
       repository its branch. The git panel reads the same watches; whichever of the two is up holds them. */
    const refs = useMemo<readonly GitCheckoutRef[]>(
        () =>
            worktree !== null
                ? [{ path: worktree.path, label: worktree.branch, kind: 'worktree' }]
                : repos.length > 0
                  ? repos
                  : folder === null
                    ? []
                    : soleRepo(folder),
        [worktree, repos, folder]
    );
    const read = useGitCheckouts(refs);
    const checkouts = useMemo(() => withoutNestedCheckouts(read.checkouts), [read.checkouts]);
    // Inside a worktree the tree is one checkout, whose branch the chip already names.
    const repoRows = useMemo(() => repoRowsOf(root ?? '', root === null || worktree !== null ? [] : checkouts), [root, worktree, checkouts]);

    /* The listings carry the folder they belong to, so a project or worktree switch drops them
       without an effect that would render twice to empty the tree. */
    const [listed, setListed] = useState<{ root: string | null; byDir: EntryCache }>({ root: null, byDir: EMPTY_CACHE });
    const [query, setQuery] = useState('');
    const search = useRef(new FileSearchFlow());
    const [searchResult, setSearchResult] = useState<{ key: string; result: FileSearchResult } | null>(null);
    const [searchAttempt, setSearchAttempt] = useState(0);
    const searchKey = JSON.stringify([endpointId, root, query.trim(), searchAttempt]);
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
    const [renaming, setRenaming] = useState<{ absolute: string; directory: boolean } | null>(null);
    /* The tree takes its options once, so a drop reaches the panel's current state through this. */
    const dropRef = useRef<(event: FileTreeDropResult) => void>(() => undefined);
    /* The entry being named: where it is made and what kind it is. The tree holds a row open for it. */
    const [creation, setCreation] = useState<Creation | null>(null);
    const [entryName, setEntryName] = useState('');
    const [entryBusy, setEntryBusy] = useState(false);
    /* What the machine refused with, until the name changes. */
    const [entryFailure, setEntryFailure] = useState<string | null>(null);
    /* Set the moment the request goes out, since disabling the field blurs it before the state says so. */
    const submittingRef = useRef(false);
    /* The entry that was made, until the listing that holds it has been drawn and the row is in view. */
    const madeRef = useRef<{ treePath: string; kind: NewEntryKind } | null>(null);
    /* Set when a menu item started the entry, so the menu does not give the keyboard back to the tree as it closes. */
    const menuStartedRef = useRef(false);
    const createRequest = useFiles((s) => s.createRequest);
    /* The reveal that was answered, so a listing arriving later does not scroll the tree again. */
    const answeredReveal = useRef(0);
    const cache = listed.root === root ? listed.byDir : EMPTY_CACHE;
    const reveal = useFiles((s) => s.reveal);
    const quickLook = useQuickLook(endpointId, folder);

    const { model } = useFileTree({
        paths: [],
        // A row dropped on a folder is a move, which the machine makes; the tree's own move is put right by the listing that follows.
        dragAndDrop: { canDrag: () => true, canDrop: () => true, onDropComplete: (event) => dropRef.current(event) },
        flattenEmptyDirectories: false,
        initialExpansion: 'closed',
        onSelectionChange: (paths) => {
            selectionRef.current = paths;
        },
        sort: compareRows,
        unsafeCSS: FILES_TREE_CSS
    });

    /* A search answers with paths and nothing else, so it gets a model of its own: lazy loading and
       a flat result list would otherwise fight over the same rows. */
    const { model: searchModel } = useFileTree({
        paths: [],
        dragAndDrop: { canDrag: () => true, canDrop: () => false },
        initialExpansion: 'open',
        onSelectionChange: (paths) => {
            selectionRef.current = paths;
        },
        sort: compareRows,
        unsafeCSS: FILES_TREE_CSS
    });

    const searching = query.trim() !== '';
    const activeModel = searching ? searchModel : model;
    /* The rows the tree is fed, kept here as well because what they add up to is what says whether
       the panel has anything to show. */
    const listedInput = useMemo(() => buildTreeInput(root ?? '', cache, showHidden), [cache, root, showHidden]);
    const treeInput = useMemo(
        () => (creation === null ? listedInput : { ...listedInput, paths: [...listedInput.paths, placeholderPathOf(creation.parent, creation.kind)] }),
        [listedInput, creation]
    );
    const fault: NameFault | null = useMemo(
        () =>
            root === null || creation === null
                ? null
                : validateNewEntry(entryName, creation.kind, {
                      parent: absoluteOf(root, creation.parent),
                      atRoot: creation.parent === '',
                      windows: platform === 'win32',
                      children: (directory) => cache.get(directory)
                  }),
        [cache, creation, entryName, root, platform]
    );
    // An empty name is not yet a mistake, so the field stays quiet until something is typed.
    const entryMessage = entryFailure ?? (fault === null || entryName.trim() === '' ? null : t(`files.create.problem.${fault.problem}`, { name: fault.name }));
    const changed = useMemo(() => (root === null ? [] : checkoutStatusEntries(root, checkouts)), [root, checkouts]);
    /* The checkout git answers for the row the menu is on, and that row's file in it, or null for a
       file git has nothing to say about; it is what decides whether that menu offers the diff. */
    const changedFile = useMemo(() => {
        if (root === null || menuPath === null || isDirectoryPath(menuPath)) {
            return null;
        }
        const absolute = absoluteOf(root, menuPath);
        const checkout = checkoutOfPath(checkouts, absolute);
        const checkoutRoot = checkout?.status?.root ?? checkout?.path ?? null;
        if (checkout === null || checkoutRoot === null) {
            return null;
        }
        const repoPath = relativeTo(checkoutRoot, absolute);
        const file = checkout.status?.files.find((entry) => entry.path === repoPath);
        return file === undefined ? null : { cwd: checkoutRoot, state: file.state };
    }, [root, checkouts, menuPath]);

    const load = useCallback(
        async (dir: string): Promise<void> => {
            try {
                // Always with the hidden entries: the eye button then rebuilds from the cache alone.
                const result = await perform('file.list', { path: dir, hidden: true });
                setListed((current) => {
                    const before = current.root === root ? current.byDir.get(dir) : undefined;
                    if (before !== undefined && sameEntries(before, result.entries)) {
                        return current;
                    }
                    return { root, byDir: new Map(current.root === root ? current.byDir : []).set(dir, result.entries) };
                });
            } catch {
                // A folder that went away keeps the rows it had until the next refresh.
            }
        },
        [root]
    );

    useEffect(() => {
        cacheRef.current = cache;
    }, [cache]);

    useEffect(() => {
        // What the project remembered is where the tree starts, and what it has to fetch to get there.
        // A worktree is the same tree on another branch, so it opens where the project is open.
        expandedRef.current = new Set(useFiles.getState().expandedDirs);
        if (!root) {
            return;
        }
        const loadAll = (): void => {
            const dirs = new Set([root, ...[...expandedRef.current].map((dir) => absoluteOf(root, dir)), ...cacheRef.current.keys()]);
            for (const dir of dirs) {
                void load(dir);
            }
        };
        // Listed at once and again when the watch is sure of every write, so one that fell in between still shows.
        const watch = folderWatches.watch(endpointId, root, loadAll);
        loadAll();
        void watch.ready.then(loadAll);
        return watch.release;
    }, [endpointId, root, load]);

    useEffect(() => {
        if (!root) {
            return;
        }
        return transport.on('fs.changed', (payload) => {
            for (const path of payload.paths) {
                if (cacheRef.current.has(path)) {
                    void load(path);
                }
            }
        });
    }, [transport, root, load]);

    useEffect(() => {
        if (!root) {
            return;
        }
        directoriesRef.current = new Set(
            [...cache.values()].flatMap((entries) => entries.filter((entry) => entry.kind === 'directory').map((entry) => treePathOf(root, entry)))
        );
        resettingRef.current = true;
        try {
            resetExpandedPaths(model, treeInput.paths, expandedRef.current);
        } finally {
            resettingRef.current = false;
        }
    }, [cache, root, model, treeInput]);

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
        if (!root) {
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
                const absolute = absoluteOf(root, path);
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
    }, [root, load, model]);

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
     * preview's toolbar. A file of the project shown while the tree stands in a worktree takes the
     * tree back to the project first. The filter goes next, since a row a filter hides cannot be
     * shown, and the ask is answered once however many listings it takes to get there.
     */
    useEffect(() => {
        if (!folder || !root || reveal === null || answeredReveal.current === reveal.nonce) {
            return;
        }
        if (!revealableInFiles(root, reveal.path)) {
            if (root !== folder && revealableInFiles(folder, reveal.path)) {
                useFilesRoot.getState().pick(rootKey, null);
            } else {
                answeredReveal.current = reveal.nonce;
            }
            return;
        }
        if (searching) {
            // A reveal can wait on more than one listing, so the filter is cleared where that wait is.
            // oxlint-disable-next-line react/set-state-in-effect
            setQuery('');
            return;
        }
        if (bringIntoView(relativeTo(root, reveal.path))) {
            answeredReveal.current = reveal.nonce;
        }
    }, [bringIntoView, cache, folder, root, rootKey, reveal, searching]);

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

    /* A new file or folder asked from a menu or the palette goes in the folder that is selected here, or the tree's root. */
    useEffect(() => {
        if (!root || createRequest === null || !cache.has(root)) {
            return;
        }
        useFiles.setState({ createRequest: null });
        // The ask is another surface's, and it can wait on the first listing, so it is answered here and not where it was made.
        // oxlint-disable-next-line react/set-state-in-effect
        startCreate(createRequest.kind, creationParentOf(selectionRef.current[0] ?? null));
    }, [cache, createRequest, root, startCreate]);

    useEffect(() => {
        const flow = search.current;
        if (!root || !searching) {
            flow.invalidate();
            return;
        }
        const timer = window.setTimeout(() => {
            void flow
                .search(() => perform('file.search', { query: query.trim(), limit: SEARCH_LIMIT, ...(root === folder ? {} : { folder: root }) }))
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
    }, [endpointId, folder, root, query, searching, searchKey]);

    useEffect(() => {
        searchModel.resetPaths([...matches]);
    }, [matches, searchModel]);

    /* The file opens beside the panel and the keyboard stays in the tree, so the next arrow moves on. */
    const openPath = (treePath: string | null): void => {
        if (!root || !treePath || isDirectoryPath(treePath)) {
            return;
        }
        useFiles.getState().open(absoluteOf(root, treePath), tabLimit, undefined, undefined, { focus: false });
    };

    /* Space shows the focused file in Quick Look and hides it again; Escape hides it too. A folder has none. */
    const onTreeKey = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (quickLook === null || !root || typing(event.nativeEvent)) {
            return;
        }
        if (event.key === 'Escape' && quickLook.close()) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const path = activeModel.getFocusedPath();
        if (!isQuickLookKey(event) || path === null || isDirectoryPath(path)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        quickLook.toggle(absoluteOf(root, path));
    };

    const followQuickLook = (treePath: string): void => {
        if (quickLook !== null && root && !isDirectoryPath(treePath)) {
            quickLook.follow(absoluteOf(root, treePath));
        }
    };

    const onDragStart = (_path: string, paths: readonly string[], event: DragEvent): void => {
        if (event.dataTransfer === null || root === null) {
            return;
        }
        // A worktree sits outside the project folder, where a path only names a file whole.
        const named = root === folder ? paths : paths.map((entry) => absoluteOf(root, entry));
        // The canvas needs directory slashes; a chat mention only needs the path.
        event.dataTransfer.setData(PATHS_DRAG_TYPE, named.join(' '));
        writeMentionDrag(
            event.dataTransfer,
            named.map((entry) => (isDirectoryPath(entry) ? entry.slice(0, -1) : entry))
        );
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

    const reloadListed = (): void => {
        for (const dir of cacheRef.current.keys()) {
            void load(dir);
        }
    };

    const failureOf = (error: unknown, action: 'create' | 'rename'): string =>
        error instanceof ActionRefusal
            ? t(`files.${action}.refused.${error.code}`, { defaultValue: error.message })
            : error instanceof Error
              ? error.message
              : t('error.generic');

    const cancelEntry = (): void => {
        setCreation(null);
        setEntryName('');
        setEntryFailure(null);
    };

    const submitEntry = async (): Promise<void> => {
        if (!root || creation === null || submittingRef.current || fault !== null) {
            return;
        }
        submittingRef.current = true;
        const { kind, parent } = creation;
        const parentPath = absoluteOf(root, parent);
        const path = newEntryPathOf(parentPath, entryName, kind);
        setEntryBusy(true);
        try {
            await perform('file.create', { path, kind, text: null });
        } catch (error: unknown) {
            setEntryFailure(failureOf(error, 'create'));
            submittingRef.current = false;
            setEntryBusy(false);
            return;
        }
        submittingRef.current = false;
        madeRef.current = { treePath: `${relativeTo(root, path)}${kind === 'directory' ? '/' : ''}`, kind };
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
        root === null
            ? []
            : menuTargets.map((treePath) => ({
                  absolute: absoluteOf(root, treePath).replace(/\/+$/, ''),
                  relative: isDirectoryPath(treePath) ? treePath.slice(0, -1) : treePath
              }));

    const onMenuPath = (act: (absolute: string, treePath: string) => void) => (): void => {
        if (root && menuPath) {
            act(absoluteOf(root, menuPath), menuPath);
        }
    };

    /* What the name or the machine says against a try is thrown, which the dialog shows under its field and stays open for another. */
    const confirmRename = async (typed: string): Promise<void> => {
        if (!root || renaming === null) {
            return;
        }
        const name = typed.trim();
        const parent = dirnameOf(renaming.absolute);
        const kind = renaming.directory ? 'directory' : 'file';
        if (name === basenameOf(renaming.absolute)) {
            setRenaming(null);
            return;
        }
        const problem = validateNewEntry(name, kind, {
            parent,
            atRoot: parent === root,
            windows: platform === 'win32',
            children: (directory) => cache.get(directory)
        });
        if (problem !== null) {
            throw new Error(t(`files.create.problem.${problem.problem}`, { name: problem.name }));
        }
        try {
            await perform('file.rename', { path: renaming.absolute, to: newEntryPathOf(parent, name, kind) });
        } catch (error: unknown) {
            throw new Error(failureOf(error, 'rename'));
        }
        setRenaming(null);
        // The machine's change report settles for a moment; asking now keeps the old name from lingering.
        reloadListed();
    };

    /* A drop moves the rows one after the other and stops at the first the machine refuses; the listing after it says where everything is. */
    const onDrop = (event: FileTreeDropResult): void => {
        if (!root) {
            return;
        }
        const moves = dropMovesOf(root, event.draggedPaths, event.target.directoryPath);
        void (async () => {
            try {
                for (const move of moves) {
                    await perform('file.rename', { path: move.from, to: move.to });
                }
            } catch (error: unknown) {
                const message = failureOf(error, 'rename');
                useToasts.getState().show({ title: t('files.rename.failed'), description: message, kind: 'error', output: message });
            }
            reloadListed();
        })();
    };
    useEffect(() => {
        dropRef.current = onDrop;
    });

    const confirmDelete = (): void => {
        if (deleting === null) {
            return;
        }
        setDeleteBusy(true);
        perform('file.delete', { paths: deleting.absolutes })
            .then(() => setDeleting(null))
            .catch((error: unknown) => {
                const message = messageOf(error, t('error.generic'));
                useToasts.getState().show({ title: t('files.deleteFailed'), description: message, kind: 'error', output: message });
            })
            .finally(() => setDeleteBusy(false));
    };

    /* The diff of the row the menu is on, which only a file git says changed has. */
    const openChanges = (): void => {
        if (root && menuPath && changedFile !== null) {
            const file = absoluteOf(root, menuPath);
            const staged = changedFile.state === 'staged';
            // A worktree's own changes are measured against the branch it was made from, as the git panel measures them.
            const base = worktree === null ? undefined : worktreeBase(worktree);
            useFiles
                .getState()
                .open(file, tabLimit, { kind: 'diff', cwd: changedFile.cwd, scope: useGit.getState().scope, staged, ...(base === undefined ? {} : { base }) });
        }
    };

    if (!folder || !root) {
        return <PanelEmpty icon={Folder}>{t('git.panel.noFolder')}</PanelEmpty>;
    }

    const leaveWorktree = (): void => {
        useFilesRoot.getState().pick(rootKey, null);
    };

    const enterWorktree = (entry: Worktree): void => {
        useFilesRoot.getState().pick(rootKey, entry.path);
    };

    const targets = gitTargets(nodes, worktrees, folder, repos);
    /* The chip names one checkout's branch, or the repositories over a folder of several. */
    const named = worktree === null && repos.length > 1;
    const only = named ? null : (checkouts[0] ?? null);
    const target: GitTarget = targets.find((entry) => entry.cwd === only?.path) ?? {
        cwd: only?.path ?? null,
        label: only?.label ?? '',
        branch: null,
        kind: only?.path === folder ? 'project' : 'repo'
    };
    const worktreeTarget = worktree === null ? null : (targets.find((entry) => entry.cwd === worktree.path) ?? null);
    const changes = checkouts.reduce((count, checkout) => count + (checkout.status?.files.length ?? 0), 0);
    const several = repos.length > 1;
    const folderRepo = repos.find((repo) => repo.path === folder)?.label ?? basenameOf(folder);
    const insideNames = worktree === null ? '' : nodeNames(nodesInWorktree(projectNodes, worktree));

    /* A repository of the folder that is a row of its own says how far it is from its upstream and which branch it is on. */
    const repoOfRow = (row: FileTreeVisibleRow) => repoRows.get(isDirectoryPath(row.path) ? row.path : `${row.path}/`);

    /* Only a listing that came back empty says so: a folder still loading, or holding only hidden entries, draws no line. */
    const emptyFolderLabel = (row: FileTreeVisibleRow): string | undefined =>
        root !== null && cache.get(absoluteOf(root, row.path))?.length === 0 ? t('files.emptyFolder') : undefined;

    const decorate = (row: FileTreeVisibleRow): ReactNode => {
        const checkout = repoOfRow(row);
        const parts = checkout === undefined ? [] : repoParts(checkout.status);

        return (
            <>
                <SlotRow place="fileRowBadge" context={{ file: fileInfoOf(row.path) }} />
                {parts.length > 0 && <GitTreeMarks parts={parts} />}
            </>
        );
    };

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
        if (!cache.has(root)) {
            return <EmptyState busy>{t('files.reading', { name: basenameOf(root) })}</EmptyState>;
        }
        if (treeInput.paths.length > 0) {
            return null;
        }
        if (!showHidden && (cache.get(root)?.length ?? 0) > 0) {
            return <EmptyState icon={Folder}>{t('files.onlyHidden')}</EmptyState>;
        }
        return (
            <EmptyState
                scene={<FilesScene />}
                title={t('files.emptyTitle')}
                action={
                    <Button size="sm" variant="secondary" onClick={() => startCreate('file', creationParentOf(selectionRef.current[0] ?? null))}>
                        <Icon icon={FilePlus} size={14} /> {t('files.create.file')}
                    </Button>
                }
            >
                {t('files.empty')}
            </EmptyState>
        );
    };

    const empty = placeholder();

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            {/* The panel's name gives way to the chip, which says where the tree stands. */}
            <PanelHeaderTitleHidden />
            <PanelHeaderLeadingSlot>
                <BranchMenu
                    target={target}
                    targets={targets}
                    branch={only?.status?.branch ?? null}
                    detached={only?.status?.detached ?? false}
                    nested={named}
                    worktree={worktreeTarget}
                    worktrees={worktrees}
                    nodes={projectNodes}
                    projectBranch={worktree === null ? (only?.status?.branch ?? null) : null}
                    folderLabel={basenameOf(folder)}
                    projectChanges={worktree === null ? changes : null}
                    worktreeRepo={several ? folderRepo : null}
                    busy={false}
                    onOpenMenu={() => worktreeLists.reload(endpointId, folder)}
                    onEnterWorktree={enterWorktree}
                    onLeaveWorktree={leaveWorktree}
                />
            </PanelHeaderLeadingSlot>
            <PanelHeaderSlot>
                <PanelHeaderActions>
                    <ButtonGroup key="create">
                        <IconButton
                            icon={FilePlus}
                            label={t('files.create.file')}
                            onClick={() => startCreate('file', creationParentOf(selectionRef.current[0] ?? null))}
                        />
                        <IconButton
                            icon={FolderPlus}
                            label={t('files.create.folder')}
                            onClick={() => startCreate('directory', creationParentOf(selectionRef.current[0] ?? null))}
                        />
                    </ButtonGroup>
                    <Menu.Root key="more">
                        <IconButton icon={MoreHorizontal} label={t('common:action.more')} render={<Menu.Trigger />} />
                        <Menu.Popup align="end">
                            <Menu.Item onClick={() => useUi.getState().openFindInFiles()}>
                                <Icon icon={FileSearch} size={14} /> {t('file.empty.findInFiles')} <RowKbd row="find-in-files" />
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
                            <Menu.Item onClick={reloadListed}>
                                <Icon icon={RefreshCw} size={14} /> {t('file.menu.refresh')}
                            </Menu.Item>
                        </Menu.Popup>
                    </Menu.Root>
                </PanelHeaderActions>
            </PanelHeaderSlot>
            {worktree !== null && (
                <WorktreeBar label={several ? folderRepo : t('git.worktree.label')} names={insideNames} tooltip={worktree.path}>
                    <Button size="xs" onClick={leaveWorktree}>
                        <Icon icon={ArrowLeft} size={12} />
                        {t('files.root.project')}
                    </Button>
                </WorktreeBar>
            )}
            <div className="flex shrink-0 px-2 pt-2">
                <Input
                    icon={Search}
                    className="min-w-0 grow"
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
                    end={
                        searching && (
                            <>
                                {currentSearch?.kind === 'ready' && (
                                    <span className="text-xs text-text-faint tabular-nums" aria-label={t('files.matches', { count: matches.length })}>
                                        {formatNumber(matches.length)}
                                    </span>
                                )}
                                <IconButton icon={X} size="xs" label={t('files.clearFilter')} onClick={() => setQuery('')} />
                            </>
                        )
                    }
                />
            </div>
            {empty !== null ? (
                <div className="grid min-h-0 grow place-items-center">{empty}</div>
            ) : (
                <div className="relative flex min-h-0 grow flex-col overflow-hidden">
                    <ContextMenu.Root>
                        <ContextMenu.Trigger
                            render={<div />}
                            /* The padding is on the frame, not the scroller, so the first row never slides under the filter. */
                            className="min-h-0 grow overflow-hidden pt-2"
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
                            <FileTree.Root
                                key={searching ? 'search' : 'tree'}
                                model={activeModel}
                                className="h-full min-h-0"
                                label={t('shell:panel.names.files')}
                                resetKey={root}
                                onActivate={openPath}
                                onFocusMove={followQuickLook}
                                onKeyDownCapture={onTreeKey}
                                onRowDragStart={onDragStart}
                                renderDecoration={decorate}
                                decorationOrder="after-status"
                                rowIcon={(row) => (repoOfRow(row) === undefined ? undefined : FolderGit2)}
                                highlight={searching ? query.trim() : ''}
                                emptyLabel={searching ? undefined : emptyFolderLabel}
                            />
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
                                    <FileCopyRow targets={copyTargets} />
                                    <ContextMenu.Separator />
                                    <ContextMenu.Item
                                        className="text-status-error"
                                        onClick={() =>
                                            setDeleting({
                                                absolutes: menuTargets.map((treePath) => absoluteOf(root, treePath).replace(/\/+$/, '')),
                                                directory: false
                                            })
                                        }
                                    >
                                        <Icon icon={Trash2} size={14} /> {t('files.deleteMany', { count: menuTargets.length })}
                                    </ContextMenu.Item>
                                </>
                            ) : (
                                <>
                                    {menuPath !== null && (
                                        <>
                                            <ContextMenu.Item onClick={onMenuPath((_absolute, treePath) => openPath(treePath))}>
                                                <Icon icon={FolderOpen} size={14} /> {t('common:action.open')}
                                            </ContextMenu.Item>
                                            {changedFile !== null && (
                                                <ContextMenu.Item onClick={openChanges}>
                                                    <Icon icon={FileDiff} size={14} /> {t('git.list.openChanges')}
                                                </ContextMenu.Item>
                                            )}
                                            <ContextMenu.Separator />
                                            <ContextMenu.Item
                                                onClick={onMenuPath((absolute, treePath) =>
                                                    setRenaming({ absolute: absolute.replace(/\/+$/, ''), directory: isDirectoryPath(treePath) })
                                                )}
                                            >
                                                <Icon icon={Pencil} size={14} /> {t('files.rename.menu')}
                                            </ContextMenu.Item>
                                        </>
                                    )}
                                    <ContextMenu.Item onClick={() => startFromMenu('file', creationParentOf(menuPath))}>
                                        <Icon icon={FilePlus} size={14} /> {t('files.create.file')}
                                    </ContextMenu.Item>
                                    <ContextMenu.Item onClick={() => startFromMenu('directory', creationParentOf(menuPath))}>
                                        <Icon icon={FolderPlus} size={14} /> {t('files.create.folder')}
                                    </ContextMenu.Item>
                                    {menuPath !== null && (
                                        <>
                                            <ContextMenu.Separator />
                                            {isDirectoryPath(menuPath) ? (
                                                <>
                                                    <ContextMenu.Item onClick={onMenuPath((absolute) => revealFile(transport, absolute))}>
                                                        <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
                                                    </ContextMenu.Item>
                                                    <ContextMenu.Separator />
                                                    <FileCopyRow targets={copyTargets} />
                                                </>
                                            ) : (
                                                <FileActionItems path={absoluteOf(root, menuPath)} on="files" />
                                            )}
                                            <ContextMenu.Separator />
                                            <ContextMenu.Item
                                                className="text-status-error"
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
            {/* A name that matches nothing may still be a word inside a file, so the filter hands on to find in files. */}
            {searching && (
                <div className="shrink-0 border-t border-border p-1">
                    <Button className="w-full justify-start" onClick={() => useUi.getState().openFindInFiles(query.trim())}>
                        <Icon icon={FileSearch} size={14} />
                        <span className="grow truncate text-left">{t('file.empty.findInFiles')}</span>
                        <RowKbd variant="inline" row="find-in-files" />
                    </Button>
                </div>
            )}
            <PromptDialog
                open={renaming !== null}
                title={
                    renaming === null
                        ? t('files.rename.fallback')
                        : t(renaming.directory ? 'files.rename.folderTitle' : 'files.rename.fileTitle', { name: basenameOf(renaming.absolute) })
                }
                description={t('files.rename.description')}
                field={{ mono: true, label: t('files.rename.name'), initial: renaming === null ? '' : basenameOf(renaming.absolute) }}
                confirmLabel={t('files.rename.confirm')}
                onConfirm={confirmRename}
                onOpenChange={() => setRenaming(null)}
            />
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

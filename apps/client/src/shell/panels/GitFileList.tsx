import {
    Fragment,
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
import clsx from 'clsx';
import type { FileTree as FileTreeModel, FileTreeRowDecoration, FileTreeRowDecorationContext, FileTreeVisibleRow } from '@pierre/trees';
import { FileTree, useFileTree, useFileTreeSelector } from '@pierre/trees/react';
import {
    AtSign,
    Boxes,
    ChevronDown,
    ChevronsDownUp,
    ChevronsUpDown,
    Copy,
    CornerUpRight,
    EyeOff,
    FileDiff,
    FileText,
    FileX,
    Folder,
    FolderGit2,
    GitBranch,
    Minus,
    Plus,
    Trash2
} from 'lucide-react';
import type { GitFile } from '@ruimte/contracts';
import { GIT_LIST_ROW } from '@/shell/panels/classes';
import { mentionOf, revealableInFiles } from '@/shell/panels/files-tree';
import {
    allDirs,
    branchesUnder,
    checkOf,
    checkOfAll,
    checkPart,
    collapseKey,
    dirPathOf,
    entriesOf,
    entriesUnder,
    entryParts,
    expansionChanges,
    GIT_GROUPS,
    gitTreeScope,
    groupKey,
    mergeCollapsedPaths,
    movingPaths,
    repoKey,
    shownFile,
    stopBeside,
    toggleOf,
    type CheckState,
    type DecorationPart,
    type GitEntry,
    type GitGroup,
    type GitTreeRow
} from '@/shell/panels/git-tree';
import {
    directoryHandle,
    extendsSelection,
    focusRow,
    followFocus,
    menuTargetsOf,
    movesFocus,
    rowPathOf,
    selectOnly,
    PANEL_TREE_CSS,
    PANEL_TREE_ROW_HEIGHT
} from '@/shell/panels/panel-tree';
import { setDragging } from '@/shell/view-drag';
import { useFiles } from '@/state/files';
import { useGit } from '@/state/git';
import type { GitCheckout } from '@/state/git-repos';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { Checkbox, copyText, FILE_TREE_ICONS, Icon, PanelEmpty, SectionLabel, ContextMenu } from '@basmilius/desktop-ui';

/* Opening a folder brings rows into view that may have to fold up in turn, so folding settles over
   a few passes; a tree that never settles stops here rather than looping. */
const EXPANSION_PASSES = 32;

/* The marks of a checkbox, drawn in the color of its part. */
const svgMask = (path: string): string =>
    `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%23000' stroke-width='0.875' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='${path}'/%3E%3C/svg%3E")`;
const CHECK_MASK = svgMask('M2.5 6.25 4.75 8.5 9.5 3.5');
const MIXED_MASK = svgMask('M3 6h6');

/*
 * This panel's own rules, over the shared ones. Every row here is a change, so the news rides on
 * the parts of the decoration and a name keeps the panel's color; the tree left to itself paints
 * every name and icon in its status. The tree has no place for a checkbox, so the decoration is
 * laid open into the row: its first part is the box, moved in front of the icon, and the rest stay
 * at the end. The part names its state in the custom property its color comes from (`checkPart`),
 * which is the one thing about a part this stylesheet can see. The counts are set in the mono face
 * at the floor this app puts under type, which keeps a column of them straight.
 */
const GIT_TREE_CSS = `
    ${PANEL_TREE_CSS}
    :host {
        --git-check-checked: var(--accent-text);
        --git-check-mixed: var(--accent-text);
        --git-check-unchecked: transparent;
    }
    [data-item-section="spacing"] { order: -2; }
    [data-item-section="content"] { flex: 1 1 auto; }
    [data-item-section="decoration"], [data-item-section="decoration"] > span { display: contents; }
    [data-item-section="decoration"] span { flex: none; font-family: var(--font-mono); font-size: 12px; }
    [data-item-section="decoration"] [style*="--git-check-"] {
        order: -1;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-sm);
        background: var(--surface);
    }
    [data-item-section="decoration"] :is([style*="--git-check-checked"], [style*="--git-check-mixed"]) {
        border-color: var(--accent);
        background: var(--accent);
    }
    [data-item-section="decoration"] :is([style*="--git-check-checked"], [style*="--git-check-mixed"])::after {
        content: "";
        width: 12px;
        height: 12px;
        background: currentColor;
        mask: ${CHECK_MASK} center / 12px 12px no-repeat;
    }
    [data-item-section="decoration"] [style*="--git-check-mixed"]::after { mask-image: ${MIXED_MASK}; }
`;

/* The mark a repository row carries: a module git tracks for the project reads apart from one that
   only happens to sit beside it. */
const REPO_ICONS = { root: FolderGit2, nested: FolderGit2, submodule: Boxes, worktree: GitBranch } as const;

/* A file git no longer has on disk: opening it or revealing it would point at nothing. */
const isGone = (entry: GitEntry): boolean => [entry.staged, entry.worktree].some((file) => file?.status.startsWith('D') === true);

/* What moving a new file to the trash names: the index side first, so it is taken out of the index too. */
const newFileOf = (entry: GitEntry): GitFile => (entry.staged ?? entry.worktree)!;

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

/* Whether a click landed on a row's checkbox, which lives in the tree's shadow root. */
const onCheckbox = (event: { nativeEvent: Event }): boolean =>
    event.nativeEvent.composedPath().some((node) => node instanceof HTMLElement && node.style.color.startsWith('var(--git-check-'));

/* The decoration of one row: its box, unless it is a conflict, and what follows the name. */
const decorationOf = (box: CheckState | null, parts: DecorationPart[]): FileTreeRowDecoration => {
    const all = box === null ? parts : [checkPart(box), ...parts];
    return { text: all.map((part) => part.text).join(' '), parts: all };
};

/* What a stop of the list does when the keyboard arrives at it, or moves on to another one. */
interface Stop {
    focusFirst(): void;
    focusLast(): void;
    /* Lets go of the selection, since the list has one selection across all its trees. */
    release(): void;
}

/*
 * The keyboard over the whole list. A group, a repository and the tree under them are stops in one
 * order, so an arrow key that runs off the end of one goes on into the next, and Home and End reach
 * the ends of the list rather than of one tree.
 */
interface ListNav {
    register(id: string, stop: Stop): () => void;
    move(from: string, step: 1 | -1): void;
    edge(last: boolean): void;
    parent(id: string): void;
    claim(id: string): void;
}

const groupId = (group: GitGroup): string => `group:${group}`;
const repoId = (group: GitGroup, cwd: string): string => `repo:${group}:${cwd}`;
const treeId = (group: GitGroup, cwd: string): string => `tree:${group}:${cwd}`;

/* The changes of one checkout in one group. */
interface Section {
    checkout: GitCheckout;
    entries: GitEntry[];
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
    /* A row dragged onto the grid, which opens its diff where it lands. */
    onDrag(cwd: string, file: GitFile, transfer: DataTransfer): void;
    onStage(cwd: string, paths: string[], staged: boolean): void;
    onDiscard(cwd: string, files: GitFile[]): void;
    onDelete(cwd: string, files: GitFile[]): void;
}

/*
 * The changed files, grouped the way a person acts on them: conflicts first, then every change git
 * tracks, then what it has never seen. A group holds a tree per repository, each of the folders its
 * files sit in, the same tree the Files panel draws, so a path reads the same on both sides of the
 * window. A folder with one repository has no row for it and reads as it always did. Every row has
 * a box that says whether it is in the index, and ticking it stages or unstages all of it; the
 * commit is still what is staged. A row opens its diff in the preview panel; a right click offers
 * the things a row has no room for: the file itself, the two reveals, the paths.
 */
export function GitFileList({ checkouts, collapsed, reading, reposTruncated, busy, onOpen, onOpenFile, onDrag, onStage, onDiscard, onDelete }: ListProps) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const folder = useProject((s) => s.current?.folder ?? null);
    const stopsRef = useRef(new Map<string, Stop>());
    const orderRef = useRef<readonly string[]>([]);
    const parentsRef = useRef<ReadonlyMap<string, string>>(new Map());

    const entries = useMemo(() => new Map(checkouts.map((checkout) => [checkout.path, entriesOf(checkout.status?.files ?? [])])), [checkouts]);
    const folded = useMemo(() => new Set(collapsed), [collapsed]);
    /* A folder with one repository names none: the row would say what the header already says. */
    const named = checkouts.length > 1;
    const groups = useMemo(
        () =>
            GIT_GROUPS.map((group) => ({
                group,
                sections: checkouts
                    .map((checkout) => ({ checkout, entries: (entries.get(checkout.path) ?? []).filter((entry) => entry.group === group) }))
                    .filter((section: Section) => section.entries.length > 0)
            })).filter(({ sections }) => sections.length > 0),
        [checkouts, entries]
    );

    const nav = useMemo<ListNav>(
        () => ({
            register: (id, stop) => {
                stopsRef.current.set(id, stop);
                return () => {
                    if (stopsRef.current.get(id) === stop) {
                        stopsRef.current.delete(id);
                    }
                };
            },
            move: (from, step) => {
                const to = stopBeside(orderRef.current, (id) => stopsRef.current.has(id), from, step);
                const stop = to === null ? undefined : stopsRef.current.get(to);
                if (step > 0) {
                    stop?.focusFirst();
                } else {
                    stop?.focusLast();
                }
            },
            edge: (last) => {
                const present = orderRef.current.filter((id) => stopsRef.current.has(id));
                const stop = stopsRef.current.get((last ? present.at(-1) : present[0]) ?? '');
                if (last) {
                    stop?.focusLast();
                } else {
                    stop?.focusFirst();
                }
            },
            parent: (id) => {
                const parent = parentsRef.current.get(id);
                if (parent !== undefined) {
                    stopsRef.current.get(parent)?.focusFirst();
                }
            },
            claim: (id) => {
                for (const [other, stop] of stopsRef.current) {
                    if (other !== id) {
                        stop.release();
                    }
                }
            }
        }),
        []
    );

    /* The order of the stops and who stands over whom, as the list is drawn now. */
    useEffect(() => {
        const order: string[] = [];
        const parents = new Map<string, string>();
        for (const { group, sections } of groups) {
            order.push(groupId(group));
            for (const { checkout } of sections) {
                const tree = treeId(group, checkout.path);
                if (named) {
                    order.push(repoId(group, checkout.path));
                    parents.set(repoId(group, checkout.path), groupId(group));
                }
                order.push(tree);
                parents.set(tree, named ? repoId(group, checkout.path) : groupId(group));
            }
        }
        orderRef.current = order;
        parentsRef.current = parents;
    }, [groups, named]);

    const read = checkouts.filter((checkout) => checkout.status !== null);
    if (checkouts.length === 0 || (read.length > 0 && read.every((checkout) => checkout.status?.repo !== true))) {
        return <PanelEmpty icon={GitBranch}>{t('git.list.noRepo')}</PanelEmpty>;
    }
    if (read.length === 0) {
        return <div className="grid min-h-0 grow place-items-center" />;
    }
    if (groups.length === 0) {
        return <PanelEmpty icon={GitBranch}>{t('git.list.noChanges')}</PanelEmpty>;
    }

    const truncated = reposTruncated || read.some((checkout) => checkout.status?.truncated === true);
    const toggleAll = (sections: readonly Section[]): void => {
        const all = sections.flatMap((section) => section.entries);
        const staged = checkOfAll(all) !== 'checked';
        for (const section of sections) {
            onStage(section.checkout.path, movingPaths(section.entries, staged), staged);
        }
    };

    return (
        <div className="min-h-0 grow overflow-y-auto py-1">
            {groups.map(({ group, sections }) => {
                const label = t(`git.group.${group}`);
                const open = !folded.has(groupKey(group));
                const count = sections.reduce((sum, section) => sum + section.entries.length, 0);
                return (
                    <section key={group}>
                        <ListRow
                            id={groupId(group)}
                            nav={nav}
                            className="h-7 pl-2.5"
                            expanded={open}
                            check={group === 'conflicts' ? null : checkOfAll(sections.flatMap((section) => section.entries))}
                            checkLabel={t('git.list.stageGroup', { group: label })}
                            busy={busy}
                            onFold={() => useGit.getState().toggleDir(groupKey(group))}
                            onCheck={() => toggleAll(sections)}
                        >
                            <SectionLabel className="truncate">{label}</SectionLabel>
                            <span className="grow" />
                            <span className="shrink-0 tabular-nums text-text-faint">{t('git.list.files', { count })}</span>
                        </ListRow>
                        {open &&
                            sections.map(({ checkout, entries: sectionEntries }) => {
                                const repoOpen = !named || !folded.has(repoKey(checkout.path, group));
                                return (
                                    <Fragment key={checkout.path}>
                                        {named && (
                                            <RepoRow
                                                group={group}
                                                checkout={checkout}
                                                entries={sectionEntries}
                                                expanded={repoOpen}
                                                folder={folder}
                                                platform={platform}
                                                nav={nav}
                                                busy={busy}
                                                onStage={(paths, staged) => onStage(checkout.path, paths, staged)}
                                            />
                                        )}
                                        {repoOpen && (
                                            <GitRepoTree
                                                id={treeId(group, checkout.path)}
                                                nav={nav}
                                                group={group}
                                                checkout={checkout}
                                                entries={sectionEntries}
                                                nested={named}
                                                folder={folder}
                                                platform={platform}
                                                collapsed={collapsed}
                                                reading={reading?.cwd === checkout.path ? reading.path : null}
                                                busy={busy}
                                                onOpen={(file) => onOpen(checkout.path, file)}
                                                onOpenFile={(file) => onOpenFile(checkout.path, file)}
                                                onDrag={(file, transfer) => onDrag(checkout.path, file, transfer)}
                                                onStage={(paths, staged) => onStage(checkout.path, paths, staged)}
                                                onDiscard={(files) => onDiscard(checkout.path, files)}
                                                onDelete={(files) => onDelete(checkout.path, files)}
                                            />
                                        )}
                                    </Fragment>
                                );
                            })}
                    </section>
                );
            })}
            {truncated && <p className="px-3 py-2 text-xs text-text-faint">{t('diff.moreFiles')}</p>}
        </div>
    );
}

interface ListRowProps {
    id: string;
    nav: ListNav;
    className: string;
    expanded: boolean;
    /* Null for a row without a box, which is a conflict: it is staged on purpose, from its menu. */
    check: CheckState | null;
    checkLabel: string;
    busy: boolean;
    onFold(): void;
    onCheck(): void;
    children: ReactNode;
}

/*
 * A group or a repository: a box, the chevron that folds what is under it, and what the row says
 * about it. It answers the keys a row of the trees answers, so the list reads as one tree.
 */
function ListRow({ id, nav, className, expanded, check, checkLabel, busy, onFold, onCheck, children }: ListRowProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(
        () =>
            nav.register(id, {
                focusFirst: () => ref.current?.focus(),
                focusLast: () => ref.current?.focus(),
                release: () => undefined
            }),
        [id, nav]
    );

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.altKey || event.metaKey || event.ctrlKey) {
            return;
        }
        switch (event.key) {
            case 'ArrowDown':
                nav.move(id, 1);
                break;
            case 'ArrowUp':
                nav.move(id, -1);
                break;
            case 'ArrowRight':
                if (expanded) {
                    nav.move(id, 1);
                } else {
                    onFold();
                }
                break;
            case 'ArrowLeft':
                if (expanded) {
                    onFold();
                } else {
                    nav.parent(id);
                }
                break;
            case 'Home':
            case 'End':
                nav.edge(event.key === 'End');
                break;
            case 'Enter':
                onFold();
                break;
            case ' ':
                // The box is a button of its own and toggles itself on the same key.
                if (event.target !== event.currentTarget) {
                    return;
                }
                if (check !== null && !busy) {
                    onCheck();
                }
                break;
            default:
                return;
        }
        event.preventDefault();
        event.stopPropagation();
    };

    return (
        <div
            ref={ref}
            role="button"
            tabIndex={-1}
            aria-expanded={expanded}
            className={clsx(GIT_LIST_ROW, className)}
            onClick={onFold}
            onKeyDown={onKeyDown}
            onFocus={() => nav.claim(id)}
        >
            {check !== null && (
                // A click on the box is not a click on the row, which would fold it.
                <span className="flex shrink-0" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                        checked={check === 'checked'}
                        indeterminate={check === 'mixed'}
                        label={checkLabel}
                        disabled={busy}
                        onCheckedChange={() => onCheck()}
                    />
                </span>
            )}
            <Icon icon={ChevronDown} size={12} className={clsx('shrink-0 text-text-faint transition-transform', !expanded && '-rotate-90')} />
            {children}
        </div>
    );
}

interface RepoRowProps {
    group: GitGroup;
    checkout: GitCheckout;
    entries: GitEntry[];
    expanded: boolean;
    folder: string | null;
    platform: string | null;
    nav: ListNav;
    busy: boolean;
    onStage(paths: string[], staged: boolean): void;
}

/* One repository's share of a group, while the folder holds more than one: its kind, its name, how
   many files it changed and the branch it is on. */
function RepoRow({ group, checkout, entries, expanded, folder, platform, nav, busy, onStage }: RepoRowProps) {
    const { t } = useTranslation('panels');
    const branch = checkout.status?.branch ?? null;
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger render={<div className="contents" />}>
                <ListRow
                    id={repoId(group, checkout.path)}
                    nav={nav}
                    className="h-6 pl-6.5"
                    expanded={expanded}
                    check={group === 'conflicts' ? null : checkOfAll(entries)}
                    checkLabel={t('git.repo.stageAll', { repo: checkout.label })}
                    busy={busy}
                    onFold={() => useGit.getState().toggleDir(repoKey(checkout.path, group))}
                    onCheck={() => {
                        const toggle = toggleOf(entries);
                        onStage(toggle.paths, toggle.staged);
                    }}
                >
                    <Icon icon={REPO_ICONS[checkout.kind]} size={12} className="shrink-0 text-text-faint" />
                    <span className="min-w-0 truncate text-text-muted">{checkout.label}</span>
                    <span className="grow" />
                    <span className="shrink-0 tabular-nums text-text-faint">{entries.length}</span>
                    {branch !== null && <span className="max-w-32 shrink-0 truncate rounded-sm bg-surface-active px-1.5 text-text-muted">{branch}</span>}
                </ListRow>
            </ContextMenu.Trigger>
            <ContextMenu.Popup>
                <ContextMenu.Item onClick={() => useGit.getState().toggleRepo(checkout.label)}>
                    <Icon icon={EyeOff} size={14} /> {t('git.repo.hide')}
                </ContextMenu.Item>
                <ContextMenu.Separator />
                <RowPathItems absolute={checkout.path} relative={checkout.label} folder={folder} platform={platform} gone={false} />
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

interface TreeProps {
    id: string;
    nav: ListNav;
    group: GitGroup;
    checkout: GitCheckout;
    entries: GitEntry[];
    /* Whether the tree stands under a repository row, one level deeper than under its group. */
    nested: boolean;
    folder: string | null;
    platform: string | null;
    collapsed: string[];
    reading: string | null;
    busy: boolean;
    onOpen(file: GitFile): void;
    onOpenFile(file: GitFile): void;
    onDrag(file: GitFile, transfer: DataTransfer): void;
    onStage(paths: string[], staged: boolean): void;
    onDiscard(files: GitFile[]): void;
    onDelete(files: GitFile[]): void;
}

/*
 * One repository's share of one group, as a tree of its own. The trees share the folded-up folders
 * and nothing else: the same folder name in another repository or another group stays its own. Each
 * tree is exactly as tall as its rows, so all of them scroll as one list.
 */
function GitRepoTree({
    id,
    nav,
    group,
    checkout,
    entries,
    nested,
    folder,
    platform,
    collapsed,
    reading,
    busy,
    onOpen,
    onOpenFile,
    onDrag,
    onStage,
    onDiscard,
    onDelete
}: TreeProps) {
    const { t } = useTranslation('panels');
    const conflicts = group === 'conflicts';
    const root = checkout.path;
    const scope = gitTreeScope(root, group);
    /* The rows the open context menu acts on: one, or the whole selection when the row is part of one. */
    const [menuPaths, setMenuPaths] = useState<string[]>([]);
    const byPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
    const entriesRef = useRef<readonly GitEntry[]>([]);
    const byPathRef = useRef<ReadonlyMap<string, GitEntry>>(new Map());
    const conflictsRef = useRef(conflicts);
    const collapsedRef = useRef<ReadonlySet<string>>(new Set());
    const scopeRef = useRef(scope);
    /* Set while this component folds the tree, so the folding is not read back as a person's doing. */
    const applyingRef = useRef(false);
    /* The collapse set the tree last stood by, to tell which folders just folded. */
    const foldedRef = useRef<readonly string[] | null>(null);

    /* The tree keeps the renderer it was made with, so this reads the entries of the moment. */
    const decorate = useCallback(({ item }: FileTreeRowDecorationContext): FileTreeRowDecoration | null => {
        if (item.kind === 'directory') {
            const under = entriesUnder(entriesRef.current, dirPathOf(item.path));
            return under.length === 0 ? null : decorationOf(conflictsRef.current ? null : checkOfAll(under), [{ text: String(under.length) }]);
        }
        const entry = byPathRef.current.get(item.path);
        return entry === undefined ? null : decorationOf(conflictsRef.current ? null : checkOf(entry), entryParts(entry));
    }, []);

    const { model } = useFileTree({
        paths: [],
        composition: { contextMenu: { enabled: false } },
        density: 'compact',
        itemHeight: PANEL_TREE_ROW_HEIGHT,
        // One file at a time, and never a conflict: its three versions are no diff to open.
        dragAndDrop: {
            canDrag: (paths) => !conflictsRef.current && paths.length === 1 && byPathRef.current.has(paths[0]!),
            canDrop: () => false
        },
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
        entriesRef.current = entries;
        byPathRef.current = byPath;
        conflictsRef.current = conflicts;
        collapsedRef.current = new Set(collapsed);
        scopeRef.current = scope;
    }, [byPath, collapsed, conflicts, entries, scope]);

    useEffect(() => {
        const paths = entries.map((entry) => entry.path);
        const key = paths.join('\n');
        if (builtRef.current === key) {
            // The same rows in another state: a box that was ticked, a count that moved.
            model.setComposition(model.getComposition());
            return;
        }
        builtRef.current = key;
        const selected = model.getSelectedPaths();
        const focused = model.getFocusedPath();
        const typing = document.activeElement !== null && document.activeElement === model.getFileTreeContainer();
        applyingRef.current = true;
        model.resetPaths(paths);
        applyExpansion(model, collapsedRef.current, scopeRef.current);
        applyingRef.current = false;
        for (const path of selected) {
            model.getItem(path)?.select();
        }
        // A row that went (discarded, deleted) hands the keyboard to the one nearest to it.
        const next = !typing || focused === null ? null : model.getItem(focused) !== null ? focused : model.focusNearestPath(focused);
        if (next !== null) {
            focusRow(model, next);
        }
    }, [entries, model]);

    useEffect(() => {
        const before = foldedRef.current;
        foldedRef.current = collapsed;
        const branches = before === null ? [] : branchesUnder(before, collapsed, allDirs(entriesRef.current.map((entry) => entry.path)), scope);
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

    /* The tree follows the preview: the file whose diff is open is the row that reads as selected. A
       selection of several rows is a person's own, and a new tab does not take it away. */
    useEffect(() => {
        if (model.getSelectedPaths().length > 1) {
            return;
        }
        selectOnly(model, reading !== null && model.getItem(reading) !== null ? reading : null);
    }, [model, reading]);

    useEffect(() => {
        const focusAt = (index: number): void => {
            const row = model.getVisibleRows(index, index)[0];
            if (row !== undefined) {
                selectOnly(model, pathOfRow(row));
                focusRow(model, pathOfRow(row));
            }
        };
        return nav.register(id, {
            focusFirst: () => focusAt(0),
            focusLast: () => focusAt(model.getVisibleCount() - 1),
            release: () => selectOnly(model, null)
        });
    }, [id, model, nav]);

    /* The entries a set of rows stands for: a folder is every file under it. */
    const entriesOfRows = (rows: readonly string[]): GitEntry[] => {
        const found = new Map<string, GitEntry>();
        for (const row of rows) {
            const direct = byPath.get(row);
            for (const entry of direct === undefined ? entriesUnder(entries, dirPathOf(row)) : [direct]) {
                found.set(entry.path, entry);
            }
        }
        return [...found.values()];
    };

    const toggleRows = (rows: readonly string[]): void => {
        if (conflicts || busy) {
            return;
        }
        const toggle = toggleOf(entriesOfRows(rows));
        onStage(toggle.paths, toggle.staged);
    };

    const openRow = (path: string): void => {
        const entry = byPath.get(path);
        if (entry !== undefined) {
            onOpen(shownFile(entry));
        } else {
            directoryHandle(model, path)?.toggle();
        }
    };

    /* The keys the tree does not answer itself, and the ones that leave it for another stop. */
    const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLElement>): void => {
        if (event.altKey || event.metaKey || event.ctrlKey) {
            return;
        }
        const index = model.getFocusedIndex();
        const row = index < 0 ? undefined : model.getVisibleRows(index, index)[0];
        if (row === undefined) {
            return;
        }
        const plain = !event.shiftKey;
        const leave = (go: () => void): void => {
            event.preventDefault();
            event.stopPropagation();
            go();
        };
        if (event.key === 'ArrowUp' && plain && index === 0) {
            leave(() => nav.move(id, -1));
        } else if (event.key === 'ArrowDown' && plain && index === model.getVisibleCount() - 1) {
            leave(() => nav.move(id, 1));
        } else if (event.key === 'ArrowLeft' && plain && row.depth === 0 && !(row.kind === 'directory' && row.isExpanded)) {
            leave(() => nav.parent(id));
        } else if ((event.key === 'Home' || event.key === 'End') && plain) {
            leave(() => nav.edge(event.key === 'End'));
        } else if (event.key === 'Enter') {
            leave(() => openRow(pathOfRow(row)));
        } else if (event.key === ' ') {
            leave(() => toggleRows(menuTargetsOf(pathOfRow(row), model.getSelectedPaths())));
        } else if (movesFocus(event)) {
            followFocus(model);
        }
    };

    /* A click on a box ticks that row alone and is kept from the tree, which would select the row and fold a folder. */
    const onClickCapture = (event: ReactMouseEvent<HTMLElement>): void => {
        if (!onCheckbox(event)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const path = rowPathOf(event);
        if (path !== null) {
            toggleRows([path]);
        }
    };

    const onClick = (event: ReactMouseEvent<HTMLElement>): void => {
        if (extendsSelection(event)) {
            return;
        }
        const path = rowPathOf(event);
        const entry = path === null ? undefined : byPath.get(path);
        if (entry !== undefined) {
            onOpen(shownFile(entry));
        }
    };

    const onDragStart = (event: ReactDragEvent<HTMLElement>): void => {
        const path = rowPathOf(event);
        const entry = path === null ? undefined : byPath.get(path);
        if (entry !== undefined && !conflicts) {
            onDrag(shownFile(entry), event.dataTransfer);
        }
    };

    const manyTargets = menuPaths.length > 1;
    const menuPath = manyTargets ? null : (menuPaths[0] ?? null);
    /* Every entry the selection stands for: a folder in it is the files under it. */
    const menuEntries = entriesOfRows(menuPaths);
    const toStage = menuEntries.filter((entry) => entry.worktree !== null);
    const toUnstage = menuEntries.filter((entry) => entry.staged !== null);
    const newFiles = group === 'unversioned' ? menuEntries.map(newFileOf) : [];
    const copyEntries = (line: (entry: GitEntry) => string | null, separator: string): void => {
        copyText(
            menuEntries
                .map(line)
                .filter((text): text is string => text !== null)
                .join(separator)
        );
    };
    const menuEntry = menuPath === null ? undefined : byPath.get(menuPath);
    const menuDir = menuEntry === undefined && menuPath !== null ? dirPathOf(menuPath) : null;
    const menuDirKey = menuDir === null ? null : collapseKey(scope, menuDir);
    const height = rowCount * model.getItemHeight();
    /* A conflict is staged file by file, after it has been looked at, and only as resolved; a whole
       folder or a selection of them at once is not a thing to offer behind one click. */
    const stageItems = (
        <>
            {!conflicts && toStage.length > 0 && (
                <ContextMenu.Item
                    disabled={busy}
                    onClick={() =>
                        onStage(
                            toStage.map((entry) => entry.path),
                            true
                        )
                    }
                >
                    <Icon icon={Plus} size={14} />
                    {manyTargets ? t('git.list.stageMany', { count: toStage.length }) : menuDir !== null ? t('git.list.stageHere') : t('git.list.stage')}
                </ContextMenu.Item>
            )}
            {!conflicts && toUnstage.length > 0 && (
                <ContextMenu.Item
                    disabled={busy}
                    onClick={() =>
                        onStage(
                            toUnstage.map((entry) => entry.path),
                            false
                        )
                    }
                >
                    <Icon icon={Minus} size={14} />
                    {manyTargets
                        ? t('git.list.unstageMany', { count: toUnstage.length })
                        : menuDir !== null
                          ? t('git.list.unstageHere')
                          : t('git.list.unstage')}
                </ContextMenu.Item>
            )}
        </>
    );

    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<div />}
                style={{ height }}
                onKeyDownCapture={onKeyDownCapture}
                onClickCapture={onClickCapture}
                onFocus={() => nav.claim(id)}
                onContextMenu={(event) => {
                    const row = rowPathOf(event);
                    setMenuPaths(row === null ? [] : menuTargetsOf(row, model.getSelectedPaths()));
                }}
            >
                <FileTree
                    model={model}
                    className={clsx('panel-tree', nested ? 'panel-tree-nested' : 'panel-tree-indented')}
                    onClick={onClick}
                    onDragStart={onDragStart}
                    onDragEnd={() => setDragging(null)}
                />
            </ContextMenu.Trigger>
            <ContextMenu.Popup>
                {manyTargets && menuEntries.length > 0 && (
                    <>
                        {stageItems}
                        {!conflicts && (
                            <ContextMenu.Item disabled={busy} onClick={() => onDiscard(menuEntries.map(shownFile))}>
                                <Icon icon={Trash2} size={14} /> {t('git.list.discardMany', { count: menuEntries.length })}
                            </ContextMenu.Item>
                        )}
                        {newFiles.length > 0 && (
                            <ContextMenu.Item disabled={busy} onClick={() => onDelete(newFiles)}>
                                <Icon icon={FileX} size={14} /> {t('git.list.deleteMany', { count: newFiles.length })}
                            </ContextMenu.Item>
                        )}
                        <ContextMenu.Separator />
                        <ContextMenu.Item onClick={() => copyEntries((entry) => absolutePathOf(root, entry.path), '\n')}>
                            <Icon icon={Copy} size={14} /> {t('files.copyPaths')}
                        </ContextMenu.Item>
                        <ContextMenu.Item onClick={() => copyEntries((entry) => entry.path, '\n')}>
                            <Icon icon={Copy} size={14} /> {t('files.copyRelativePaths')}
                        </ContextMenu.Item>
                        <ContextMenu.Item onClick={() => copyEntries((entry) => mentionOf(folder, absolutePathOf(root, entry.path)), ' ')}>
                            <Icon icon={AtSign} size={14} /> {t('files.copyMentions')}
                        </ContextMenu.Item>
                    </>
                )}
                {menuEntry !== undefined && (
                    <>
                        <ContextMenu.Item onClick={() => onOpen(shownFile(menuEntry))}>
                            <Icon icon={FileDiff} size={14} /> {t('git.list.openChanges')}
                        </ContextMenu.Item>
                        <ContextMenu.Item disabled={isGone(menuEntry)} onClick={() => onOpenFile(shownFile(menuEntry))}>
                            <Icon icon={FileText} size={14} /> {t('file.tab.openItself')}
                        </ContextMenu.Item>
                        <ContextMenu.Separator />
                        {/* A conflict has no box: staging one says it is resolved, which is a choice
                            made on purpose, here. */}
                        {conflicts && (
                            <ContextMenu.Item disabled={busy} onClick={() => onStage([menuEntry.path], true)}>
                                <Icon icon={Plus} size={14} /> {t('git.list.stageResolved')}
                            </ContextMenu.Item>
                        )}
                        {stageItems}
                        {/* A conflict is resolved by staging it or by a merge tool; discarding one side of it
                            silently is the one way out that loses work nobody can name afterwards. */}
                        {!conflicts && (
                            <ContextMenu.Item disabled={busy} onClick={() => onDiscard([shownFile(menuEntry)])}>
                                <Icon icon={Trash2} size={14} /> {t('git.list.discard')}
                            </ContextMenu.Item>
                        )}
                        {group === 'unversioned' && (
                            <ContextMenu.Item disabled={busy} onClick={() => onDelete([newFileOf(menuEntry)])}>
                                <Icon icon={FileX} size={14} /> {t('git.list.deleteFile')}
                            </ContextMenu.Item>
                        )}
                        <ContextMenu.Separator />
                        <RowPathItems
                            absolute={absolutePathOf(root, menuEntry.path)}
                            relative={menuEntry.path}
                            folder={folder}
                            platform={platform}
                            gone={isGone(menuEntry)}
                        />
                    </>
                )}
                {menuDir !== null && menuDirKey !== null && (
                    <>
                        <ContextMenu.Item onClick={() => useGit.getState().toggleDir(menuDirKey)}>
                            <Icon icon={collapsed.includes(menuDirKey) ? ChevronsUpDown : ChevronsDownUp} size={14} />
                            {collapsed.includes(menuDirKey) ? t('git.list.expandFolder') : t('git.list.collapseFolder')}
                        </ContextMenu.Item>
                        {stageItems}
                        <ContextMenu.Separator />
                        <RowPathItems absolute={absolutePathOf(root, menuDir)} relative={menuDir} folder={folder} platform={platform} gone={false} />
                    </>
                )}
            </ContextMenu.Popup>
        </ContextMenu.Root>
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
            <ContextMenu.Item disabled={gone || !revealableInFiles(folder, absolute)} onClick={() => useFiles.getState().revealInFiles(absolute)}>
                <Icon icon={Folder} size={14} /> {t('file.menu.revealInFiles')}
            </ContextMenu.Item>
            <ContextMenu.Item
                disabled={gone}
                onClick={() => {
                    void transport.request('fs.reveal', { path: absolute }).catch(() => undefined);
                }}
            >
                <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={() => copyText(absolute)}>
                <Icon icon={Copy} size={14} /> {t('file.menu.copyPath')}
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => copyText(relative)}>
                <Icon icon={Copy} size={14} /> {t('file.menu.copyRelativePath')}
            </ContextMenu.Item>
            {mention !== null && (
                <ContextMenu.Item onClick={() => copyText(mention)}>
                    <Icon icon={AtSign} size={14} /> {t('file.menu.copyMention')}
                </ContextMenu.Item>
            )}
        </>
    );
}

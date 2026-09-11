import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import {
    CaseSensitive,
    CornerLeftUp,
    FileSearch,
    Folder,
    FolderCheck,
    FolderPlus,
    Globe,
    LayoutGrid,
    MessageSquare,
    PenTool,
    Regex,
    Search,
    StickyNote,
    Terminal,
    WholeWord,
    Zap,
    type LucideIcon
} from 'lucide-react';
import { isCanvasView, isOpenableView, type FsBrowseEntry } from '@ruimte/contracts';
import { AgentIcon } from '@/agents/AgentIcon';
import { projectClient } from '@/project';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { ViewGlyph } from '@/project/ViewGlyph';
import { revealNode, showView } from '@/project/views';
import { appCommands, type Command } from '@/shell/commands';
import { DEFAULT_GREP_OPTIONS, useGrepSearch, type GrepOptions } from '@/shell/palette-grep';
import { PaletteGrepResults } from '@/shell/PaletteGrepResults';
import { readRecents, rememberRecent, sortByRecency } from '@/shell/palette-recents';
import { absoluteOf, basenameOf } from '@/shell/panels/files-tree';
import { useCanvas, type NodeKind } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { transport } from '@/transport';
import { desktop } from '@/desktop/bridge';
import { Button } from '@/ui/Button';
import { BTN_GROUP, SECTION_LABEL, TOOLTIP_KBD } from '@/ui/classes';
import { FileIcon } from '@/ui/FileIcon';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const KIND_ICON: Record<NodeKind, React.ReactNode> = {
    terminal: <Icon icon={Terminal} size={14} />,
    chat: <Icon icon={MessageSquare} size={14} />,
    browser: <Icon icon={Globe} size={14} />,
    group: <Icon icon={LayoutGrid} size={14} />,
    note: <Icon icon={StickyNote} size={14} />,
    drawing: <Icon icon={PenTool} size={14} />
};

// Typing a path turns the palette into a folder browser; anything else searches nodes and actions.
const isPathQuery = (query: string): boolean => query.startsWith('/') || query.startsWith('~') || query.startsWith('./') || query.startsWith('../');

const BROWSE_DEBOUNCE_MS = 60;
const FILE_DEBOUNCE_MS = 120;
// Enough to recognize the file being looked for, few enough to leave room for what else matches.
const FILE_RESULTS = 8;

interface Entry extends Command {
    icon: React.ReactNode;
    section: 'Recent' | 'Jump to' | 'Files' | 'Views' | 'Projects' | 'Actions' | 'Folders';
}

const LIST_ID = 'palette-list';
const optionId = (index: number): string => `palette-option-${index}`;

const matches = (query: string, text: string): boolean => {
    // Every typed word has to appear somewhere, in any order.
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = text.toLowerCase();
    return words.every((word) => haystack.includes(word));
};

const parentOf = (path: string): string | null => {
    const trimmed = path.replace(/\/+$/, '');
    const cut = trimmed.lastIndexOf('/');
    if (cut <= 0) {
        return trimmed === '' || trimmed === '/' ? null : '/';
    }
    return `${trimmed.slice(0, cut)}/`;
};

/* One of the three switches that narrow a search in files, drawn as the pressed gray key every
   other toggle in the app uses. */
function SearchToggle({ icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
    return (
        <Tooltip label={label} name>
            <button
                className="icon-btn h-7 w-7"
                aria-pressed={active}
                // The field keeps the keys; a toggle that takes focus would swallow the next arrow.
                onMouseDown={(e) => e.preventDefault()}
                onClick={onClick}
            >
                <Icon icon={icon} size={14} />
            </button>
        </Tooltip>
    );
}

/* Cmd+K: jump to a node, run an action, or type a path to open a folder as a project. */
export function CommandPalette() {
    const open = useUi((s) => s.paletteOpen);
    const seed = useUi((s) => s.paletteSeed);
    const setOpen = useUi((s) => s.setPaletteOpen);
    const nodes = useCanvas((s) => s.nodes);
    const order = useCanvas((s) => s.order);
    const views = useDocument((s) => s.views);
    const activeViewId = useDocument((s) => s.activeViewId);
    const folder = useProject((s) => s.current?.folder ?? null);
    const projects = useProject((s) => s.projects);
    const currentProjectId = useProject((s) => s.current?.projectId ?? null);
    const [query, setQuery] = useState('');
    const [index, setIndex] = useState(0);
    const [browse, setBrowse] = useState<{ parentPath: string; entries: FsBrowseEntry[] } | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [recents, setRecents] = useState<string[]>(readRecents);
    const [fileMatches, setFileMatches] = useState<readonly string[]>([]);
    const [grepOptions, setGrepOptions] = useState<GrepOptions>(DEFAULT_GREP_OPTIONS);
    const inputRef = useRef<HTMLInputElement>(null);
    const generation = useRef(0);
    const fileGeneration = useRef(0);
    const mode = useUi((s) => s.paletteMode);
    const grepping = mode === 'grep';
    const grep = useGrepSearch(grepping ? folder : null, grepping ? query : '', grepOptions);

    const reset = (next: string): void => {
        setQuery(next);
        setIndex(isPathQuery(next) ? -1 : 0);
        setFailure(null);
        setBrowse(null);
    };

    const [seenOpen, setSeenOpen] = useState(false);

    // Opening is driven by the store, not by the dialog, so the fresh start is derived while rendering.
    if (open !== seenOpen) {
        setSeenOpen(open);
        if (open) {
            reset(seed);
        }
    }

    const [seenMode, setSeenMode] = useState(mode);

    // Switching modes with the palette already up is a fresh start as much as opening it is.
    if (mode !== seenMode) {
        setSeenMode(mode);
        reset(seed);
    }

    // A path is a folder to browse, but only while the palette is looking for one.
    const browsing = !grepping && isPathQuery(query);

    useEffect(() => {
        if (!browsing) {
            return;
        }
        const mine = ++generation.current;
        const timer = window.setTimeout(() => {
            transport
                .request('fs.browse', { partialPath: query, cwd: folder ?? undefined })
                .then((result) => {
                    // A later keystroke already asked again; this answer is stale.
                    if (mine === generation.current) {
                        setBrowse(result);
                        setFailure(null);
                    }
                })
                .catch((e: unknown) => {
                    if (mine === generation.current) {
                        setBrowse({ parentPath: query, entries: [] });
                        setFailure(e instanceof Error ? e.message : 'That path cannot be read');
                    }
                });
        }, BROWSE_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [browsing, query, folder]);

    useEffect(() => {
        const trimmed = query.trim();
        const mine = ++fileGeneration.current;
        if (grepping || browsing || folder === null || trimmed === '') {
            return;
        }
        const timer = window.setTimeout(() => {
            transport
                .request('fs.search', { cwd: folder, query: trimmed, limit: FILE_RESULTS })
                .then((result) => {
                    if (mine === fileGeneration.current) {
                        setFileMatches(result.files);
                    }
                })
                .catch(() => {
                    if (mine === fileGeneration.current) {
                        setFileMatches([]);
                    }
                });
        }, FILE_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [browsing, folder, grepping, query]);

    const openFile = useCallback(
        (path: string): void => {
            if (folder === null) {
                return;
            }
            useFiles.getState().open(absoluteOf(folder, path), useSettings.getState().filesTabLimit);
        },
        [folder]
    );

    const submitPath = async (path: string): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            await projectClient.openFolder(path);
            setOpen(false);
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'That folder cannot be opened');
        } finally {
            setBusy(false);
        }
    };

    const entries = useMemo<Entry[]>(() => {
        // Find in files draws its own results; the commands have no place among them.
        if (grepping) {
            return [];
        }
        if (browsing) {
            const up = parentOf(query);
            const list: Entry[] = [];
            if (up !== null && query !== '/' && query !== '~/') {
                list.push({
                    id: 'browse-up',
                    label: '..',
                    hint: 'Up one folder',
                    icon: <Icon icon={CornerLeftUp} size={14} />,
                    section: 'Folders',
                    run: () => setQuery(up)
                });
            }
            for (const entry of browse?.entries ?? []) {
                list.push({
                    id: `dir-${entry.fullPath}`,
                    label: entry.name,
                    hint: entry.hasCanvas ? 'Has a canvas' : undefined,
                    icon: entry.hasCanvas ? <Icon icon={FolderCheck} size={14} /> : <Icon icon={Folder} size={14} />,
                    section: 'Folders',
                    run: () => setQuery(`${entry.fullPath}/`)
                });
            }
            return list;
        }
        // Every view, not only the canvas on screen; a node elsewhere says where it lives.
        const jumps: Entry[] = views.flatMap((view) => {
            if (!isCanvasView(view)) {
                return [];
            }
            const here = view.id === activeViewId;
            const viewNodes = here ? order.map((id) => nodes[id]!) : view.nodes;
            return viewNodes
                .filter((node) => node.kind !== 'group')
                .map((node) => ({
                    id: `node-${node.id}`,
                    label: node.title,
                    hint: here ? node.kind : `${node.kind} in ${view.name}`,
                    icon: KIND_ICON[node.kind],
                    section: 'Jump to' as const,
                    run: () => revealNode(node.id)
                }));
        });
        const viewSwitches: Entry[] = views.filter(isOpenableView).map((view, index) => ({
            id: `view-${view.id}`,
            label: view.name ?? '',
            shortcut: index < 9 ? `⌘${index + 1}` : undefined,
            icon: (
                <ViewGlyph
                    id={view.id}
                    kind={view.kind}
                    icon={view.kind === 'separator' ? null : view.icon}
                    provider={view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : null}
                />
            ),
            section: 'Views' as const,
            run: () => showView(view.id)
        }));
        const switches: Entry[] = projects
            .filter((project) => project.available && project.projectId !== currentProjectId)
            .map((project) => ({
                id: `project-${project.projectId}`,
                label: project.name,
                hint: project.folder ?? 'Not in a folder',
                icon: <ProjectGlyph projectId={project.projectId} icon={project.icon} color={project.color} size={14} />,
                section: 'Projects',
                run: () => void projectClient.openProject(project.projectId).catch(() => undefined)
            }));
        /* What the last answer held stays out of a list it no longer belongs to; the effect above
           only fills it, so an empty query or a folder browse never shows yesterday's files. */
        const files: Entry[] = (query.trim() === '' ? [] : fileMatches).map((path) => {
            const name = basenameOf(path);
            return {
                id: `file-${path}`,
                label: name,
                // The folder the file sits in; a name on its own says too little in a deep tree.
                hint: path.slice(0, Math.max(path.length - name.length - 1, 0)) || undefined,
                icon: <FileIcon path={path} size={14} />,
                section: 'Files' as const,
                run: () => openFile(path)
            };
        });
        const commands = appCommands();
        const asEntry = (command: Command, section: Entry['section']): Entry => ({
            ...command,
            icon: command.agent ? <AgentIcon kind={command.agent} /> : <Icon icon={Zap} size={14} />,
            section
        });
        if (query === '') {
            // An empty palette is the one moment there is room to offer what you reach for most.
            const split = sortByRecency(commands, recents);
            return [
                ...split.recent.map((command) => asEntry(command, 'Recent')),
                ...jumps,
                ...viewSwitches,
                ...switches,
                ...split.rest.map((command) => asEntry(command, 'Actions'))
            ];
        }
        /* Every section is filtered on its own, so the file results can keep their place in the
           middle. They answer to the query already, in the daemon's own ranking, and are not
           filtered a second time here. */
        const keep = (entry: Entry): boolean => matches(query, `${entry.label} ${entry.hint ?? ''}`);
        return [
            ...jumps.filter(keep),
            ...files,
            ...viewSwitches.filter(keep),
            ...switches.filter(keep),
            ...commands.map((command) => asEntry(command, 'Actions')).filter(keep)
        ];
    }, [browsing, browse, fileMatches, grepping, nodes, openFile, order, views, activeViewId, query, recents, projects, currentProjectId]);

    // While browsing nothing is highlighted until the arrows say so, so Enter opens what was typed.
    const active = browsing ? (index >= 0 ? entries[index] : undefined) : entries[Math.min(index, entries.length - 1)];
    // What the arrow keys walk: the hits while searching in files, the rows of the list otherwise.
    const count = grepping ? grep.matches.length : entries.length;
    const activeHit = grepping ? Math.min(index, count - 1) : -1;

    const runHit = (at: number): void => {
        const match = grep.matches[at];
        if (!match) {
            return;
        }
        setOpen(false);
        openFile(match.path);
    };

    const run = (entry: Entry | undefined): void => {
        if (!entry) {
            return;
        }
        if (browsing) {
            entry.run();
            setIndex(-1);
            return;
        }
        // Jumping to a node, a file, a view or a project is not a command; only what "Actions" lists comes back.
        if (entry.section !== 'Jump to' && entry.section !== 'Files' && entry.section !== 'Views' && entry.section !== 'Projects') {
            setRecents(rememberRecent(entry.id));
        }
        setOpen(false);
        entry.run();
    };

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup
                    /* Wider while searching in files: a hit is read in the lines around it, and those
                       lines are source, which does not fold. */
                    className={clsx('dialog-popup top-[18vh]', grepping ? 'w-[760px]' : 'w-[560px]')}
                    initialFocus={inputRef}
                >
                    <div className="flex items-center gap-2 border-b border-border px-3">
                        {browsing && <Icon icon={FolderPlus} size={14} className="shrink-0 text-accent" />}
                        {grepping && <Icon icon={FileSearch} size={14} className="shrink-0 text-accent" />}
                        {!browsing && !grepping && <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />}
                        <input
                            ref={inputRef}
                            role="combobox"
                            aria-expanded
                            aria-controls={LIST_ID}
                            aria-autocomplete="list"
                            aria-activedescendant={
                                grepping ? (activeHit >= 0 ? optionId(activeHit) : undefined) : active ? optionId(entries.indexOf(active)) : undefined
                            }
                            aria-label={grepping ? 'Search through the files of this folder' : 'Jump to a node, run a command, or open a folder'}
                            className={clsx(
                                'h-11 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint',
                                (browsing || grepping) && 'font-mono text-code'
                            )}
                            placeholder={
                                grepping
                                    ? 'Search through the files of this folder'
                                    : 'Jump to a node, run a command, or type a path like ~/projects to open a folder'
                            }
                            value={query}
                            spellCheck={false}
                            onChange={(e) => reset(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setIndex((i) => (count === 0 ? -1 : (i + 1) % count));
                                } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setIndex((i) => (count === 0 ? -1 : (i - 1 + count) % count));
                                } else if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (grepping) {
                                        runHit(activeHit);
                                    } else if (browsing && (active === undefined || e.metaKey || e.ctrlKey)) {
                                        void submitPath(query);
                                    } else {
                                        run(active);
                                    }
                                } else if (e.key === 'Tab' && browsing && active) {
                                    e.preventDefault();
                                    run(active);
                                } else if (e.key === 'Backspace' && grepping && query === '') {
                                    // The mode leaves the way it was entered: one key, nothing typed.
                                    e.preventDefault();
                                    useUi.getState().setPaletteMode('default');
                                }
                            }}
                        />
                        {grepping && (
                            <span className={BTN_GROUP}>
                                <SearchToggle
                                    icon={CaseSensitive}
                                    label="Match case"
                                    active={grepOptions.caseSensitive}
                                    onClick={() => setGrepOptions((current) => ({ ...current, caseSensitive: !current.caseSensitive }))}
                                />
                                <SearchToggle
                                    icon={WholeWord}
                                    label="Whole words"
                                    active={grepOptions.wholeWord}
                                    onClick={() => setGrepOptions((current) => ({ ...current, wholeWord: !current.wholeWord }))}
                                />
                                <SearchToggle
                                    icon={Regex}
                                    label="Regular expression"
                                    active={grepOptions.regex}
                                    onClick={() => setGrepOptions((current) => ({ ...current, regex: !current.regex }))}
                                />
                            </span>
                        )}
                        <kbd className={TOOLTIP_KBD}>esc</kbd>
                    </div>
                    <div id={LIST_ID} className="max-h-[50vh] overflow-auto p-1.5" role="listbox" aria-label="Results">
                        <div aria-live="polite">
                            {entries.length === 0 && !browsing && !grepping && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">Nothing matches</div>
                            )}
                            {entries.length === 0 && browsing && <div className="px-3 py-6 text-center text-xs text-text-faint">No folders here yet</div>}
                            {grepping && query.trim() !== '' && !grep.busy && grep.failure === null && grep.matches.length === 0 && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">No line in this folder matches</div>
                            )}
                            {grepping && query.trim() === '' && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">Type to search through every file in this folder.</div>
                            )}
                        </div>
                        {grepping && (
                            <PaletteGrepResults
                                matches={grep.matches}
                                active={activeHit}
                                optionId={optionId}
                                onHover={(at) => setIndex(at)}
                                onRun={(at) => runHit(at)}
                            />
                        )}
                        {entries.map((entry, i) => {
                            const first = i === 0 || entries[i - 1]!.section !== entry.section;
                            return (
                                <div key={entry.id}>
                                    {first && <div className={`${SECTION_LABEL} px-2.5 pt-1.5 pb-1`}>{entry.section}</div>}
                                    <button
                                        id={optionId(i)}
                                        role="option"
                                        aria-selected={entry === active}
                                        data-active={entry === active}
                                        className="cursor-row flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-text-muted"
                                        onMouseEnter={() => setIndex(i)}
                                        onClick={() => run(entry)}
                                    >
                                        <span className="shrink-0 text-text-faint">{entry.icon}</span>
                                        <span className={clsx('min-w-0 truncate', browsing && 'font-mono text-code')}>{entry.label}</span>
                                        {entry.hint && <span className="text-xs text-text-faint">{entry.hint}</span>}
                                        <span className="grow" />
                                        {entry.shortcut && <kbd className={TOOLTIP_KBD}>{entry.shortcut}</kbd>}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    {grepping && (
                        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-text-faint">
                            {grep.failure !== null ? (
                                <span className="text-status-error" role="alert">
                                    {grep.failure}
                                </span>
                            ) : (
                                <span>
                                    {grep.matches.length === 0
                                        ? 'Nothing yet'
                                        : `${grep.matches.length}${grep.truncated ? '+' : ''} in ${grep.files} file${grep.files === 1 ? '' : 's'}`}
                                </span>
                            )}
                            <span className="grow" />
                            <span>
                                <kbd className={TOOLTIP_KBD}>↵</kbd> opens the file, <kbd className={TOOLTIP_KBD}>⌫</kbd> on an empty search goes back
                            </span>
                        </div>
                    )}
                    {browsing && (
                        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-text-faint">
                            {failure ? (
                                <span className="text-status-error" role="alert">
                                    {failure}
                                </span>
                            ) : (
                                <span>
                                    <kbd className={TOOLTIP_KBD}>↵</kbd> steps into a folder, <kbd className={TOOLTIP_KBD}>⌘↵</kbd> opens the typed path as a
                                    project
                                </span>
                            )}
                            <span className="grow" />
                            {desktop() && (
                                <Button
                                    size="sm"
                                    onClick={() =>
                                        void desktop()
                                            ?.pickFolder(browse?.parentPath)
                                            .then((picked) => (picked ? submitPath(picked) : undefined))
                                    }
                                >
                                    Browse…
                                </Button>
                            )}
                            <Button size="sm" variant="primary" disabled={busy || query.trim() === ''} onClick={() => void submitPath(query)}>
                                <Icon icon={FolderPlus} size={12} /> Open as project
                            </Button>
                        </div>
                    )}
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

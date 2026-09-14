import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import {
    ArrowLeft,
    CaseSensitive,
    CornerLeftUp,
    FileSearch,
    FileText,
    Folder,
    FolderCheck,
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
import { isCanvasView, isOpenableView, type FsBrowseResult } from '@ruimte/contracts';
import { AgentIcon } from '@/agents/AgentIcon';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { ViewGlyph } from '@/project/ViewGlyph';
import { openFolderOn, openProject, reachEndpoint } from '@/project/open';
import { newFileView, revealNode, showFileOnCanvas, showView } from '@/project/views';
import { appCommands, OPENING_COMMAND_IDS, type Command } from '@/shell/commands';
import {
    browseBack,
    browseMachines,
    browseStart,
    endsWithSeparator,
    folderPresence,
    machineDot,
    machineHint,
    openBrowse,
    paletteStart,
    parentOf,
    separatorFor,
    type BrowseStep
} from '@/shell/palette-browse';
import { DEFAULT_GREP_OPTIONS, useGrepSearch, type GrepOptions } from '@/shell/palette-grep';
import { PaletteGrepResults } from '@/shell/PaletteGrepResults';
import { readRecents, rememberRecent, sortByRecency } from '@/shell/palette-recents';
import { absoluteOf, basenameOf } from '@/shell/panels/files-tree';
import { useCanvas, type NodeKind } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useFiles } from '@/state/files';
import { useProjectList } from '@/state/project-list';
import { useProject } from '@/state/project';
import { fileManagerName, serverInfoOf, useServers } from '@/state/server';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';
import { useFocusedConnection } from '@/transport/connections';
import type { Transport } from '@/transport/transport';
import { useOpenEndpoints } from '@/transport/status';
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
    drawing: <Icon icon={PenTool} size={14} />,
    file: <Icon icon={FileText} size={14} />
};

// Typing a path turns the palette into a folder browser; anything else searches nodes and actions.
const isPathQuery = (query: string): boolean => query.startsWith('/') || query.startsWith('~') || query.startsWith('./') || query.startsWith('../');

const BROWSE_DEBOUNCE_MS = 60;
const FILE_DEBOUNCE_MS = 120;
// Enough to recognize the file being looked for, few enough to leave room for what else matches.
const FILE_RESULTS = 8;

// What an empty palette shows of the two lists that have no natural end.
const OPENING_RECENTS = 5;
const OPENING_JUMPS = 8;

interface Entry extends Command {
    icon: React.ReactNode;
    /* Set on a jump row for a node of the view on screen; an empty palette offers only those. */
    here?: boolean;
    /* Pushed to the end of the row, where a state belongs: the hint next to a name is about the name. */
    trailing?: React.ReactNode;
    section: 'Recent' | 'Jump to' | 'Files' | 'Views' | 'Projects' | 'Actions' | 'Folders' | 'Machines';
    /* The folder a browse row stands for: what Enter steps into, and what Tab completes the field
       to without stepping in. Navigating is the palette's own business, so such a row has no `run`. */
    browsePath?: string;
}

interface BrowseAnswer {
    result: FsBrowseResult | null;
    failure: string | null;
}

/*
 * One listing from one machine, which is not always the machine the app is pointed at. A machine
 * this client has forgotten mid-browse has no socket left, and falling back to the active one lists
 * something rather than throwing.
 */
const requestBrowse = async (endpointId: string, partialPath: string, cwd: string | null, fallback: Transport): Promise<BrowseAnswer> => {
    const socket = transportFor(endpointId) ?? fallback;
    try {
        return { result: await socket.request('fs.browse', { partialPath, cwd: cwd ?? undefined }), failure: null };
    } catch (e) {
        return { result: null, failure: e instanceof Error ? e.message : 'That path cannot be read' };
    }
};

/* What a listing is of. The separator is one no path can carry, so two of them never read as one. */
const browseKey = (endpointId: string, path: string): string => `${endpointId}\u0000${path}`;

const LIST_ID = 'palette-list';
const optionId = (index: number): string => `palette-option-${index}`;

const matches = (query: string, text: string): boolean => {
    // Every typed word has to appear somewhere, in any order.
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const haystack = text.toLowerCase();
    return words.every((word) => haystack.includes(word));
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
    const projects = useProjectList((s) => s.projects);
    const currentProjectId = useProject((s) => s.current?.projectId ?? null);
    const currentEndpointId = useProject((s) => s.currentEndpointId);
    const endpoints = useEndpoints((s) => s.endpoints);
    const connected = useOpenEndpoints();
    const activeId = useEndpoints((s) => s.activeId);
    /* The palette sits outside every workspace, so it works on the one the person has the focus in. */
    const { transport } = useFocusedConnection();
    const browseAt = useUi((s) => s.paletteBrowseAt);
    const browseStartFolder = useSettings((s) => s.browseStartFolder);
    const [query, setQuery] = useState('');
    const [index, setIndex] = useState(0);
    /* Which step of browsing the palette is on, and null when it is not browsing at all. A step of
       its own rather than something the text says, so browsing can open on nothing typed. */
    const [browse, setBrowse] = useState<BrowseStep | null>(null);
    /* The listing on screen, under the machine and path it was asked for, so a navigation that
       already fetched one does not have the typing effect ask for it a second time. */
    const [listing, setListing] = useState<{ key: string; result: FsBrowseResult | null } | null>(null);
    /* The machine a socket is being opened for; ours are dialed lazily, so this takes a moment. */
    const [dialing, setDialing] = useState<string | null>(null);
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
    /* Picking one file out of the folder, to make it a node or a view. The list is the file search
       and nothing else, and it answers before anything is typed. */
    const picking = mode === 'file';
    const filePick = useUi((s) => s.filePick);
    const grep = useGrepSearch(grepping ? folder : null, grepping ? query : '', grepOptions);
    const browseEndpointId = browse?.endpointId ?? activeId;
    const machineStep = browse?.machines === true;
    const platform = useServers((s) => s.byEndpoint[browseEndpointId]?.platform ?? null);
    /* The whole map, because the machine rows draw an icon each and the icons arrive one machine at a time. */
    const servers = useServers((s) => s.byEndpoint);
    const sep = separatorFor(platform);
    const machines = useMemo(() => browseMachines(endpoints, activeId, connected), [endpoints, activeId, connected]);
    /* The machines list sorts this machine first but opens on the machine the client is pointed at,
       which is where the work is and usually where the folder being looked for is too. */
    const activeRow = Math.max(
        0,
        machines.findIndex((row) => row.active)
    );

    /* A relative path counts from the open project's folder, and that folder is on one machine. */
    const cwdFor = useCallback((endpointId: string): string | null => (currentEndpointId === endpointId ? folder : null), [currentEndpointId, folder]);

    /* Typing never leaves browsing and never empties the list: the field says where you are, the
       step says what you are doing. A path typed in the ordinary palette is the second way in. */
    const reset = (next: string): void => {
        setQuery(next);
        setBrowse(browse ?? (isPathQuery(next) ? { endpointId: activeId, machines: false, path: next } : null));
        setIndex(0);
        setFailure(null);
    };

    /* A palette that opens, a mode that changes and the browse command being chosen all start it
       over: the machine the app is pointed at, nothing of the last browse on screen, and the step
       that was asked for. A browsing step opens with an empty field, and the effect below asks for
       its start folder, so the path and the first listing land together. */
    const restart = (next: string, browseNow: boolean): void => {
        setListing(null);
        setFailure(null);
        setDialing(null);
        const step: BrowseStep | null = browseNow
            ? openBrowse(activeId, machines.length)
            : isPathQuery(next)
              ? { endpointId: activeId, machines: false, path: next }
              : null;
        setBrowse(step);
        setQuery(browseNow ? '' : next);
        setIndex(step?.machines === true ? activeRow : 0);
    };

    const signal = { open, mode, browseAt };
    const [seen, setSeen] = useState(signal);

    // Opening is driven by the store, not by the dialog, so the fresh start is derived while rendering.
    const start = paletteStart(signal, seen);
    if (start.changed) {
        setSeen(signal);
        if (start.restart) {
            restart(seed, start.browse);
        }
    }

    const browsing = !grepping && browse !== null;

    useEffect(() => {
        // An empty field is a step with nothing to list yet; the last listing stays under it.
        if (!browsing || machineStep || query.trim() === '') {
            return;
        }
        const key = browseKey(browseEndpointId, query);
        if (listing?.key === key) {
            return;
        }
        const mine = ++generation.current;
        // Nothing on screen yet is nothing to hold back, so the first listing goes out without the wait.
        const timer = window.setTimeout(
            () => {
                void requestBrowse(browseEndpointId, query, cwdFor(browseEndpointId), transport).then((answer) => {
                    // A later keystroke already asked again; this answer is stale.
                    if (mine !== generation.current) {
                        return;
                    }
                    setListing({ key, result: answer.result });
                    setFailure(answer.failure);
                });
            },
            listing === null ? 0 : BROWSE_DEBOUNCE_MS
        );
        return () => window.clearTimeout(timer);
    }, [transport, listing, browsing, machineStep, browseEndpointId, query, cwdFor]);

    /*
     * Every step fetches before it commits, so the path and the list change in the same frame and
     * there is never an empty flash between a click and the folder it opens.
     */
    const commitBrowse = useCallback((endpointId: string, path: string, answer: BrowseAnswer): void => {
        setListing({ key: browseKey(endpointId, path), result: answer.result });
        setFailure(answer.failure);
        setBrowse({ endpointId, machines: false, path });
        setQuery(path);
        setIndex(0);
    }, []);

    const navigateTo = useCallback(
        async (path: string, endpointId: string): Promise<void> => {
            const mine = ++generation.current;
            const answer = await requestBrowse(endpointId, path, cwdFor(endpointId), transport);
            if (mine !== generation.current) {
                return;
            }
            commitBrowse(endpointId, path, answer);
        },
        [transport, commitBrowse, cwdFor]
    );

    /*
     * Opening the folders of a machine, which is the one navigation with no path behind it. The
     * start folder is one setting for every machine, so it may well not be on this one; home is, so
     * that is where a start folder the daemon says is not there falls back to.
     */
    const startBrowsing = useCallback(
        async (endpointId: string): Promise<void> => {
            const info = serverInfoOf(endpointId);
            const { start: from, home } = browseStart(browseStartFolder, info.home, separatorFor(info.platform));
            const mine = ++generation.current;
            const answer = await requestBrowse(endpointId, from, cwdFor(endpointId), transport);
            if (mine !== generation.current) {
                return;
            }
            if (from !== home && answer.result?.exists === false) {
                await navigateTo(home, endpointId);
                return;
            }
            commitBrowse(endpointId, from, answer);
        },
        [transport, browseStartFolder, commitBrowse, cwdFor, navigateTo]
    );

    /* The arrow keys move a highlight, not the scroll: without this the list stays where it is and
       the selection walks off the bottom of it. `nearest` keeps a click from jumping the list. */
    useEffect(() => {
        document.getElementById(LIST_ID)?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    });

    useEffect(() => {
        /* A folders step that has not been anywhere yet is one the palette still has to open. The
           request goes out here rather than where the step was made, because that is a render.
           oxlint reads the call as a setState in an effect; every write in it is behind an await. */
        if (browse === null || browse.machines || query !== '' || listing !== null) {
            return;
        }
        void startBrowsing(browse.endpointId);
    }, [browse, listing, query, startBrowsing]);

    /*
     * A machine that is not connected is usually one nothing has asked for yet, so picking it dials
     * rather than refusing. The path resets to that machine's start folder: a path from one machine
     * rarely exists on the next, and landing on "create this folder" by accident helps nobody.
     */
    const pickMachine = useCallback(
        async (endpointId: string): Promise<void> => {
            setDialing(endpointId);
            setFailure(null);
            try {
                await reachEndpoint(endpointId);
            } catch (e) {
                setFailure(e instanceof Error ? e.message : 'That machine is not answering');
                setDialing(null);
                return;
            }
            setDialing(null);
            await startBrowsing(endpointId);
        },
        [startBrowsing]
    );

    useEffect(() => {
        const trimmed = query.trim();
        const mine = ++fileGeneration.current;
        if (grepping || browsing || folder === null || (trimmed === '' && !picking)) {
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
    }, [transport, browsing, folder, grepping, picking, query]);

    /* A file row does what the palette was opened for: a node where the menu was clicked, a view of
       its own, or the preview tab every other route here means. */
    const openFile = useCallback(
        (path: string): void => {
            if (folder === null) {
                return;
            }
            const absolute = absoluteOf(folder, path);
            if (filePick?.kind === 'node') {
                showFileOnCanvas(absolute, filePick.at);
                return;
            }
            if (filePick?.kind === 'view') {
                newFileView(absolute);
                return;
            }
            useFiles.getState().open(absolute, useSettings.getState().filesTabLimit);
        },
        [filePick, folder]
    );

    /* What the daemon says about the path in the field: there, not there, or a daemon too old to say. */
    const presence = browsing && !machineStep && query.trim() !== '' ? folderPresence(query, listing?.result ?? null, sep) : 'unknown';

    const submitPath = async (path: string): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            await openFolderOn(browseEndpointId, path, presence === 'missing');
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
        if (machineStep) {
            // Typing on this step narrows the machines, the way typing narrows every other list here.
            return machines
                .filter((row) => matches(query, row.label))
                .map((row) => {
                    const hint = machineHint(row.connected, dialing === row.endpointId);
                    return {
                        id: `machine-${row.endpointId}`,
                        label: row.label,
                        /* The icon a machine was given, the same one the settings page and every menu
                           show; the daemon's own hostname behind the name said nothing the name did not. */
                        icon: <MachineGlyph icon={servers[row.endpointId]?.icon ?? null} size={14} />,
                        trailing: (
                            <>
                                {hint && <span className="text-xs text-text-faint">{hint}</span>}
                                <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', machineDot(row.connected, dialing === row.endpointId))} />
                            </>
                        ),
                        section: 'Machines' as const,
                        run: () => void pickMachine(row.endpointId)
                    };
                });
        }
        if (browsing) {
            const up = parentOf(query, sep);
            const list: Entry[] = [];
            // The row that goes up is the first item inside the group, not a row of its own above it.
            if (up !== null) {
                list.push({
                    id: 'browse-up',
                    label: '..',
                    icon: <Icon icon={CornerLeftUp} size={14} />,
                    section: 'Folders',
                    browsePath: up,
                    run: () => undefined
                });
            }
            /* A folder row is an icon and a name. The check on a folder that already holds a canvas
               is the one thing that stays, because it says what Enter will do: open that project
               again rather than make a second one beside it. */
            for (const entry of listing?.result?.entries ?? []) {
                list.push({
                    id: `dir-${entry.fullPath}`,
                    label: entry.name,
                    icon: entry.hasCanvas ? <Icon icon={FolderCheck} size={14} /> : <Icon icon={Folder} size={14} />,
                    section: 'Folders',
                    browsePath: entry.fullPath,
                    run: () => undefined
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
                    here,
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
                    path={view.kind === 'file' ? view.path : null}
                />
            ),
            section: 'Views' as const,
            run: () => showView(view.id)
        }));
        /* One list with the machine on the row, rather than a section per machine: a project is
           looked for by its own name, and which daemon it is on is what tells two of them apart. */
        const projectMachines = new Set(projects.map((row) => row.endpointId));
        const switches: Entry[] = projects
            .filter((row) => row.summary.available && !(row.summary.projectId === currentProjectId && row.endpointId === currentEndpointId))
            .map(({ endpointId, summary }) => {
                const where = summary.folder ?? 'Not in a folder';
                const label = endpoints.find((endpoint) => endpoint.id === endpointId)?.label ?? 'Another machine';
                const machine = connected.includes(endpointId) ? label : `${label}, not connected`;
                return {
                    id: `project-${endpointId}-${summary.projectId}`,
                    label: summary.name,
                    hint: projectMachines.size > 1 ? `${machine} · ${where}` : where,
                    icon: <ProjectGlyph projectId={summary.projectId} endpointId={endpointId} icon={summary.icon} color={summary.color} size={14} />,
                    section: 'Projects',
                    run: () => void openProject(endpointId, summary.projectId).catch(() => undefined)
                };
            });
        /* What the last answer held stays out of a list it no longer belongs to; the effect above
           only fills it, so an empty query or a folder browse never shows yesterday's files. */
        const files: Entry[] = (query.trim() === '' && !picking ? [] : fileMatches).map((path) => {
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
        // Picking a file is a step with one list; the commands and the nodes have no place in it.
        if (picking) {
            return files;
        }
        const commands = appCommands();
        const asEntry = (command: Command, section: Entry['section']): Entry => ({
            ...command,
            icon: command.agent ? <AgentIcon kind={command.agent} /> : <Icon icon={Zap} size={14} />,
            section
        });
        if (query === '') {
            /* Nothing typed is not the moment for the whole catalog: what was reached for last, the
               nodes of the canvas in front of you, the views of this project, and the few actions
               that earn a place. Everything else answers to a query. */
            const split = sortByRecency(commands, recents);
            const featured = split.rest.filter((command) => OPENING_COMMAND_IDS.includes(command.id));
            return [
                ...split.recent.slice(0, OPENING_RECENTS).map((command) => asEntry(command, 'Recent')),
                ...jumps.filter((entry) => entry.here === true).slice(0, OPENING_JUMPS),
                ...viewSwitches,
                ...featured.map((command) => asEntry(command, 'Actions'))
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
    }, [
        browsing,
        listing,
        connected,
        dialing,
        endpoints,
        fileMatches,
        grepping,
        machines,
        machineStep,
        nodes,
        openFile,
        picking,
        order,
        pickMachine,
        sep,
        views,
        activeViewId,
        query,
        recents,
        projects,
        servers,
        currentProjectId,
        currentEndpointId
    ]);

    /* Every list opens with its first row highlighted, browsing included, so Enter walks into the
       folders without an arrow key first and Cmd+Enter is what opens the path in the field. */
    const active = entries[Math.min(index, entries.length - 1)];
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

    /* The machines take the list over and the field empties, so it can narrow them; the path the
       folders step was on rides along in the step, and Backspace puts it back. */
    const showMachines = (): void => {
        if (browse === null) {
            return;
        }
        setBrowse({ ...browse, machines: true, path: query });
        setQuery('');
        setIndex(activeRow);
        setFailure(null);
    };

    const leaveBrowse = (): void => {
        setBrowse(null);
        setQuery('');
        setIndex(0);
        setFailure(null);
    };

    const stepBack = (): void => {
        if (browse === null) {
            return;
        }
        const back = browseBack(browse, machines.length);
        if (back.to === 'folders') {
            void navigateTo(back.path, browse.endpointId);
        } else if (back.to === 'machines') {
            showMachines();
        } else {
            leaveBrowse();
        }
    };

    const browseLabel = endpoints.find((endpoint) => endpoint.id === browseEndpointId)?.label ?? 'This machine';
    const backTo = browse === null ? null : browseBack(browse, machines.length).to;
    const backLabel = backTo === 'folders' ? 'Back to the folders' : backTo === 'machines' ? 'Browse another machine' : 'Back to the palette';
    const submitLabel = presence === 'missing' ? 'Create and open' : 'Open folder';
    // Enter means "use what I typed" until a row is highlighted, and then the chord takes that over.
    const submitChord = active === undefined ? '↵' : '⌘↵';
    /* The shell's own picker, which only makes sense for the daemon that served this page: the word
       on the button is the Electron machine's, because that is whose dialog opens. */
    const nativeDialog = browseEndpointId === LOCAL_ENDPOINT_ID ? desktop() : null;

    const run = (entry: Entry | undefined): void => {
        if (!entry) {
            return;
        }
        // A browse row steps somewhere and the palette stays open; only the rest of the list closes it.
        if (browsing) {
            if (entry.browsePath === undefined) {
                entry.run();
                return;
            }
            void navigateTo(endsWithSeparator(entry.browsePath) ? entry.browsePath : `${entry.browsePath}${sep}`, browseEndpointId);
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
                    /* The one surface that does not sit in the middle: it grows and shrinks with
                       every keystroke, and a centered list would walk up the screen while you type. */
                    className={clsx('dialog-popup top-[18vh] [translate:-50%_0]', grepping ? 'w-[760px]' : 'w-[576px]')}
                    initialFocus={inputRef}
                >
                    <div className="flex items-center gap-2 border-b border-border px-3">
                        {/* The leading slot is the way one step back, and on the folders of a machine
                            it says which machine that is. With one machine there is nothing to name,
                            so it is the plain arrow that leaves browsing. */}
                        {browsing && (
                            <Tooltip label={backLabel} kbd="⌫">
                                <button
                                    className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-text-muted hover:bg-surface-hover"
                                    // The field keeps the keys; a control that takes focus would swallow the next arrow.
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={stepBack}
                                    aria-label={backLabel}
                                >
                                    {backTo !== 'machines' ? (
                                        <Icon icon={ArrowLeft} size={14} />
                                    ) : (
                                        <>
                                            {/* The icon, not a dot: it is the machine's own mark, the rows
                                                behind this button carry the same one, and a machine whose
                                                folders are on screen is answering by definition. */}
                                            <MachineGlyph icon={servers[browseEndpointId]?.icon ?? null} size={14} />
                                            <span className="max-w-32 truncate">{browseLabel}</span>
                                        </>
                                    )}
                                </button>
                            </Tooltip>
                        )}
                        {grepping && <Icon icon={FileSearch} size={14} className="shrink-0 text-accent" />}
                        {picking && <Icon icon={FileText} size={14} className="shrink-0 text-accent" />}
                        {!browsing && !grepping && !picking && <Icon icon={Search} size={14} className="shrink-0 text-text-faint" />}
                        <input
                            ref={inputRef}
                            role="combobox"
                            aria-expanded
                            aria-controls={LIST_ID}
                            aria-autocomplete="list"
                            aria-activedescendant={
                                grepping ? (activeHit >= 0 ? optionId(activeHit) : undefined) : active ? optionId(entries.indexOf(active)) : undefined
                            }
                            aria-label={
                                grepping
                                    ? 'Search the files in this folder'
                                    : picking
                                      ? 'Pick a file from this folder'
                                      : 'Jump to a node, run a command, or open a folder'
                            }
                            /* A path stays in the same sans font as everything else: monospace makes
                               it read as something to be read rather than something to be typed. */
                            className={clsx(
                                'h-11 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint',
                                grepping && 'font-mono text-code'
                            )}
                            placeholder={
                                grepping
                                    ? 'Search the files in this folder'
                                    : picking
                                      ? 'Pick a file from this folder'
                                      : machineStep
                                        ? 'Search machines'
                                        : browsing
                                          ? 'Enter a folder path, for example ~/projects/my-app'
                                          : 'Jump to a node, run a command, or type a path like ~/projects to open a folder'
                            }
                            value={query}
                            spellCheck={false}
                            onChange={(e) => reset(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setIndex((i) => (count === 0 ? 0 : (i + 1) % count));
                                } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setIndex((i) => (count === 0 ? 0 : (i - 1 + count) % count));
                                } else if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (grepping) {
                                        runHit(activeHit);
                                    } else if (browsing && !machineStep && (active === undefined || e.metaKey || e.ctrlKey)) {
                                        void submitPath(query);
                                    } else {
                                        run(active);
                                    }
                                } else if (e.key === 'Tab' && browsing && !machineStep && active?.browsePath) {
                                    // Completes the field to the folder under the highlight, without stepping into it.
                                    e.preventDefault();
                                    setQuery(active.browsePath);
                                    setIndex(0);
                                } else if (e.key === 'Backspace' && query === '') {
                                    if (grepping) {
                                        // The mode leaves the way it was entered: one key, nothing typed.
                                        e.preventDefault();
                                        useUi.getState().setPaletteMode('default');
                                    } else if (browsing) {
                                        e.preventDefault();
                                        stepBack();
                                    }
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
                        {/* The button that opens what was typed sits in the field, at its right end,
                            carrying the one chord that does the same thing. */}
                        {browsing && !machineStep && (
                            <Tooltip label={submitLabel} kbd={submitChord}>
                                <Button size="sm" variant="secondary" disabled={busy || query.trim() === ''} onClick={() => void submitPath(query)}>
                                    {submitLabel}
                                    <kbd className={TOOLTIP_KBD}>{submitChord}</kbd>
                                </Button>
                            </Tooltip>
                        )}
                        {!browsing && <kbd className={TOOLTIP_KBD}>esc</kbd>}
                    </div>
                    <div id={LIST_ID} className="max-h-[50vh] overflow-auto p-1.5" role="listbox" aria-label="Results">
                        <div aria-live="polite">
                            {entries.length === 0 && !browsing && !grepping && !picking && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">Nothing matches</div>
                            )}
                            {picking && entries.length === 0 && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">
                                    {folder === null ? 'This project has no folder.' : 'No file in this folder matches'}
                                </div>
                            )}
                            {grepping && query.trim() !== '' && !grep.busy && grep.failure === null && grep.matches.length === 0 && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">No line in this folder matches</div>
                            )}
                            {grepping && query.trim() === '' && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">Type to search every file in this folder.</div>
                            )}
                            {machineStep && entries.length === 0 && <div className="px-3 py-6 text-center text-xs text-text-faint">No machine matches</div>}
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
                        {/* An empty folder is the label with nothing under it: no spinner, no message,
                            and the previous listing stays up until the next one lands. */}
                        {browsing && !machineStep && entries.length === 0 && <div className={`${SECTION_LABEL} px-2.5 pt-1.5 pb-1`}>Folders</div>}
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
                                        <span className="min-w-0 truncate">{entry.label}</span>
                                        {entry.hint && <span className="text-xs text-text-faint">{entry.hint}</span>}
                                        <span className="grow" />
                                        {entry.trailing}
                                        {entry.shortcut && <kbd className={TOOLTIP_KBD}>{entry.shortcut}</kbd>}
                                    </button>
                                </div>
                            );
                        })}
                        {/* Offering to create a folder needs more than a listing, which never learns
                            whether a folder is there; ours does, so the offer is reachable. */}
                        {presence === 'missing' && (
                            <div className="px-3 py-6 text-center text-xs text-text-faint">Press Enter to create this folder and open it as a project</div>
                        )}
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
                            <span className="flex shrink-0 items-center gap-1.5">
                                <kbd className={TOOLTIP_KBD}>↑</kbd>
                                <kbd className={TOOLTIP_KBD}>↓</kbd> Navigate
                            </span>
                            {/* The Enter hint is left out once the typed path can be opened, because
                                the button in the field is already saying so. */}
                            {(active !== undefined || query.trim() === '') && (
                                <span className="flex shrink-0 items-center gap-1.5">
                                    <kbd className={TOOLTIP_KBD}>↵</kbd> Select
                                </span>
                            )}
                            <span className="flex shrink-0 items-center gap-1.5">
                                <kbd className={TOOLTIP_KBD}>⌫</kbd> Back
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                                <kbd className={TOOLTIP_KBD}>esc</kbd> Close
                            </span>
                            <span className="grow" />
                            {failure && (
                                <span className="truncate text-status-error" role="alert">
                                    {failure}
                                </span>
                            )}
                            {/* A native dialog can only see the file system of the machine it runs on. */}
                            {!machineStep && nativeDialog !== null && (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                        void nativeDialog.pickFolder(listing?.result?.parentPath).then((picked) => (picked ? submitPath(picked) : undefined))
                                    }
                                >
                                    Browse in {fileManagerName(nativeDialog.platform)}
                                </Button>
                            )}
                        </div>
                    )}
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import {
    ArrowLeft,
    CaseSensitive,
    CircleQuestionMark,
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
    Smartphone,
    Terminal,
    type LucideIcon,
    WholeWord,
    Workflow,
    Zap
} from 'lucide-react';
import { isCanvasView, isOpenableView, type FsBrowseResult, viewIconOf, type CanvasNodeKind } from '@ruimte/contracts';
import { AgentIcon } from '@/agents/AgentIcon';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { ViewGlyph } from '@/project/ViewGlyph';
import { ensureMachine } from '@/endpoint/reach';
import { createViewAction, openFolderAction, openProjectAction, performAsPerson, runAsPerson } from '@/actions/client-actions';
import { revealNode, showFileOnCanvas, showView } from '@/project/views';
import { appCommands, OPENING_COMMAND_IDS, type Command } from '@/shell/commands';
import {
    browseBack,
    browseMachines,
    browseStart,
    endsWithSeparator,
    folderPresence,
    linkDot,
    linkHint,
    machineLink,
    machinesStep,
    openBrowse,
    paletteStart,
    type PaletteSignal,
    parentOf,
    pickMachine,
    retryLink,
    separatorFor,
    settleLink,
    type BrowseStep
} from '@/shell/palette-browse';
import { DEFAULT_GREP_OPTIONS, useGrepSearch, type GrepOptions } from '@/shell/palette-grep';
import { PaletteGrepResults } from '@/shell/PaletteGrepResults';
import { readRecents, rememberRecent, sortByRecency } from '@/shell/palette-recents';
import { absoluteOf, basenameOf } from '@/shell/panels/files-tree';
import { iconOfEntry } from '@/shell/settings/machine-icon';
import { mergeMachines } from '@/shell/settings/machine-list';
import { messageOf, usePulsarAccount } from '@/pulsar/account';
import { refreshAccountMachines, usePulsarMachines } from '@/pulsar/machines';
import { useCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { hasLocalMachine, isRealMachine } from '@/state/local-machine';
import { useProjectList } from '@/state/project-list';
import { useProject } from '@/state/project';
import { fileManagerName, serverInfoOf, useServers } from '@/state/server';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { pool, transportFor, type ConnectionState } from '@/transport';
import { useFocusedMachine } from '@/transport/connections';
import type { Transport } from '@/transport/transport';
import { useConnections, useOpenEndpoints } from '@/transport/status';
import { desktop, isApplePlatform } from '@/desktop/bridge';
import { Button } from '@/ui/Button';
import { BTN_GROUP, SECTION_LABEL, TOOLTIP_KBD } from '@/ui/classes';
import { FileIcon } from '@/ui/FileIcon';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { viewShortcut } from '@/canvas/shortcuts';
import { Kbd } from '@/ui/Kbd';
import { KEY_SHORTCUTS, matchesShortcut } from '@/ui/shortcut';

const KIND_ICON: Record<CanvasNodeKind, React.ReactNode> = {
    terminal: <Icon icon={Terminal} size={14} />,
    chat: <Icon icon={MessageSquare} size={14} />,
    browser: <Icon icon={Globe} size={14} />,
    device: <Icon icon={Smartphone} size={14} />,
    group: <Icon icon={LayoutGrid} size={14} />,
    note: <Icon icon={StickyNote} size={14} />,
    drawing: <Icon icon={PenTool} size={14} />,
    diagram: <Icon icon={Workflow} size={14} />,
    file: <Icon icon={FileText} size={14} />,
    unknown: <Icon icon={CircleQuestionMark} size={14} />
};

// Typing a path turns the palette into a folder browser; anything else searches nodes and actions.
const isPathQuery = (query: string): boolean => query.startsWith('/') || query.startsWith('~') || query.startsWith('./') || query.startsWith('../');

const BROWSE_DEBOUNCE_MS = 60;

/* What a machine with no link in the pool reads as. */
const NO_LINK: ConnectionState = { status: 'closed', attempts: 0, retryAt: null, failure: null };
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
    section: 'recent' | 'jump' | 'files' | 'views' | 'projects' | 'actions' | 'folders' | 'machines';
    /* The folder a browse row stands for: what Enter steps into, and what Tab completes the field
       to without stepping in. Navigating is the palette's own business, so such a row has no `run`. */
    browsePath?: string;
}

interface BrowseAnswer {
    result: FsBrowseResult | null;
    failure: string | null;
}

/*
 * One listing from one machine, which is not always the machine the app is pointed at. Browsing a
 * machine is asking for it, so its link is brought up first; a machine forgotten mid-browse fails
 * there with its reason.
 */
const requestBrowse = async (endpointId: string, partialPath: string, cwd: string | null, fallback: Transport): Promise<BrowseAnswer> => {
    try {
        const socket = transportFor(await ensureMachine(endpointId)) ?? fallback;
        return { result: await socket.request('fs.browse', { partialPath, cwd: cwd ?? undefined }), failure: null };
    } catch (e) {
        return { result: null, failure: e instanceof Error ? e.message : i18next.t('shell:palette.unreadablePath') };
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

/*
 * Cmd+K: jump to a node, run an action, or type a path to open a folder as a project. The body follows
 * the canvas, the machines and the projects, so it is mounted only while the palette is up or on its
 * way out. The browse ask it saw last stays here, so a body that mounts knows whether this opening is one.
 */
export function CommandPalette() {
    const open = useUi((s) => s.paletteOpen);
    const [mounted, setMounted] = useState(open);
    const [browseSeen, setBrowseSeen] = useState(() => useUi.getState().paletteBrowseAt);
    if (open && !mounted) {
        setMounted(true);
    }
    if (!open && !mounted) {
        return null;
    }
    const onClosed = (): void => {
        const state = useUi.getState();
        if (!state.paletteOpen) {
            setBrowseSeen(state.paletteBrowseAt);
            setMounted(false);
        }
    };
    return <PaletteBody browseSeen={browseSeen} onClosed={onClosed} />;
}

function PaletteBody({ browseSeen, onClosed }: { browseSeen: number; onClosed(): void }) {
    const { t } = useTranslation(['shell', 'common']);
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
    /* The palette sits outside the workspace, so it works on the machine of the open project, or the active one on the start screen. */
    const { transport } = useFocusedMachine();
    const browseAt = useUi((s) => s.paletteBrowseAt);
    /* The machine the switcher asked the browser to open on, for a machine it lists nothing of. */
    const browseTarget = useUi((s) => s.paletteBrowseMachine);
    const browseStartFolder = useSettings((s) => s.browseStartFolder);
    const accountStatus = usePulsarAccount((s) => s.status);
    const accountMachines = usePulsarMachines((s) => s.machines);
    const connections = useConnections();
    const [query, setQuery] = useState('');
    const [index, setIndex] = useState(0);
    /* Which step of browsing the palette is on, and null when it is not browsing at all. A step of
       its own rather than something the text says, so browsing can open on nothing typed. */
    const [browse, setBrowse] = useState<BrowseStep | null>(null);
    /* The listing on screen, under the machine and path it was asked for, so a navigation that
       already fetched one does not have the typing effect ask for it a second time. */
    const [listing, setListing] = useState<{ key: string; result: FsBrowseResult | null } | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
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
    /* Every machine this client knows, joined the way the Machines pane joins them, so one the account
       has and nothing here ever opened is a row to pick like any other. */
    const machines = useMemo(
        () =>
            browseMachines(
                mergeMachines({ endpoints, accountMachines: accountStatus === 'signed-in' ? accountMachines : null, showLocal: hasLocalMachine() }),
                activeId
            ),
        [endpoints, accountMachines, accountStatus, activeId]
    );
    const connectionOf = useCallback((endpointId: string): ConnectionState => connections[endpointId] ?? NO_LINK, [connections]);
    const linkWait = browse !== null && !browse.machines ? (browse.link ?? null) : null;
    const browseRow = machines.find((row) => row.endpointId === browseEndpointId) ?? null;
    /* The machines list sorts this machine first but opens on the machine the client is pointed at,
       which is where the work is and usually where the folder being looked for is too. */
    const activeRow = Math.max(
        0,
        machines.findIndex((row) => row.active)
    );

    /* A relative path counts from the open project's folder, and that folder is on one machine. */
    const cwdFor = useCallback((endpointId: string): string | null => (currentEndpointId === endpointId ? folder : null), [currentEndpointId, folder]);

    /* A typed path browses the machine the app is pointed at, which the idle row of the web client is not. */
    const pathStep = (next: string): BrowseStep | null =>
        isPathQuery(next) && isRealMachine(activeId) ? { endpointId: activeId, machines: false, path: next } : null;

    /* Typing never leaves browsing and never empties the list: the field says where you are, the
       step says what you are doing. A path typed in the ordinary palette is the second way in. */
    const reset = (next: string): void => {
        setQuery(next);
        setBrowse(browse ?? pathStep(next));
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
        const isOpen = (endpointId: string): boolean => connectionOf(endpointId).status === 'open';
        const step: BrowseStep | null = browseNow
            ? browseTarget !== null
                ? pickMachine(browseTarget, isOpen(browseTarget))
                : openBrowse(
                      activeId,
                      machines.map((row) => ({ endpointId: row.endpointId, open: isOpen(row.endpointId) }))
                  )
            : pathStep(next);
        setBrowse(step);
        setQuery(browseNow ? '' : next);
        setIndex(step?.machines === true ? activeRow : 0);
    };

    const signal = { open, mode, browseAt };
    const [seen, setSeen] = useState<PaletteSignal>(() => ({ open: false, mode, browseAt: browseSeen }));
    // Mounted open, the dialog would skip the way in; one frame closed lets it animate like any other.
    const [entered, setEntered] = useState(false);
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => setEntered(true));
        return () => window.cancelAnimationFrame(frame);
    }, []);

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
        if (!browsing || machineStep || linkWait !== null || query.trim() === '') {
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
    }, [transport, listing, browsing, machineStep, linkWait, browseEndpointId, query, cwdFor]);

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
           request goes out here rather than where the step was made, because that is a render. */
        if (browse === null || browse.machines || browse.link !== undefined || query !== '' || listing !== null) {
            return;
        }
        // Every state write in it is behind an await, which the rule does not see.
        // oxlint-disable-next-line react/set-state-in-effect
        void startBrowsing(browse.endpointId);
    }, [browse, listing, query, startBrowsing]);

    /*
     * A step waiting on a machine's link brings it up through the helper every way in shares, and
     * lists the folders once it is open. Leaving the step drops the wait and nothing else: the
     * attempt goes on, and a machine that comes up later is simply open the next time.
     */
    const waiting = browse !== null && browse.link?.state === 'connecting' ? browse : null;
    useEffect(() => {
        if (waiting === null) {
            return;
        }
        // A listing still on its way from the machine before is about a step that was left, and must not land over this one.
        generation.current += 1;
        let live = true;
        const { endpointId } = waiting;
        ensureMachine(endpointId).then(
            () => {
                if (live) {
                    setBrowse((step) => settleLink(step, endpointId, null));
                }
            },
            (e: unknown) => {
                if (live) {
                    setBrowse((step) => settleLink(step, endpointId, messageOf(e)));
                }
            }
        );
        return () => {
            live = false;
        };
    }, [waiting]);

    /* The machine whose folders are up keeps its link for as long as they are, however long a person browses. */
    const heldId = browse !== null && !browse.machines ? browse.endpointId : null;
    const heldRow = useEndpoints((s) => (heldId === null ? null : (s.endpoints.find((entry) => entry.id === heldId) ?? null)));
    useEffect(() => (heldRow === null ? undefined : pool.hold(heldRow)), [heldRow]);

    /* The machines step is one of the moments the account list is asked again, so a machine that just joined is there. */
    useEffect(() => {
        if (open && machineStep && accountStatus === 'signed-in') {
            void refreshAccountMachines();
        }
    }, [open, machineStep, accountStatus]);

    /*
     * Picking a machine that is open lists its folders straight away. Any other machine waits for its
     * link on its own step first, a row that only the account has included. The path resets to that
     * machine's start folder: a path from one machine rarely exists on the next, and landing on
     * "create this folder" by accident helps nobody.
     */
    const chooseMachine = useCallback(
        (endpointId: string): void => {
            setFailure(null);
            if (connectionOf(endpointId).status === 'open') {
                void startBrowsing(endpointId);
                return;
            }
            setListing(null);
            setQuery('');
            setIndex(0);
            setBrowse(pickMachine(endpointId, false));
        },
        [connectionOf, startBrowsing]
    );

    const retry = (): void => {
        setFailure(null);
        setBrowse((step) => retryLink(step));
    };

    useEffect(() => {
        const trimmed = query.trim();
        const mine = ++fileGeneration.current;
        if (grepping || browsing || folder === null || (trimmed === '' && !picking)) {
            return;
        }
        const timer = window.setTimeout(() => {
            performAsPerson('file.search', { query: trimmed, limit: FILE_RESULTS })
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
    }, [browsing, folder, grepping, picking, query]);

    /* A file row does what the palette was opened for: a node where the menu was clicked, a view of
       its own, or the preview tab every other route here means. */
    const openFile = useCallback(
        (path: string, line: number | null = null): void => {
            if (folder === null) {
                return;
            }
            const absolute = absoluteOf(folder, path);
            if (filePick?.kind === 'node') {
                void showFileOnCanvas(absolute, filePick.at);
                return;
            }
            if (filePick?.kind === 'view') {
                void createViewAction('file', { path: absolute });
                return;
            }
            void runAsPerson('file.preview', { path: absolute, line });
        },
        [filePick, folder]
    );

    /* What the daemon says about the path in the field: there, not there, or a daemon too old to say. */
    const presence = browsing && !machineStep && query.trim() !== '' ? folderPresence(query, listing?.result ?? null, sep) : 'unknown';

    /* The main column says how the open goes from here, and why it failed, so the palette is out of the way at once. */
    const submitPath = (path: string): void => {
        setOpen(false);
        openFolderAction(browseEndpointId, path, presence === 'missing');
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
                    const link = machineLink(row.entry, connectionOf(row.endpointId), null);
                    const hint = linkHint(link);
                    const hintLine = hint === undefined ? null : <span className="max-w-64 truncate text-xs text-text-faint">{hint}</span>;
                    return {
                        id: `machine-${row.endpointId}`,
                        label: row.label,
                        /* The icon a machine was given, the same one the settings page and every menu
                           show; the daemon's own hostname behind the name said nothing the name did not. */
                        icon: <MachineGlyph icon={iconOfEntry(row.entry, servers[row.endpointId]?.icon ?? null)} size={14} />,
                        trailing: (
                            <>
                                {link.kind === 'failed' && hintLine !== null ? <Tooltip label={link.reason}>{hintLine}</Tooltip> : hintLine}
                                <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', linkDot(link))} />
                            </>
                        ),
                        section: 'machines' as const,
                        run: () => chooseMachine(row.endpointId)
                    };
                });
        }
        if (browsing) {
            // A machine that is not open yet has no folders to show; its step says what it is waiting on.
            if (linkWait !== null) {
                return [];
            }
            const up = parentOf(query, sep);
            const list: Entry[] = [];
            // The row that goes up is the first item inside the group, not a row of its own above it.
            if (up !== null) {
                list.push({
                    id: 'browse-up',
                    label: '..',
                    icon: <Icon icon={CornerLeftUp} size={14} />,
                    section: 'folders',
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
                    section: 'folders',
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
                    hint: here ? t(`nodeKinds.${node.kind}`) : t('palette.kindInView', { kind: t(`nodeKinds.${node.kind}`), view: view.name }),
                    icon: KIND_ICON[node.kind],
                    here,
                    section: 'jump' as const,
                    run: () => revealNode(node.id)
                }));
        });
        const viewSwitches: Entry[] = views.filter(isOpenableView).map((view, index) => ({
            id: `view-${view.id}`,
            label: view.name ?? '',
            shortcut: viewShortcut(index),
            icon: (
                <ViewGlyph
                    id={view.id}
                    kind={view.kind}
                    icon={viewIconOf(view)}
                    provider={view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : null}
                    path={view.kind === 'file' ? view.path : null}
                />
            ),
            section: 'views' as const,
            run: () => showView(view.id)
        }));
        /* One list with the machine on the row, rather than a section per machine: a project is
           looked for by its own name, and which daemon it is on is what tells two of them apart. */
        const projectMachines = new Set(projects.map((row) => row.endpointId));
        const switches: Entry[] = projects
            .filter((row) => row.summary.available && !(row.summary.projectId === currentProjectId && row.endpointId === currentEndpointId))
            .map(({ endpointId, summary }) => {
                const where = summary.folder;
                const label = endpoints.find((endpoint) => endpoint.id === endpointId)?.label ?? t('start.anotherMachine');
                const machine = connected.includes(endpointId) ? label : t('palette.machineNotConnected', { machine: label });
                return {
                    id: `project-${endpointId}-${summary.projectId}`,
                    label: summary.name,
                    hint: projectMachines.size > 1 ? `${machine} · ${where}` : where,
                    icon: <ProjectGlyph projectId={summary.projectId} endpointId={endpointId} icon={summary.icon} color={summary.color} size={14} />,
                    section: 'projects',
                    run: () => openProjectAction(endpointId, summary.projectId)
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
                section: 'files' as const,
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
                ...split.recent.slice(0, OPENING_RECENTS).map((command) => asEntry(command, 'recent')),
                ...jumps.filter((entry) => entry.here === true).slice(0, OPENING_JUMPS),
                ...viewSwitches,
                ...featured.map((command) => asEntry(command, 'actions'))
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
            ...commands.map((command) => asEntry(command, 'actions')).filter(keep)
        ];
    }, [
        browsing,
        listing,
        chooseMachine,
        connected,
        connectionOf,
        endpoints,
        fileMatches,
        grepping,
        machines,
        machineStep,
        linkWait,
        nodes,
        openFile,
        picking,
        order,
        sep,
        views,
        activeViewId,
        query,
        recents,
        projects,
        servers,
        currentProjectId,
        currentEndpointId,
        t
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
        openFile(match.path, match.line);
    };

    /* The machines take the list over and the field empties, so it can narrow them; the path the
       folders step was on rides along in the step, and Backspace puts it back. */
    const showMachines = (): void => {
        if (browse === null) {
            return;
        }
        setBrowse(machinesStep(browse, query));
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

    const browseLabel = browseRow?.label ?? endpoints.find((endpoint) => endpoint.id === browseEndpointId)?.label ?? t('connection.thisMachine');
    const browseIcon = browseRow ? iconOfEntry(browseRow.entry, servers[browseEndpointId]?.icon ?? null) : (servers[browseEndpointId]?.icon ?? null);
    const backTo = browse === null ? null : browseBack(browse, machines.length).to;
    const backLabel = backTo === 'folders' ? t('palette.backToFolders') : backTo === 'machines' ? t('palette.browseAnother') : t('palette.backToPalette');
    const submitLabel = presence === 'missing' ? t('palette.createAndOpen') : t('projectMenu.openFolder');
    // Enter means "use what I typed" until a row is highlighted, and then the shortcut takes that over.
    const submitShortcut = active === undefined ? KEY_SHORTCUTS.enter : KEY_SHORTCUTS.modEnter;
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
        if (entry.section !== 'jump' && entry.section !== 'files' && entry.section !== 'views' && entry.section !== 'projects') {
            setRecents(rememberRecent(entry.id));
        }
        setOpen(false);
        entry.run();
    };

    return (
        <Dialog.Root open={open && entered} onOpenChange={setOpen} onOpenChangeComplete={(isOpen) => !isOpen && onClosed()}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup
                    /* Wider while searching in files, since a hit is read in the lines around it and those
                       lines are source, which does not fold. Never centered either: the popup grows and
                       shrinks with every keystroke, and a centered list would walk up the screen as you type. */
                    className={clsx('dialog-popup top-[18vh] [translate:-50%_0]', grepping ? 'w-[760px]' : 'w-[576px]')}
                    initialFocus={inputRef}
                >
                    <div className="flex items-center gap-2 border-b border-border px-3">
                        {/* The leading slot is the way one step back, and on the folders of a machine
                            it says which machine that is. With one machine there is nothing to name,
                            so it is the plain arrow that leaves browsing. */}
                        {browsing && (
                            <Tooltip label={backLabel} kbd={KEY_SHORTCUTS.backspace}>
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
                                            <MachineGlyph icon={browseIcon} size={14} />
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
                            aria-label={grepping ? t('palette.searchFiles') : picking ? t('palette.pickFile') : t('palette.inputLabel')}
                            /* A path stays in the same sans font as everything else: monospace makes
                               it read as something to be read rather than something to be typed. */
                            className={clsx(
                                'h-11 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint',
                                grepping && 'font-mono text-code'
                            )}
                            placeholder={
                                grepping
                                    ? t('palette.searchFiles')
                                    : picking
                                      ? t('palette.pickFile')
                                      : machineStep
                                        ? t('palette.searchMachines')
                                        : browsing
                                          ? t('palette.pathPlaceholder')
                                          : t('palette.placeholder')
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
                                    } else if (linkWait !== null) {
                                        if (linkWait.state === 'failed') {
                                            retry();
                                        }
                                    } else if (
                                        browsing &&
                                        !machineStep &&
                                        (active === undefined || matchesShortcut(KEY_SHORTCUTS.modEnter, e, isApplePlatform()))
                                    ) {
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
                                    label={t('palette.matchCase')}
                                    active={grepOptions.caseSensitive}
                                    onClick={() => setGrepOptions((current) => ({ ...current, caseSensitive: !current.caseSensitive }))}
                                />
                                <SearchToggle
                                    icon={WholeWord}
                                    label={t('palette.wholeWords')}
                                    active={grepOptions.wholeWord}
                                    onClick={() => setGrepOptions((current) => ({ ...current, wholeWord: !current.wholeWord }))}
                                />
                                <SearchToggle
                                    icon={Regex}
                                    label={t('palette.regex')}
                                    active={grepOptions.regex}
                                    onClick={() => setGrepOptions((current) => ({ ...current, regex: !current.regex }))}
                                />
                            </span>
                        )}
                        {/* The button that opens what was typed sits in the field, at its right end,
                            carrying the one shortcut that does the same thing. */}
                        {browsing && !machineStep && linkWait === null && (
                            <Tooltip label={submitLabel} kbd={submitShortcut}>
                                <Button size="sm" variant="secondary" disabled={query.trim() === ''} onClick={() => submitPath(query)}>
                                    {submitLabel}
                                    <Kbd shortcut={submitShortcut} variant="inline" />
                                </Button>
                            </Tooltip>
                        )}
                        {!browsing && <Kbd shortcut={KEY_SHORTCUTS.escape} variant="inline" />}
                    </div>
                    <div id={LIST_ID} className="max-h-[50vh] overflow-auto p-1.5" role="listbox" aria-label={t('palette.results')}>
                        <div aria-live="polite">
                            {entries.length === 0 && !browsing && !grepping && !picking && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">{t('palette.noMatch')}</div>
                            )}
                            {picking && entries.length === 0 && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">
                                    {folder === null ? t('palette.noProjectFolder') : t('palette.noFileMatch')}
                                </div>
                            )}
                            {grepping && query.trim() !== '' && !grep.busy && grep.failure === null && grep.matches.length === 0 && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">{t('palette.noLineMatch')}</div>
                            )}
                            {grepping && query.trim() === '' && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">{t('palette.typeToSearch')}</div>
                            )}
                            {machineStep && entries.length === 0 && (
                                <div className="px-3 py-6 text-center text-xs text-text-faint">
                                    {machines.length === 0 ? t('palette.noMachineYet') : t('palette.noMachineMatch')}
                                </div>
                            )}
                            {/* The machine whose folders were asked for, while its link comes up or after it did not. */}
                            {linkWait !== null && (
                                <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-xs text-text-faint">
                                    <MachineGlyph icon={browseIcon} size={20} className="text-text-muted" />
                                    {linkWait.state === 'connecting' ? (
                                        <span role="status">
                                            {browseRow?.entry.endpoint?.pairedBy === 'statement' || browseRow?.entry.endpoint === null
                                                ? t('palette.connectingThroughAccount', { machine: browseLabel })
                                                : t('switch.connecting', { machine: browseLabel })}
                                        </span>
                                    ) : (
                                        <>
                                            <span className="text-text-muted">{t('palette.notReachable', { machine: browseLabel })}</span>
                                            <span className="max-w-md text-status-error" role="alert">
                                                {linkWait.reason}
                                            </span>
                                            <Button size="sm" variant="secondary" onClick={retry}>
                                                {t('common:action.retry')}
                                                <Kbd shortcut={KEY_SHORTCUTS.enter} variant="inline" />
                                            </Button>
                                        </>
                                    )}
                                </div>
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
                        {/* An empty folder is the label with nothing under it: no spinner, no message,
                            and the previous listing stays up until the next one lands. */}
                        {browsing && !machineStep && linkWait === null && entries.length === 0 && (
                            <div className={`${SECTION_LABEL} px-2.5 pt-1.5 pb-1`}>{t('palette.sections.folders')}</div>
                        )}
                        {entries.map((entry, i) => {
                            const first = i === 0 || entries[i - 1]!.section !== entry.section;
                            return (
                                <div key={entry.id}>
                                    {first && <div className={`${SECTION_LABEL} px-2.5 pt-1.5 pb-1`}>{t(`palette.sections.${entry.section}`)}</div>}
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
                                        {entry.shortcut && <Kbd shortcut={entry.shortcut} variant="inline" />}
                                    </button>
                                </div>
                            );
                        })}
                        {/* fs.browse says whether the typed folder exists, so a missing one can be offered for creation. */}
                        {presence === 'missing' && <div className="px-3 py-6 text-center text-xs text-text-faint">{t('palette.createHint')}</div>}
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
                                        ? t('palette.nothingYet')
                                        : t('palette.grepCount', { count: grep.files, hits: `${grep.matches.length}${grep.truncated ? '+' : ''}` })}
                                </span>
                            )}
                            <span className="grow" />
                            <span>
                                <Kbd shortcut={KEY_SHORTCUTS.enter} variant="inline" /> {t('palette.grepEnterHint')}{' '}
                                <Kbd shortcut={KEY_SHORTCUTS.backspace} variant="inline" /> {t('palette.grepBackHint')}
                            </span>
                        </div>
                    )}
                    {browsing && (
                        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-text-faint">
                            <span className="flex shrink-0 items-center gap-1.5">
                                <kbd className={TOOLTIP_KBD}>↑</kbd>
                                <kbd className={TOOLTIP_KBD}>↓</kbd> {t('palette.navigate')}
                            </span>
                            {/* The Enter hint is left out once the typed path can be opened, because
                                the button in the field is already saying so. */}
                            {linkWait === null && (active !== undefined || query.trim() === '') && (
                                <span className="flex shrink-0 items-center gap-1.5">
                                    <Kbd shortcut={KEY_SHORTCUTS.enter} variant="inline" /> {t('common:action.select')}
                                </span>
                            )}
                            <span className="flex shrink-0 items-center gap-1.5">
                                <Kbd shortcut={KEY_SHORTCUTS.backspace} variant="inline" /> {t('projectBanner.back')}
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                                <Kbd shortcut={KEY_SHORTCUTS.escape} variant="inline" /> {t('common:action.close')}
                            </span>
                            <span className="grow" />
                            {failure && (
                                <span className="truncate text-status-error" role="alert">
                                    {failure}
                                </span>
                            )}
                            {/* A native dialog can only see the file system of the machine it runs on. */}
                            {!machineStep && linkWait === null && nativeDialog !== null && (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                        void nativeDialog.pickFolder(listing?.result?.parentPath).then((picked) => (picked ? submitPath(picked) : undefined))
                                    }
                                >
                                    {t('palette.browseIn', { app: fileManagerName(nativeDialog.platform) })}
                                </Button>
                            )}
                        </div>
                    )}
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

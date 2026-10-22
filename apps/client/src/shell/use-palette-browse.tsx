import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CornerLeftUp, Folder, FolderCheck } from 'lucide-react';
import type { FsBrowseResult } from '@ruimte/contracts';
import { Button, Icon, Kbd, KEY_SHORTCUTS, matchesShortcut, messageOf, SectionLabel, Tooltip } from '@adecore/ui';
import { openFolderAction } from '@/actions/client-actions';
import { desktop, isApplePlatform } from '@/desktop/bridge';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { ensureMachine } from '@/endpoint/reach';
import { newChatOn } from '@/project/new-chat';
import {
    browseBack,
    browseMachines,
    browseStart,
    endsWithSeparator,
    folderPresence,
    typedPathOffer,
    linkDot,
    linkHint,
    machineLink,
    machinesStep,
    openBrowse,
    parentOf,
    pickMachine,
    retryLink,
    separatorFor,
    settleLink,
    type BrowseStep
} from '@/shell/palette-browse';
import { PaletteEntryList, PaletteNote } from '@/shell/PaletteEntryList';
import { activeEntryOf, matches, optionId, type Entry, type PaletteContext, type PaletteModeView } from '@/shell/palette-entries';
import { iconOfEntry } from '@/shell/settings/machine-icon';
import { mergeMachines } from '@/shell/settings/machine-list';
import { usePulsarAccount } from '@/pulsar/account';
import { refreshAccountMachines, usePulsarMachines } from '@/pulsar/machines';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { hasLocalMachine, isRealMachine } from '@/state/local-machine';
import { shownFolderOf, useProject } from '@/state/project';
import { fileManagerName, serverInfoOf, useServers } from '@/state/server';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { pool, transportFor, type ConnectionState } from '@/transport';
import { useFocusedMachine } from '@/transport/connections';
import { useConnections } from '@/transport/status';
import type { Transport } from '@/transport/transport';

// Typing a path turns the palette into a folder browser; anything else searches nodes and actions.
function isPathQuery(query: string): boolean {
    return query.startsWith('/') || query.startsWith('~') || query.startsWith('./') || query.startsWith('../');
}

const BROWSE_DEBOUNCE_MS = 60;

/* What a machine with no link in the pool reads as. */
const NO_LINK: ConnectionState = { status: 'closed', attempts: 0, retryAt: null, failure: null };

interface BrowseAnswer {
    result: FsBrowseResult | null;
    failure: string | null;
}

/*
 * One listing from one machine, which is not always the machine the app is pointed at. Browsing a
 * machine is asking for it, so its link is brought up first; a machine forgotten mid-browse fails
 * there with its reason.
 */
async function requestBrowse(endpointId: string, partialPath: string, cwd: string | null, fallback: Transport): Promise<BrowseAnswer> {
    try {
        const socket = transportFor(await ensureMachine(endpointId)) ?? fallback;
        return { result: await socket.request('fs.browse', { partialPath, cwd: cwd ?? undefined }), failure: null };
    } catch (e) {
        return { result: null, failure: e instanceof Error ? e.message : i18next.t('shell:palette.unreadablePath') };
    }
}

/* What a listing is of. The separator is one no path can carry, so two of them never read as one. */
function browseKey(endpointId: string, path: string): string {
    return `${endpointId}\u0000${path}`;
}

/* The row that goes up is the first item inside the folders group, not a row of its own above it. */
function folderEntries(up: string | null, result: FsBrowseResult | null): Entry[] {
    const list: Entry[] = [];
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
    /* The check on a folder that already holds a canvas says what Enter does: open that project
       again rather than make a second one beside it. */
    for (const entry of result?.entries ?? []) {
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

/*
 * Browsing the folders of a machine to open one as a project, after picking the machine when there
 * is more than one. Typing a path in the ordinary palette is a way in too; `blocked` is a search
 * that has the field to itself.
 */
export function usePaletteBrowse(context: PaletteContext, blocked: boolean) {
    const { t } = useTranslation(['shell', 'common']);
    const { open, query, setQuery, index, setIndex, close } = context;
    const folder = useProject((s) => shownFolderOf(s.current));
    const currentEndpointId = useProject((s) => s.currentEndpointId);
    const endpoints = useEndpoints((s) => s.endpoints);
    const activeId = useEndpoints((s) => s.activeId);
    /* The palette sits outside the workspace, so it works on the machine of the open project, or the active one on the start screen. */
    const { transport } = useFocusedMachine();
    /* The machine the switcher asked the browser to open on, for a machine it lists nothing of. */
    const browseTarget = useUi((s) => s.paletteBrowseMachine);
    const browseFor = useUi((s) => s.paletteBrowseFor);
    const browseStartFolder = useSettings((s) => s.browseStartFolder);
    const accountStatus = usePulsarAccount((s) => s.status);
    const accountMachines = usePulsarMachines((s) => s.machines);
    const connections = useConnections();
    /* Which step of browsing the palette is on, and null when it is not browsing at all. A step of
       its own rather than something the text says, so browsing can open on nothing typed. */
    const [browse, setBrowse] = useState<BrowseStep | null>(null);
    /* The listing on screen, under the machine and path it was asked for, so a navigation that
       already fetched one does not have the typing effect ask for it a second time. */
    const [listing, setListing] = useState<{ key: string; result: FsBrowseResult | null } | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const generation = useRef(0);
    const browseEndpointId = browse?.endpointId ?? activeId;
    const machineStep = browse?.machines === true;
    const platform = useServers((s) => s.byEndpoint[browseEndpointId]?.platform ?? null);
    /* The whole map, because the machine rows draw an icon each and the icons arrive one machine at a time. */
    const servers = useServers((s) => s.byEndpoint);
    const sep = separatorFor(platform);
    /* Every machine this client knows, joined the way the Machines pane joins them, so one the account
       has and nothing here ever opened is a row to pick like any other. */
    const machines = browseMachines(
        mergeMachines({ endpoints, accountMachines: accountStatus === 'signed-in' ? accountMachines : null, showLocal: hasLocalMachine() }),
        activeId
    );
    const connectionOf = (endpointId: string): ConnectionState => connections[endpointId] ?? NO_LINK;
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
    const typed = (next: string): void => {
        setBrowse(browse ?? pathStep(next));
        setFailure(null);
    };

    /* Opening, a mode change and the browse command start over on the machine the app is pointed at.
       A browsing step opens with an empty field and the effect below asks for its start folder, so
       the path and the first listing land together. */
    const restart = (next: string, browseNow: boolean): void => {
        setListing(null);
        setFailure(null);
        const isOpen = (endpointId: string): boolean => connectionOf(endpointId).status === 'open';
        const step: BrowseStep | null = browseNow
            ? browseFor === 'chat'
                ? { endpointId: activeId, machines: true, path: '' }
                : browseTarget !== null
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

    const browsing = !blocked && browse !== null;

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
    const commitBrowse = useCallback(
        (endpointId: string, path: string, answer: BrowseAnswer): void => {
            setListing({ key: browseKey(endpointId, path), result: answer.result });
            setFailure(answer.failure);
            setBrowse({ endpointId, machines: false, path });
            setQuery(path);
            setIndex(0);
        },
        [setIndex, setQuery]
    );

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

    /* The start folder is one setting for every machine, so it may not exist on this one; home always does. */
    const startBrowsing = useCallback(
        async (endpointId: string): Promise<void> => {
            const { start: from, home } = browseStart(browseStartFolder, separatorFor(serverInfoOf(endpointId).platform));
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
     * An open machine lists its folders at once; any other waits for its link on a step of its own.
     * The path resets to that machine's start folder, since a path from one machine rarely exists on the next.
     */
    const chooseMachine = (endpointId: string): void => {
        setFailure(null);
        if (browseFor === 'chat') {
            close();
            void newChatOn(endpointId);
            return;
        }
        if (connectionOf(endpointId).status === 'open') {
            void startBrowsing(endpointId);
            return;
        }
        setListing(null);
        setQuery('');
        setIndex(0);
        setBrowse(pickMachine(endpointId, false));
    };

    const retry = (): void => {
        setFailure(null);
        setBrowse((step) => retryLink(step));
    };

    /* What Enter does with the path in the field, after what the daemon says about it: there, not there, or a daemon too old to say. */
    const offer = browsing && !machineStep && query.trim() !== '' ? typedPathOffer(query, platform, folderPresence(query, listing?.result ?? null, sep)) : null;

    /* The main column says how the open goes from here, and why it failed, so the palette is out of the way at once. */
    const submitPath = (path: string): void => {
        close();
        openFolderAction(browseEndpointId, path, offer === 'create');
    };

    const listEntries = (): Entry[] => {
        if (!browsing) {
            return [];
        }
        if (machineStep) {
            // Typing on this step narrows the machines, the way typing narrows every other list here.
            return machines
                .filter((row) => matches(query, row.label))
                .map((row) => {
                    const link = machineLink(row.entry, connectionOf(row.endpointId), null);
                    const hint = linkHint(link);
                    const hintLine =
                        hint === undefined ? null : <span className="max-w-64 min-w-0 shrink-[1000] truncate text-xs text-text-faint">{hint}</span>;
                    return {
                        id: `machine-${row.endpointId}`,
                        label: row.label,
                        // The icon a machine was given, the same one the settings page and every menu show.
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
        // A machine that is not open yet has no folders to show; its step says what it is waiting on.
        if (linkWait !== null) {
            return [];
        }
        return folderEntries(parentOf(query, sep), listing?.result ?? null);
    };
    const entries = listEntries();

    /* Every list opens with its first row highlighted, browsing included, so Enter walks into the
       folders without an arrow key first and Cmd+Enter is what opens the path in the field. */
    const active = activeEntryOf(entries, index);

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

    /* A browse row steps somewhere and the palette stays open. */
    const run = (entry: Entry | undefined): void => {
        if (!entry) {
            return;
        }
        if (entry.browsePath === undefined) {
            entry.run();
            return;
        }
        void navigateTo(endsWithSeparator(entry.browsePath) ? entry.browsePath : `${entry.browsePath}${sep}`, browseEndpointId);
    };

    const browseLabel = browseRow?.label ?? endpoints.find((endpoint) => endpoint.id === browseEndpointId)?.label ?? t('connection.thisMachine');
    const browseIcon = browseRow ? iconOfEntry(browseRow.entry, servers[browseEndpointId]?.icon ?? null) : (servers[browseEndpointId]?.icon ?? null);
    const backTo = browse === null ? null : browseBack(browse, machines.length).to;
    const backLabel = backTo === 'folders' ? t('palette.backToFolders') : backTo === 'machines' ? t('palette.browseAnother') : t('palette.backToPalette');
    const submitLabel = offer === 'create' ? t('palette.createAndOpen') : t('projectMenu.openFolder');
    // Enter means "use what I typed" until a row is highlighted, and then the shortcut takes that over.
    const submitShortcut = active === undefined ? KEY_SHORTCUTS.enter : KEY_SHORTCUTS.modEnter;
    /* The shell's own picker, which only makes sense for the daemon that served this page: the word
       on the button is the Electron machine's, because that is whose dialog opens. */
    const nativeDialog = browseEndpointId === LOCAL_ENDPOINT_ID ? desktop() : null;

    const view: PaletteModeView = {
        count: entries.length,
        activeOptionId: active ? optionId(entries.indexOf(active)) : undefined,
        enter: (event) => {
            if (linkWait !== null) {
                if (linkWait.state === 'failed') {
                    retry();
                }
            } else if (!machineStep && (active === undefined || matchesShortcut(KEY_SHORTCUTS.modEnter, event, isApplePlatform()))) {
                if (offer !== 'relative') {
                    submitPath(query);
                }
            } else {
                run(active);
            }
        },
        tab: () => {
            if (machineStep || !active?.browsePath) {
                return false;
            }
            // Completes the field to the folder under the highlight, without stepping into it.
            setQuery(active.browsePath);
            setIndex(0);
            return true;
        },
        back: () => {
            stepBack();
            return true;
        },
        /* One step back; on the folders of a machine it names that machine. */
        leading: (
            <Tooltip label={backLabel} kbd={KEY_SHORTCUTS.backspace}>
                <Button
                    size="xs"
                    // The field keeps the keys; a control that takes focus would swallow the next arrow.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={stepBack}
                    aria-label={backLabel}
                >
                    {backTo !== 'machines' ? (
                        <Icon icon={ArrowLeft} size={14} />
                    ) : (
                        <>
                            {/* The machine's icon rather than a status dot: a machine whose folders are on screen is answering. */}
                            <MachineGlyph icon={browseIcon} size={14} />
                            <span className="max-w-32 truncate">{browseLabel}</span>
                        </>
                    )}
                </Button>
            </Tooltip>
        ),
        trailing: !machineStep && linkWait === null && offer !== 'relative' && (
            <Tooltip label={submitLabel} kbd={submitShortcut}>
                <Button size="sm" variant="secondary" disabled={query.trim() === ''} onClick={() => submitPath(query)}>
                    {submitLabel}
                    <Kbd shortcut={submitShortcut} variant="inline" />
                </Button>
            </Tooltip>
        ),
        notes: (
            <>
                {offer === 'relative' && <PaletteNote>{t('palette.relativePath')}</PaletteNote>}
                {machineStep && entries.length === 0 && (
                    <PaletteNote>{machines.length === 0 ? t('palette.noMachineYet') : t('palette.noMachineMatch')}</PaletteNote>
                )}
                {/* The machine whose folders were asked for, while its link comes up or after it did not. */}
                {linkWait !== null && (
                    <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-xs text-text-faint">
                        <MachineGlyph icon={browseIcon} size={20} className="text-text-muted" />
                        {linkWait.state === 'connecting' ? (
                            <span role="status">
                                {browseRow !== null && !browseRow.entry.local
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
            </>
        ),
        results: (
            <>
                {/* An empty folder is the label with nothing under it; the previous listing stays up until the next one lands. */}
                {!machineStep && linkWait === null && entries.length === 0 && (
                    <SectionLabel render={<div />} className="px-2.5 pt-1.5 pb-1">
                        {t('palette.sections.folders')}
                    </SectionLabel>
                )}
                <PaletteEntryList entries={entries} active={active} onHover={setIndex} onRun={(entry) => run(entry)} />
                {/* fs.browse says whether the typed folder exists, so a missing one can be offered for creation. */}
                {offer === 'create' && <PaletteNote>{t('palette.createHint')}</PaletteNote>}
            </>
        ),
        footer: (
            <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-text-faint">
                <span className="flex shrink-0 items-center gap-1.5">
                    <Kbd variant="inline">↑</Kbd>
                    <Kbd variant="inline">↓</Kbd> {t('palette.navigate')}
                </span>
                {/* Once the typed path can be opened, the button in the field already shows Enter. */}
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
                        onClick={() => void nativeDialog.pickFolder(listing?.result?.parentPath).then((picked) => (picked ? submitPath(picked) : undefined))}
                    >
                        {t('palette.browseIn', { app: fileManagerName(nativeDialog.platform) })}
                    </Button>
                )}
            </div>
        )
    };

    return { browsing, typed, restart, placeholder: machineStep ? t('palette.searchMachines') : t('palette.pathPlaceholder'), view };
}

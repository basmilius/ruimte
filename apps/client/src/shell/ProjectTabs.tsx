import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Pin, PinOff } from 'lucide-react';
import { openProjectAction } from '@/actions/client-actions';
import { WaitingCount } from '@/attention/WaitingCount';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { desktop } from '@/desktop/bridge';
import {
    dragsWindow,
    landingOf,
    pinnedOf,
    pinWindowTab,
    reorderWindowTab,
    setStripIndexAt,
    stepMove,
    stepWindowTab,
    useWindowTabs
} from '@/project/window-tabs';
import {
    canDragTabs,
    canOpenWindows,
    endTabDrag,
    openInNewWindow,
    outsideViewport,
    startWindowDrag,
    tearOffTab,
    tearOutTab,
    wantsNewWindow
} from '@/project/windows';
import { ProjectAddMenu } from '@/shell/ProjectMenu';
import { useProjectMenu } from '@/shell/project-menu-model';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { splitKey } from '@/state/keys';
import { sidebarWaitingCount, useWaitingCount } from '@/state/attention';
import { useSnoozes } from '@/state/snooze';
import { useProject } from '@/state/project';
import { useProjectList, type ProjectRow } from '@/state/project-list';
import { useServers } from '@/state/server';
import { ContextMenu, Icon, Menu, Tabs, Tooltip } from '@adecore/ui';
import { useSidebarMachines } from './sidebar-projects';

/* How far a pressed tab moves before it is a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

/* How far above or below the strip a dragged tab goes before it tears off into a window of its own. */
const TEAR_DISTANCE_PX = 24;

/* The width of `.ade-tab-insertion`, and how far outside the first or last tab it stands. */
const INSERTION_WIDTH_PX = 2;
const INSERTION_INSET_PX = 2;

function CurrentProjectAttention() {
    return <WaitingCount count={useWaitingCount()} />;
}

/* A pressed tab: still a click, moving along the strip, out of the window, or moving the window itself. */
interface Press {
    key: string;
    pointerId: number;
    /* Where in the window the press began, which is where the pointer holds a window it tears off into. */
    grab: { x: number; y: number };
    mode: 'press' | 'reorder' | 'out' | 'window';
    /* Where among the other tabs a reorder lets the tab go, or null while it would stay where it is. */
    landing: number | null;
}

/* The tab under a right-click, read off the element the press landed in. */
function tabKeyOf(event: MouseEvent<HTMLElement>): string | null {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tab-key]') : null;
    return target?.dataset.tabKey ?? null;
}

/* Shift alone closes a tab, as a middle click does; with Cmd or Ctrl it stays the press that opens a window. */
function closesTab(event: MouseEvent<HTMLElement>): boolean {
    return event.button === 0 && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}

/* The place among the other tabs of the strip where a dragged tab lands: before the first one whose middle is right of the pointer. */
function dropIndex(strip: Element, key: string, x: number): number {
    const others = [...strip.querySelectorAll<HTMLElement>('[data-tab-key]')].filter((tab) => tab.dataset.tabKey !== key);
    return others.filter((tab) => {
        const box = tab.getBoundingClientRect();
        return box.left + box.width / 2 < x;
    }).length;
}

/* Where in the strip the insertion line stands for a tab landing at `landing` among the others: halfway the gap it goes in. */
function insertionLeft(strip: Element, others: readonly string[], landing: number): number {
    const boxOf = (key: string | undefined) =>
        key === undefined ? null : (strip.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(key)}"]`)?.getBoundingClientRect() ?? null);
    const before = boxOf(others[landing - 1]);
    const after = boxOf(others[landing]);
    const origin = strip.getBoundingClientRect().left;
    const x =
        before !== null && after !== null
            ? (before.right + after.left) / 2
            : after !== null
              ? after.left - INSERTION_INSET_PX
              : (before?.right ?? origin) + INSERTION_INSET_PX;
    return Math.max(0, Math.round(x - origin - INSERTION_WIDTH_PX / 2));
}

/*
 * The projects this window keeps, in place of the switcher, with the switcher itself behind the plus.
 * A tab whose row the list does not have yet waits for it, since a tab without a name says nothing.
 */
export function ProjectTabs({ dirty }: { readonly dirty: boolean }) {
    const { t } = useTranslation('shell');
    const model = useProjectMenu();
    const tabs = useWindowTabs((s) => s.tabs);
    const pins = pinnedOf(tabs);
    const rows = useProjectList((s) => s.projects);
    const current = useProject((s) => s.current);
    const currentEndpointId = useProject((state) => state.currentEndpointId);
    const machines = useSidebarMachines(
        true,
        [
            ...new Set(
                rows
                    .filter(
                        (row) =>
                            tabs.keys.includes(`${row.endpointId}:${row.summary.projectId}`) &&
                            !(row.endpointId === currentEndpointId && row.summary.projectId === current?.projectId)
                    )
                    .map((row) => row.endpointId)
            )
        ],
        false
    );
    const snoozes = useSnoozes((state) => state.byKey);
    const endpoints = useEndpoints((s) => s.endpoints);
    const servers = useServers((s) => s.byEndpoint);
    const [menuKey, setMenuKey] = useState<string | null>(null);
    const [insertion, setInsertion] = useState<number | null>(null);
    const press = useRef<Press | null>(null);
    const strip = useRef<HTMLDivElement>(null);
    const windows = canOpenWindows();
    const follows = canDragTabs();

    // The shell learns where the strip is, so a tab dragged out of another window can drop into it.
    useEffect(() => {
        const element = strip.current;
        const shell = desktop();
        if (element === null) {
            return;
        }
        setStripIndexAt((key, x) => dropIndex(element, key, x));
        const report = (): void => {
            const box = element.getBoundingClientRect();
            shell?.setTabStrip?.({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });
        };
        report();
        const observer = new ResizeObserver(report);
        observer.observe(element);
        observer.observe(document.documentElement);
        return () => {
            observer.disconnect();
            setStripIndexAt(null);
            shell?.setTabStrip?.(null);
        };
    }, []);

    const byKey = new Map<string, ProjectRow>(rows.map((row) => [`${row.endpointId}:${row.summary.projectId}`, row]));
    const shown = tabs.keys.filter((key) => byKey.has(key));
    const menuRow = menuKey === null ? null : (byKey.get(menuKey) ?? null);

    const select = (key: string): void => {
        const { endpointId, id } = splitKey(key);
        openProjectAction(endpointId, id);
    };

    const close = (row: ProjectRow): void => {
        void model.askClose({ endpointId: row.endpointId, machineLabel: '', connected: true, summary: row.summary });
    };

    const onPointerDown = (event: PointerEvent<HTMLElement>, key: string): void => {
        // The close button is a press of its own.
        if (event.button !== 0 || (event.target as Element).closest('button') !== null) {
            return;
        }
        // Held, the pointer keeps reporting to this tab outside the window too, which is where a tab tears off.
        event.currentTarget.setPointerCapture(event.pointerId);
        press.current = { key, pointerId: event.pointerId, grab: { x: event.clientX, y: event.clientY }, mode: 'press', landing: null };
    };

    /*
     * Out of the window the tab leaves this strip, and the element that held the press goes with it,
     * so the release is heard on the window itself, which keeps the pointer for as long as it is down.
     */
    const awaitRelease = (held: Press): void => {
        const types = ['pointerup', 'mouseup', 'pointercancel'] as const;
        const release = (): void => {
            for (const type of types) {
                removeEventListener(type, release);
            }
            if (press.current === held) {
                press.current = null;
            }
            void endTabDrag(held.key, held.mode === 'window');
        };
        for (const type of types) {
            addEventListener(type, release);
        }
    };

    const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
        const held = press.current;
        if (held === null || held.pointerId !== event.pointerId) {
            return;
        }
        if (held.mode === 'press') {
            if (Math.hypot(event.clientX - held.grab.x, event.clientY - held.grab.y) < DRAG_THRESHOLD_PX) {
                return;
            }
            if (follows && dragsWindow(shown, tabs.active, held.key)) {
                held.mode = 'window';
                awaitRelease(held);
                void startWindowDrag(held.key, held.grab);
                return;
            }
            held.mode = 'reorder';
        }
        if (held.mode !== 'reorder') {
            return;
        }
        const box = strip.current?.getBoundingClientRect();
        const offStrip = box !== undefined && (event.clientY < box.top - TEAR_DISTANCE_PX || event.clientY > box.bottom + TEAR_DISTANCE_PX);
        if (follows && (offStrip || outsideViewport(event.clientX, event.clientY))) {
            held.mode = 'out';
            held.landing = null;
            setInsertion(null);
            awaitRelease(held);
            // Held by the middle of its tab, at the start of a strip like this one, until the new window says where its strip is.
            const tab = event.currentTarget.getBoundingClientRect();
            const left = box?.left ?? tab.left;
            void tearOutTab(held.key, { x: left + tab.width / 2, y: tab.top + tab.height / 2 }, tab.width);
            return;
        }
        const row = event.currentTarget.parentElement;
        if (row === null || strip.current === null) {
            return;
        }
        // The strip stays put while the tab is held, so the line says where it lands and the drop moves it once.
        const current = useWindowTabs.getState().tabs;
        held.landing = landingOf(current, held.key, dropIndex(row, held.key, event.clientX));
        const others = current.keys.filter((one) => one !== held.key);
        setInsertion(held.landing === null ? null : insertionLeft(strip.current, others, held.landing));
    };

    const onPointerEnd = (event: PointerEvent<HTMLElement>, cancelled: boolean): void => {
        const held = press.current;
        if (held === null || held.pointerId !== event.pointerId) {
            return;
        }
        if (held.mode === 'out' || held.mode === 'window') {
            return;
        }
        press.current = null;
        setInsertion(null);
        if (held.mode !== 'reorder' || cancelled) {
            return;
        }
        if (!follows && windows && outsideViewport(event.clientX, event.clientY)) {
            void tearOffTab(held.key, { x: event.screenX - held.grab.x, y: event.screenY - held.grab.y });
            return;
        }
        if (held.landing !== null) {
            reorderWindowTab(held.key, held.landing);
        }
    };

    // A held tab whose element moves, as when a tab from another window drops into the strip, lets go of the capture; it is taken back.
    const onLostCapture = (event: PointerEvent<HTMLElement>): void => {
        const held = press.current;
        if (held === null || held.pointerId !== event.pointerId) {
            return;
        }
        if (held.mode === 'press' || held.mode === 'reorder') {
            try {
                event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
                press.current = null;
            }
        }
    };

    return (
        <>
            <Tabs.Root ref={strip} value={tabs.active ?? ''} onValueChange={(value) => select(String(value))} className="relative flex min-w-0 grow">
                <ContextMenu.Root>
                    <ContextMenu.Trigger
                        className="contents"
                        onContextMenu={(event) => {
                            const key = tabKeyOf(event);
                            if (key === null) {
                                event.preventBaseUIHandler();
                                return;
                            }
                            setMenuKey(key);
                        }}
                    >
                        <Tabs.List variant="pill" overflow="scroll" className="min-w-0 grow" after={<ProjectAddMenu model={model} />}>
                            {shown.map((key) => {
                                const row = byKey.get(key)!;
                                const active = key === tabs.active;
                                const summary = active && current?.projectId === row.summary.projectId ? current : row.summary;
                                const machine = row.endpointId === LOCAL_ENDPOINT_ID ? null : endpoints.find((endpoint) => endpoint.id === row.endpointId);
                                const pinned = pins.includes(key);
                                const snapshot = machines[row.endpointId];
                                const views = snapshot?.projects.find((project) => project.summary.projectId === summary.projectId)?.views;
                                const isCurrent = currentEndpointId === row.endpointId && current?.projectId === summary.projectId;
                                return (
                                    <Tabs.Tab
                                        key={key}
                                        value={key}
                                        data-tab-key={key}
                                        pinned={pinned}
                                        className="app-no-drag"
                                        onMouseDown={(event) => {
                                            // Shift extends the text selection from wherever it was.
                                            if (!pinned && closesTab(event)) {
                                                event.preventDefault();
                                            }
                                        }}
                                        onClick={(event) => {
                                            if (wantsNewWindow(event)) {
                                                event.preventBaseUIHandler();
                                                openInNewWindow(row.endpointId, row.summary.projectId);
                                            } else if (!pinned && closesTab(event)) {
                                                event.preventBaseUIHandler();
                                                close(row);
                                            }
                                        }}
                                        onClose={() => close(row)}
                                        onPointerDown={(event) => onPointerDown(event, key)}
                                        onPointerMove={onPointerMove}
                                        onPointerUp={(event) => onPointerEnd(event, false)}
                                        onPointerCancel={(event) => onPointerEnd(event, true)}
                                        onLostPointerCapture={onLostCapture}
                                    >
                                        <ProjectGlyph projectId={summary.projectId} endpointId={row.endpointId} icon={summary.icon} color={summary.color} />
                                        <span className="max-w-40 truncate">{summary.name}</span>
                                        {isCurrent ? (
                                            <CurrentProjectAttention />
                                        ) : snapshot?.state === 'ready' && views ? (
                                            <WaitingCount count={sidebarWaitingCount(views, snapshot.statuses, row.endpointId, snoozes)} />
                                        ) : null}
                                        {machine && (
                                            <Tooltip label={machine.label}>
                                                <span className="flex items-center text-text-faint">
                                                    <MachineGlyph icon={servers[row.endpointId]?.icon ?? null} size={14} />
                                                </span>
                                            </Tooltip>
                                        )}
                                        {active && dirty && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint" />}
                                    </Tabs.Tab>
                                );
                            })}
                        </Tabs.List>
                    </ContextMenu.Trigger>
                    {insertion !== null && <span aria-hidden data-tab-insertion className="ade-tab-insertion" style={{ left: insertion }} />}
                    <ContextMenu.Popup className="min-w-52">
                        {menuRow &&
                            menuKey !== null &&
                            model.actionsOf(
                                { ...menuRow, machineLabel: '', connected: true },
                                <>
                                    <Menu.Item onClick={() => pinWindowTab(menuKey, !pins.includes(menuKey))}>
                                        <Icon icon={pins.includes(menuKey) ? PinOff : Pin} size={14} />{' '}
                                        {t(pins.includes(menuKey) ? 'projectMenu.unpinTab' : 'projectMenu.pinTab')}
                                    </Menu.Item>
                                    <Menu.Item disabled={stepMove(tabs, menuKey, -1) === tabs} onClick={() => stepWindowTab(menuKey, -1)}>
                                        <Icon icon={ArrowLeft} size={14} /> {t('projectMenu.moveTabLeft')}
                                    </Menu.Item>
                                    <Menu.Item disabled={stepMove(tabs, menuKey, 1) === tabs} onClick={() => stepWindowTab(menuKey, 1)}>
                                        <Icon icon={ArrowRight} size={14} /> {t('projectMenu.moveTabRight')}
                                    </Menu.Item>
                                </>
                            )}
                    </ContextMenu.Popup>
                </ContextMenu.Root>
            </Tabs.Root>
            {model.dialogs}
        </>
    );
}

import { SlotMenuItems } from '@/extensions/SlotSurfaces';
import { useEffect, useState, type MouseEvent } from 'react';
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
import { canDragTabs, canOpenWindows, endTabDrag, openInNewWindow, startWindowDrag, tearOffTab, tearOutTab, wantsNewWindow } from '@/project/windows';
import { ProjectAddMenu } from '@/shell/ProjectMenu';
import { useProjectMenu } from '@/shell/project-menu-model';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { splitKey } from '@/state/keys';
import { sidebarWaitingCount, useWaitingCount } from '@/state/attention';
import { useSnoozes } from '@/state/snooze';
import { useProject } from '@/state/project';
import { useProjectList, type ProjectRow } from '@/state/project-list';
import { useServers } from '@/state/server';
import { ContextMenu, Icon, Menu, Tabs, tabDropIndex, Tooltip, useTabDrag } from '@adecore/ui';
import { useSidebarMachines } from './sidebar-projects';

function CurrentProjectAttention() {
    return <WaitingCount count={useWaitingCount()} />;
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

    const windows = canOpenWindows();
    const follows = canDragTabs();
    const { strip, insertion, tabProps } = useTabDrag({
        keys: () => useWindowTabs.getState().tabs.keys,
        landingOf: (key, index) => landingOf(useWindowTabs.getState().tabs, key, index),
        onReorder: reorderWindowTab,
        // Where the shell follows a held tab out of the window, it tears out at once; elsewhere it opens a window on release.
        onTearOut: follows ? (key, center, width) => void tearOutTab(key, center, width) : undefined,
        onTearOff: !follows && windows ? (key, at) => void tearOffTab(key, at) : undefined,
        dragsWindow: (key) => dragsWindow(shown, tabs.active, key),
        onWindowDrag: follows ? (key, grab) => void startWindowDrag(key, grab) : undefined,
        onRelease: (key, window) => void endTabDrag(key, window)
    });

    // The shell learns where the strip is, so a tab dragged out of another window can drop into it.
    useEffect(() => {
        const element = strip.current;
        const shell = desktop();
        if (element === null) {
            return;
        }
        setStripIndexAt((key, x) => tabDropIndex(element, key, x));
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
    }, [strip]);

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
                                        {...tabProps(key)}
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
                        <SlotMenuItems place="projectMenu" context={{}} />
                    </ContextMenu.Popup>
                </ContextMenu.Root>
            </Tabs.Root>
            {model.dialogs}
        </>
    );
}

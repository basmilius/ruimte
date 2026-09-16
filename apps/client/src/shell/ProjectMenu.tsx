import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Menu } from '@base-ui-components/react/menu';
import { Check, ChevronDown, ChevronRight, FolderOpen, History, Plus } from 'lucide-react';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { menuProjects, type ProjectMenuRow } from '@/project/list';
import { createProjectOn, openProject } from '@/project/open';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { ProjectNameDialog } from '@/shell/ProjectNameDialog';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { useProjectList } from '@/state/project-list';
import { useProject } from '@/state/project';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { useOpenEndpoints } from '@/transport/status';
import { MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

interface ProjectRowProps {
    row: ProjectMenuRow;
    /* One machine needs no naming; the label only earns its place in the row once there are two. */
    showMachine: boolean;
    current: boolean;
}

/* One project in the switcher. The folder is what the tooltip says, so the row stays a single line. */
function ProjectRow({ row, showMachine, current }: ProjectRowProps) {
    const { summary } = row;
    const tooltip = (
        <span className="flex flex-col items-start">
            <span>{summary.folder ?? 'Not in a folder'}</span>
            {/* Not connected is about the machine, unavailable about the folder; a row can be either. */}
            {!row.connected && <span className="text-text-muted">Not connected</span>}
            {!summary.available && <span className="text-text-muted">That folder is gone</span>}
        </span>
    );

    return (
        <Tooltip label={tooltip} side="right">
            <Menu.Item
                className={clsx('menu-item', (!summary.available || !row.connected) && 'opacity-50')}
                disabled={!summary.available}
                onClick={() => void openProject(row.endpointId, summary.projectId).catch(() => undefined)}
            >
                <ProjectGlyph projectId={summary.projectId} endpointId={row.endpointId} icon={summary.icon} color={summary.color} />
                <span className="min-w-0 truncate">{summary.name}</span>
                {showMachine && <span className="ml-auto pl-3 truncate text-xs text-text-faint">{row.machineLabel}</span>}
                {current && (
                    <span className={clsx('shrink-0', !showMachine && 'ml-auto')}>
                        <Icon icon={Check} size={14} />
                    </span>
                )}
            </Menu.Item>
        </Tooltip>
    );
}

/* The project segment of the toolbar's breadcrumb: every project this client can reach, and the two
   ways to bring in one that is not listed yet. What you can do to the project that is open is not
   here but in the toolbar's own menu, because those are options of a canvas rather than ways in. */
export function ProjectMenu() {
    const rows = useProjectList((s) => s.projects);
    const current = useProject((s) => s.current);
    const currentEndpointId = useProject((s) => s.currentEndpointId);
    const stored = useEndpoints((s) => s.endpoints);
    const endpoints = useMemo(() => listedEndpoints(stored), [stored]);
    const activeId = useEndpoints((s) => s.activeId);
    const connected = useOpenEndpoints();
    const [newOpen, setNewOpen] = useState(false);
    const { open, recent } = useMemo(() => menuProjects(rows, endpoints, connected), [rows, endpoints, connected]);
    const showMachine = endpoints.length > 1;
    const machineId = currentEndpointId ?? activeId;
    /* The pill names a machine only when the work is somewhere else. Being on the machine the app
       runs on is the ordinary case, and a prefix that is on screen whatever you do says nothing. */
    const machine = machineId === LOCAL_ENDPOINT_ID ? null : (endpoints.find((endpoint) => endpoint.id === machineId) ?? null);
    const machineIcon = useServers((s) => s.byEndpoint[machineId]?.icon ?? null);

    const isCurrent = (row: ProjectMenuRow): boolean => row.summary.projectId === current?.projectId && row.endpointId === currentEndpointId;

    return (
        <>
            <Menu.Root>
                <Menu.Trigger className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-surface-hover data-[popup-open]:bg-surface-active">
                    {machine && (
                        <>
                            {/* The name gives way long before the project's does: it is the same word for
                                every project on that machine, and what is left when it has gone is the
                                icon, which is the mark this machine carries everywhere else. The tooltip
                                is what says the name once the room for it is gone. */}
                            <Tooltip label={machine.label}>
                                <span className="flex min-w-0 shrink-[9999] items-center gap-2">
                                    <MachineGlyph icon={machineIcon} size={14} className="text-text-muted" />
                                    <span className="min-w-0 truncate text-sm text-text-muted">{machine.label}</span>
                                </span>
                            </Tooltip>
                            <span className="shrink-0 text-text-faint">/</span>
                        </>
                    )}
                    {current && (
                        <ProjectGlyph projectId={current.projectId} endpointId={currentEndpointId ?? undefined} icon={current.icon} color={current.color} />
                    )}
                    <span className="truncate text-sm font-medium text-text">{current?.name}</span>
                    <Icon icon={ChevronDown} size={14} className="shrink-0 text-text-muted" />
                </Menu.Trigger>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" side="bottom" sideOffset={6} align="start">
                        <Menu.Popup className="menu-popup min-w-60">
                            {open.length > 0 && <div className={MENU_LABEL}>Projects</div>}
                            {open.map((row) => (
                                <ProjectRow key={`${row.endpointId}:${row.summary.projectId}`} row={row} showMachine={showMachine} current={isCurrent(row)} />
                            ))}
                            {recent.length > 0 && (
                                <>
                                    {open.length > 0 && <Menu.Separator className={MENU_SEPARATOR} />}
                                    <Menu.SubmenuRoot>
                                        <Menu.SubmenuTrigger className="menu-item">
                                            <Icon icon={History} size={14} /> Recent projects
                                            <Icon icon={ChevronRight} size={14} className="ml-auto text-text-faint" />
                                        </Menu.SubmenuTrigger>
                                        <Menu.Portal>
                                            <Menu.Positioner className="z-(--z-popup)" sideOffset={4} alignOffset={-4}>
                                                <Menu.Popup className="menu-popup min-w-60">
                                                    {recent.map((row) => (
                                                        <ProjectRow
                                                            key={`${row.endpointId}:${row.summary.projectId}`}
                                                            row={row}
                                                            showMachine={showMachine}
                                                            current={false}
                                                        />
                                                    ))}
                                                </Menu.Popup>
                                            </Menu.Positioner>
                                        </Menu.Portal>
                                    </Menu.SubmenuRoot>
                                </>
                            )}
                            {(open.length > 0 || recent.length > 0) && <Menu.Separator className={MENU_SEPARATOR} />}
                            <Menu.Item className="menu-item" onClick={() => setNewOpen(true)}>
                                <Icon icon={Plus} size={14} /> New project
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => useUi.getState().openFolderBrowser()}>
                                <Icon icon={FolderOpen} size={14} /> Open folder
                            </Menu.Item>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>

            <ProjectNameDialog
                open={newOpen}
                onOpenChange={setNewOpen}
                title="New project"
                description="Stored in the app, not in a folder. To share a project through git, open a folder instead."
                action="Create"
                fallback="Untitled project"
                onSubmit={async (name) => {
                    await createProjectOn(machineId, name);
                }}
            />
        </>
    );
}

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { Menu } from '@base-ui-components/react/menu';
import { ChevronDown, ChevronRight, ExternalLink, FolderOpen, History, MoreHorizontal, Plus, Settings2, X } from 'lucide-react';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { projectClient } from '@/project';
import { menuProjects, type ProjectMenuRow } from '@/project/list';
import { closeProject, createProjectOn, openProject } from '@/project/open';
import { closeWarning, sessionNodesOf } from '@/project/project-sessions';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { setProjectFolderIcon, setProjectIdentity, uploadProjectIcon, type ProjectSettingsResult } from '@/project/settings';
import { ProjectSettingsDialog } from '@/shell/ProjectSettingsDialog';
import { ProjectNameDialog } from '@/shell/ProjectNameDialog';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { useProjectList } from '@/state/project-list';
import { useProject } from '@/state/project';
import { fileManagerName, useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';
import { useMachineHold, useOpenEndpoints } from '@/transport/status';
import { MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

interface ProjectRowProps {
    row: ProjectMenuRow;
    /* One machine needs no naming; the label only earns its place in the row once there are two. */
    showMachine: boolean;
    actions?: {
        platform: string | null;
        onSettings(): void;
        onClose(): void;
    };
}

/* One project in the switcher. The folder is what the tooltip says, so the row stays a single line. */
function ProjectRow({ row, showMachine, actions }: ProjectRowProps) {
    const { summary } = row;
    const tooltip = (
        <span className="flex flex-col items-start">
            <span>{summary.folder ?? 'Not in a folder'}</span>
            {/* Not connected is about the machine, unavailable about the folder; a row can be either. */}
            {!row.connected && <span className="text-text-muted">Not connected</span>}
            {!summary.available && <span className="text-text-muted">That folder is gone</span>}
        </span>
    );

    const project = (
        <Menu.Item
            className={clsx('menu-item min-w-0 flex-1', (!summary.available || !row.connected) && 'opacity-50')}
            disabled={!summary.available}
            onClick={() => void openProject(row.endpointId, summary.projectId).catch(() => undefined)}
        >
            <ProjectGlyph projectId={summary.projectId} endpointId={row.endpointId} icon={summary.icon} color={summary.color} />
            <span className="min-w-0 truncate">{summary.name}</span>
            {showMachine && <span className="ml-auto pl-3 truncate text-xs text-text-faint">{row.machineLabel}</span>}
        </Menu.Item>
    );

    if (!actions) {
        return (
            <Tooltip label={tooltip} side="right">
                {project}
            </Tooltip>
        );
    }

    const reveal = async (): Promise<void> => {
        if (!summary.folder) {
            return;
        }
        await transportFor(row.endpointId)
            ?.request('fs.reveal', { path: summary.folder })
            .catch(() => undefined);
    };

    return (
        <div className="project-menu-row flex min-w-0 items-stretch" role="group">
            <Tooltip label={tooltip} side="right" sideOffset={41}>
                {project}
            </Tooltip>
            <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger
                    className="menu-item project-menu-actions shrink-0"
                    aria-label={`Actions for ${summary.name}`}
                    label={`Actions for ${summary.name}`}
                >
                    <Icon icon={MoreHorizontal} size={14} />
                </Menu.SubmenuTrigger>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" sideOffset={4} alignOffset={-4}>
                        <Menu.Popup className="menu-popup min-w-52">
                            {summary.folder && (
                                <Menu.Item className="menu-item" onClick={() => void reveal()}>
                                    <Icon icon={ExternalLink} size={14} /> Open in {fileManagerName(actions.platform)}
                                </Menu.Item>
                            )}
                            <Menu.Item className="menu-item" onClick={actions.onSettings}>
                                <Icon icon={Settings2} size={14} /> Project settings…
                            </Menu.Item>
                            <Menu.Separator className={MENU_SEPARATOR} />
                            <Menu.Item className="menu-item" onClick={actions.onClose}>
                                <Icon icon={X} size={14} /> Close project
                            </Menu.Item>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.SubmenuRoot>
        </div>
    );
}

/* The project segment of the toolbar's breadcrumb: projects to switch to, their actions, and the
   two ways to bring in one that is not listed yet. */
export function ProjectMenu() {
    const rows = useProjectList((s) => s.projects);
    const current = useProject((s) => s.current);
    const currentEndpointId = useProject((s) => s.currentEndpointId);
    const stored = useEndpoints((s) => s.endpoints);
    const endpoints = useMemo(() => listedEndpoints(stored), [stored]);
    const activeId = useEndpoints((s) => s.activeId);
    const connected = useOpenEndpoints();
    const [newOpen, setNewOpen] = useState(false);
    const [settingsTarget, setSettingsTarget] = useState<ProjectMenuRow | null>(null);
    const [closing, setClosing] = useState<{ name: string; sessions: number } | null>(null);
    const { open, recent } = useMemo(() => menuProjects(rows, endpoints, connected), [rows, endpoints, connected]);
    const showMachine = endpoints.length > 1;
    const machineId = currentEndpointId ?? activeId;
    const machine = machineId === LOCAL_ENDPOINT_ID ? null : (endpoints.find((endpoint) => endpoint.id === machineId) ?? null);
    const servers = useServers((s) => s.byEndpoint);
    const machineIcon = servers[machineId]?.icon ?? null;

    const isCurrent = (row: ProjectMenuRow): boolean => row.summary.projectId === current?.projectId && row.endpointId === currentEndpointId;
    const settingsIsCurrent = settingsTarget !== null && isCurrent(settingsTarget);
    const settingsProject =
        settingsTarget === null
            ? null
            : settingsIsCurrent
              ? current
              : (rows.find((row) => row.endpointId === settingsTarget.endpointId && row.summary.projectId === settingsTarget.summary.projectId)?.summary ??
                settingsTarget.summary);
    const settingsEndpoint = settingsTarget === null ? null : (endpoints.find((endpoint) => endpoint.id === settingsTarget.endpointId) ?? null);
    useMachineHold(settingsEndpoint);

    const activate = async (row: ProjectMenuRow): Promise<boolean> => {
        if (isCurrent(row)) {
            return true;
        }
        return (await openProject(row.endpointId, row.summary.projectId)) === 'done';
    };

    const rememberSettings = (result: ProjectSettingsResult): void => {
        setSettingsTarget((target) =>
            target?.summary.projectId === result.summary.projectId ? { ...target, endpointId: result.endpointId, summary: result.summary } : target
        );
    };

    const askClose = async (row: ProjectMenuRow): Promise<void> => {
        if (!(await activate(row))) {
            return;
        }
        const active = useProject.getState().current;
        setClosing({ name: active?.name ?? row.summary.name, sessions: sessionNodesOf(useDocument.getState().exportViews()).length });
    };

    const close = async (): Promise<void> => {
        setClosing(null);
        await closeProject();
    };

    return (
        <>
            <Menu.Root>
                <Menu.Trigger className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-surface-hover data-[popup-open]:bg-surface-active">
                    {machine && (
                        <Tooltip label={machine.label}>
                            <span className="flex shrink-0 items-center">
                                <MachineGlyph icon={machineIcon} size={14} className="text-text-muted" />
                            </span>
                        </Tooltip>
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
                                <ProjectRow
                                    key={`${row.endpointId}:${row.summary.projectId}`}
                                    row={row}
                                    showMachine={showMachine}
                                    actions={{
                                        platform: servers[row.endpointId]?.platform ?? null,
                                        onSettings: () => setSettingsTarget(row),
                                        onClose: () => void askClose(row)
                                    }}
                                />
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
                                                        <ProjectRow key={`${row.endpointId}:${row.summary.projectId}`} row={row} showMachine={showMachine} />
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

            {settingsTarget && settingsProject && (
                <ProjectSettingsDialog
                    project={settingsProject}
                    endpointId={settingsTarget.endpointId}
                    open
                    onOpenChange={(open) => !open && setSettingsTarget(null)}
                    actions={{
                        rename: async (name) => {
                            if (settingsIsCurrent) {
                                await projectClient.rename(name);
                                return;
                            }
                            rememberSettings(await setProjectIdentity(settingsTarget.endpointId, settingsTarget.summary.projectId, { name }));
                        },
                        setChosenIcon: async (icon) => {
                            if (settingsIsCurrent) {
                                await projectClient.setChosenIcon(icon);
                                return;
                            }
                            rememberSettings(await setProjectIdentity(settingsTarget.endpointId, settingsTarget.summary.projectId, { icon }));
                        },
                        uploadIcon: async (mime, base64) => {
                            if (settingsIsCurrent) {
                                await projectClient.uploadIcon(mime, base64);
                                return;
                            }
                            rememberSettings(await uploadProjectIcon(settingsTarget.endpointId, settingsTarget.summary.projectId, mime, base64));
                        },
                        useFolderIcon: async () => {
                            if (settingsIsCurrent) {
                                await projectClient.useFolderIcon();
                                return;
                            }
                            rememberSettings(await setProjectFolderIcon(settingsTarget.endpointId, settingsTarget.summary.projectId));
                        }
                    }}
                />
            )}

            <Dialog.Root open={closing !== null} onOpenChange={(next) => !next && setClosing(null)}>
                <Dialog.Portal>
                    <Dialog.Backdrop className="dialog-backdrop" />
                    <Dialog.Popup className="dialog-popup w-[420px] p-5">
                        <Dialog.Title className="text-base font-semibold text-text">Close {closing?.name}?</Dialog.Title>
                        <p className="mt-1 text-xs text-text-muted">{closeWarning(closing?.sessions ?? 0)}</p>
                        <div className="mt-4 flex items-center justify-end gap-2">
                            <Button onClick={() => setClosing(null)}>Cancel</Button>
                            <Button variant={closing?.sessions === 0 ? 'primary' : 'danger'} onClick={() => void close()}>
                                <Icon icon={X} size={12} /> Close
                            </Button>
                        </div>
                    </Dialog.Popup>
                </Dialog.Portal>
            </Dialog.Root>
        </>
    );
}

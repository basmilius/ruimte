import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { ChevronDown, ChevronRight, ExternalLink, FolderOpen, History, MoreHorizontal, Settings2, X } from 'lucide-react';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { projectClient } from '@/project';
import { menuProjects, openableRows, type ProjectMenuRow } from '@/project/list';
import { closeProjectOn, closingProject, openProject } from '@/project/open';
import { closeWarning, sessionNodesOf } from '@/project/project-sessions';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { setProjectFolderIcon, setProjectIdentity, uploadProjectIcon, type ProjectSettingsResult } from '@/project/settings';
import { ProjectSettingsDialog, type ProjectSettingsSubject } from '@/shell/ProjectSettingsDialog';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { useProjectList } from '@/state/project-list';
import { useProject } from '@/state/project';
import { fileManagerName, useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';
import { useMachineHold, useOpenEndpoints } from '@/transport/status';
import { MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { PromptDialog } from '@/ui/PromptDialog';
import { MenuPopup } from '@/ui/MenuPopup';

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
    const { t } = useTranslation('shell');
    const { summary } = row;
    const tooltip = (
        <span className="flex flex-col items-start">
            <span>{summary.folder}</span>
            {/* Not connected is about the machine, unavailable about the folder; a row can be either. */}
            {!row.connected && <span className="text-text-muted">{t('connection.noLink')}</span>}
            {!summary.available && <span className="text-text-muted">{t('projectMenu.folderGone')}</span>}
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
                    aria-label={t('projectMenu.actionsFor', { name: summary.name })}
                    label={t('projectMenu.actionsFor', { name: summary.name })}
                >
                    <Icon icon={MoreHorizontal} size={14} />
                </Menu.SubmenuTrigger>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" sideOffset={4} alignOffset={-4}>
                        <Menu.Popup className="menu-popup min-w-52">
                            {summary.folder && (
                                <Menu.Item className="menu-item" onClick={() => void reveal()}>
                                    <Icon icon={ExternalLink} size={14} /> {t('projectMenu.openIn', { app: fileManagerName(actions.platform) })}
                                </Menu.Item>
                            )}
                            <Menu.Item className="menu-item" onClick={actions.onSettings}>
                                <Icon icon={Settings2} size={14} /> {t('projectMenu.projectSettings')}
                            </Menu.Item>
                            <Menu.Separator className={MENU_SEPARATOR} />
                            <Menu.Item className="menu-item" onClick={actions.onClose}>
                                <Icon icon={X} size={14} /> {t('projectMenu.closeProject')}
                            </Menu.Item>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.SubmenuRoot>
        </div>
    );
}

/* The project segment of the toolbar's breadcrumb: projects to switch to, their actions, and opening a folder. */
export function ProjectMenu() {
    const { t } = useTranslation(['shell', 'common']);
    const rows = useProjectList((s) => s.projects);
    const current = useProject((s) => s.current);
    const currentEndpointId = useProject((s) => s.currentEndpointId);
    const stored = useEndpoints((s) => s.endpoints);
    const endpoints = useMemo(() => listedEndpoints(stored), [stored]);
    const activeId = useEndpoints((s) => s.activeId);
    const connected = useOpenEndpoints();
    const [settingsTarget, setSettingsTarget] = useState<ProjectMenuRow | null>(null);
    /* Apart from the target, which outlives it: the dialog closes first and is emptied afterwards. */
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [closing, setClosing] = useState<{ row: ProjectMenuRow; name: string; sessions: number; otherClients: number } | null>(null);
    const currentKey = current !== null && currentEndpointId !== null ? `${currentEndpointId}:${current.projectId}` : null;
    const { open, recent } = useMemo(() => {
        const lists = menuProjects(rows, endpoints, connected);
        return { open: openableRows(lists.open, currentKey), recent: openableRows(lists.recent, currentKey) };
    }, [rows, endpoints, connected, currentKey]);
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

    const openSettings = (row: ProjectMenuRow): void => {
        setSettingsTarget(row);
        setSettingsOpen(true);
    };

    const rememberSettings = (result: ProjectSettingsResult): void => {
        setSettingsTarget((target) =>
            target?.summary.projectId === result.summary.projectId ? { ...target, endpointId: result.endpointId, summary: result.summary } : target
        );
    };

    const settingsSubject: ProjectSettingsSubject | null =
        settingsTarget === null || settingsProject === null
            ? null
            : {
                  project: settingsProject,
                  endpointId: settingsTarget.endpointId,
                  actions: {
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
                  }
              };

    /* Only the project on screen has a document here to count; every other row is the machine's to answer. */
    const askClose = async (row: ProjectMenuRow): Promise<void> => {
        const here = isCurrent(row);
        const local = here ? sessionNodesOf(useDocument.getState().exportViews()).length : null;
        const answer = await closingProject(row.endpointId, row.summary, local);
        if (answer === null) {
            // A machine out of reach has nothing to say about it; the row goes here and that is all.
            await closeProjectOn(row.endpointId, row.summary);
            return;
        }
        setClosing({ row, name: (here ? current?.name : null) ?? row.summary.name, ...answer });
    };

    const close = async (): Promise<void> => {
        const target = closing;
        setClosing(null);
        if (target) {
            await closeProjectOn(target.row.endpointId, target.row.summary);
        }
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
                <MenuPopup className="min-w-60">
                    {open.map((row) => (
                        <ProjectRow
                            key={`${row.endpointId}:${row.summary.projectId}`}
                            row={row}
                            showMachine={showMachine}
                            actions={{
                                platform: servers[row.endpointId]?.platform ?? null,
                                onSettings: () => openSettings(row),
                                onClose: () => void askClose(row)
                            }}
                        />
                    ))}
                    {recent.length > 0 && (
                        <>
                            {open.length > 0 && <Menu.Separator className={MENU_SEPARATOR} />}
                            <Menu.SubmenuRoot>
                                <Menu.SubmenuTrigger className="menu-item">
                                    <Icon icon={History} size={14} /> {t('projectMenu.recent')}
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
                    <Menu.Item className="menu-item" onClick={() => useUi.getState().openFolderBrowser()}>
                        <Icon icon={FolderOpen} size={14} /> {t('projectMenu.openFolder')}
                    </Menu.Item>
                </MenuPopup>
            </Menu.Root>

            <ProjectSettingsDialog
                subject={settingsSubject}
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                onOpenChangeComplete={(open) => !open && setSettingsTarget(null)}
            />

            <PromptDialog
                open={closing !== null}
                title={t('projectMenu.closeTitle', { name: closing?.name ?? '' })}
                description={closeWarning(closing?.sessions ?? 0, closing?.otherClients ?? 0)}
                confirmLabel={t('common:action.close')}
                confirmIcon={X}
                danger={closing !== null && closing.otherClients === 0 && closing.sessions > 0}
                onConfirm={() => void close()}
                onClose={() => setClosing(null)}
            />
        </>
    );
}

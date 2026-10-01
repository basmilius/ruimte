import { useEffect, useMemo, useState } from 'react';
import type { ActionInput } from '@ruimte/actions';
import { useTranslation } from 'react-i18next';
import { AppWindow, ExternalLink, FolderOpen, MessageSquarePlus, Settings2, X } from 'lucide-react';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { chatsProjects, menuProjects, openableRows, type ProjectMenuRow } from '@/project/list';
import { newChat, useOffersNewChat } from '@/project/new-chat';
import { openProjectClickAction, performAsPerson, runAsPerson } from '@/actions/client-actions';
import { closingProject } from '@/project/open';
import { canOpenWindows, moveToNewWindow, openInNewWindow } from '@/project/windows';
import { closeWarning, sessionNodesOf } from '@/project/project-sessions';
import { ProjectGlyph } from '@/project/ProjectGlyph';
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
import { Icon, Tooltip, PromptDialog, Menu, ProjectSwitcher, type ProjectSwitcherItem } from '@basmilius/desktop-ui';

interface SwitcherItem extends ProjectSwitcherItem {
    row: ProjectMenuRow;
}

function ProjectActions({
    row,
    platform,
    current,
    onSettings,
    onClose
}: {
    row: ProjectMenuRow;
    platform: string | null;
    current: boolean;
    onSettings(): void;
    onClose(): void;
}) {
    const { t } = useTranslation('shell');
    const { summary } = row;

    const reveal = async (): Promise<void> => {
        if (!summary.folder) {
            return;
        }
        await transportFor(row.endpointId)
            ?.request('fs.reveal', { path: summary.folder })
            .catch(() => undefined);
    };

    return (
        <>
            {summary.folder && (
                <Menu.Item onClick={() => void reveal()}>
                    <Icon icon={ExternalLink} size={14} /> {t('projectMenu.openIn', { app: fileManagerName(platform) })}
                </Menu.Item>
            )}
            {canOpenWindows() && (
                <Menu.Item
                    disabled={!current && !summary.available}
                    onClick={() => (current ? void moveToNewWindow() : openInNewWindow(row.endpointId, summary.projectId))}
                >
                    <Icon icon={AppWindow} size={14} /> {t(current ? 'projectMenu.moveToNewWindow' : 'projectMenu.openInNewWindow')}
                </Menu.Item>
            )}
            <Menu.Item onClick={onSettings}>
                <Icon icon={Settings2} size={14} /> {t('projectMenu.projectSettings')}
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item onClick={onClose}>
                <Icon icon={X} size={14} /> {t('projectMenu.closeProject')}
            </Menu.Item>
        </>
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
    const chats = useMemo(
        () => chatsProjects(rows, endpoints, connected).find((row) => row.endpointId === machineId && row.summary.available) ?? null,
        [rows, endpoints, connected, machineId]
    );
    const offersChat = useOffersNewChat();
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

    // The application menu asks for the settings of the project that is open.
    useEffect(
        () =>
            useUi.subscribe((state) => {
                if (!state.projectSettingsAsked) {
                    return;
                }
                useUi.getState().askProjectSettings(false);
                const { current: project, currentEndpointId: endpointId } = useProject.getState();
                const row = useProjectList
                    .getState()
                    .projects.find((candidate) => candidate.endpointId === endpointId && candidate.summary.projectId === project?.projectId);
                if (row) {
                    setSettingsTarget({ endpointId: row.endpointId, machineLabel: '', connected: true, summary: row.summary });
                    setSettingsOpen(true);
                }
            }),
        []
    );

    const appearance = async (change: Partial<Pick<ActionInput<'project.setAppearance'>, 'name' | 'icon' | 'image'>>): Promise<void> => {
        if (settingsTarget === null) {
            return;
        }
        const done = await performAsPerson('project.setAppearance', {
            endpointId: settingsTarget.endpointId,
            projectId: settingsTarget.summary.projectId,
            name: change.name ?? null,
            icon: change.icon ?? null,
            image: change.image ?? null
        });
        const row = useProjectList
            .getState()
            .projects.find((candidate) => candidate.endpointId === done.endpointId && candidate.summary.projectId === done.projectId);
        setSettingsTarget((target) =>
            target?.summary.projectId === done.projectId ? { ...target, endpointId: done.endpointId, summary: row?.summary ?? target.summary } : target
        );
    };

    const settingsSubject: ProjectSettingsSubject | null =
        settingsTarget === null || settingsProject === null
            ? null
            : {
                  project: settingsProject,
                  endpointId: settingsTarget.endpointId,
                  actions: {
                      rename: (name) => appearance({ name }),
                      setChosenIcon: (icon) => appearance({ icon: icon.value }),
                      uploadIcon: (mime, base64) => appearance({ image: { mime, base64 } }),
                      useFolderIcon: () => appearance({ icon: 'folder' })
                  }
              };

    /* Only the project on screen has a document here to count; every other row is the machine's to answer. */
    const askClose = async (row: ProjectMenuRow): Promise<void> => {
        const here = isCurrent(row);
        const local = here ? sessionNodesOf(useDocument.getState().exportViews()).length : null;
        const answer = await closingProject(row.endpointId, row.summary, local);
        if (answer === null) {
            // A machine out of reach has nothing to say about it; the row goes here and that is all.
            await runAsPerson('project.close', { endpointId: row.endpointId, projectId: row.summary.projectId });
            return;
        }
        setClosing({ row, name: (here ? current?.name : null) ?? row.summary.name, ...answer });
    };

    const close = async (): Promise<void> => {
        const target = closing;
        setClosing(null);
        if (target) {
            await runAsPerson('project.close', { endpointId: target.row.endpointId, projectId: target.row.summary.projectId });
        }
    };

    const switcherItem = (row: ProjectMenuRow, withActions: boolean): SwitcherItem => ({
        id: `${row.endpointId}:${row.summary.projectId}`,
        name: row.summary.name,
        icon: <ProjectGlyph projectId={row.summary.projectId} endpointId={row.endpointId} icon={row.summary.icon} color={row.summary.color} />,
        description: (
            <span className="flex flex-col items-start">
                <span>{row.summary.folder}</span>
                {/* Not connected is about the machine, unavailable about the folder; a row can be either. */}
                {!row.connected && <span className="text-text-muted">{t('connection.noLink')}</span>}
                {!row.summary.available && <span className="text-text-muted">{t('projectMenu.folderGone')}</span>}
            </span>
        ),
        hint: showMachine ? row.machineLabel : undefined,
        disabled: !row.summary.available,
        muted: !row.connected,
        actions: withActions ? (
            <ProjectActions
                row={row}
                platform={servers[row.endpointId]?.platform ?? null}
                current={isCurrent(row)}
                onSettings={() => openSettings(row)}
                onClose={() => void askClose(row)}
            />
        ) : undefined,
        row
    });

    return (
        <>
            <ProjectSwitcher
                current={
                    current === null
                        ? null
                        : {
                              id: `${currentEndpointId}:${current.projectId}`,
                              name: current.scratch === true ? t('chats.name') : current.name,
                              icon: (
                                  <ProjectGlyph
                                      projectId={current.projectId}
                                      endpointId={currentEndpointId ?? undefined}
                                      icon={current.icon}
                                      color={current.color}
                                      scratch={current.scratch === true}
                                  />
                              )
                          }
                }
                projects={open.map((row) => switcherItem(row, true))}
                recentProjects={recent.map((row) => switcherItem(row, false))}
                onSelect={({ row }, event) => openProjectClickAction(event, row.endpointId, row.summary.projectId)}
                leading={
                    machine && (
                        <Tooltip label={machine.label}>
                            <span className="flex shrink-0 items-center">
                                <MachineGlyph icon={machineIcon} size={14} className="text-text-muted" />
                            </span>
                        </Tooltip>
                    )
                }
            >
                {/* todo(Bas): one row Chats above Recent with New chat as its trailing button, and Recent and
                    Open folder in one group, once ProjectSwitcher can draw that (basmilius/desktop#22, #23). */}
                {chats !== null && (
                    <Menu.Item onClick={(event) => openProjectClickAction(event, chats.endpointId, chats.summary.projectId)}>
                        <ProjectGlyph
                            projectId={chats.summary.projectId}
                            endpointId={chats.endpointId}
                            icon={chats.summary.icon}
                            color={chats.summary.color}
                            size={14}
                            scratch
                        />{' '}
                        {t('chats.name')}
                    </Menu.Item>
                )}
                {offersChat && (
                    <Menu.Item onClick={newChat}>
                        <Icon icon={MessageSquarePlus} size={14} /> {t('chats.newChat')}
                    </Menu.Item>
                )}
                {(chats !== null || offersChat) && <Menu.Separator />}
                <Menu.Item onClick={() => useUi.getState().openFolderBrowser()}>
                    <Icon icon={FolderOpen} size={14} /> {t('projectMenu.openFolder')}
                </Menu.Item>
            </ProjectSwitcher>

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
                onOpenChange={() => setClosing(null)}
            />
        </>
    );
}

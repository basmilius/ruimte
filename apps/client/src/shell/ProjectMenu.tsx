import { useEffect, useMemo, useState } from 'react';
import type { ActionInput } from '@ruimte/actions';
import { useTranslation } from 'react-i18next';
import { AppWindow, ExternalLink, FolderOpen, MessageSquarePlus, Plus, Settings2, X } from 'lucide-react';
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
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { useProjectList } from '@/state/project-list';
import { useProject } from '@/state/project';
import { fileManagerName, useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';
import { useMachineHold, useOpenEndpoints } from '@/transport/status';
import { Icon, Tooltip, PromptDialog, Menu, ProjectSwitcher, type ProjectSwitcherItem } from '@adecore/ui';

interface SwitcherItem extends ProjectSwitcherItem {
    row: ProjectMenuRow;
}

/* What a row offers for its folder and its window; a recent project offers only these. */
function ProjectPlaceActions({ row, platform, current }: { row: ProjectMenuRow; platform: string | null; current: boolean }) {
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
        </>
    );
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

    return (
        <>
            <ProjectPlaceActions row={row} platform={platform} current={current} />
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

/*
 * The Chats project of this machine, with a new chat on the edge where a project row has its actions.
 * A machine that has made no chat yet has no Chats project to open, so it only offers the new chat.
 */
function ChatsRow({ chats, offersChat }: { chats: ProjectMenuRow | null; offersChat: boolean }) {
    const { t } = useTranslation('shell');

    if (chats === null) {
        return (
            <Menu.Item onClick={newChat}>
                <Icon icon={MessageSquarePlus} size={14} /> {t('chats.newChat')}
            </Menu.Item>
        );
    }
    const open = (
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
    );
    if (!offersChat) {
        return open;
    }
    return (
        <Menu.Row aria-label={t('chats.name')}>
            {open}
            <Menu.RowAction icon={Plus} label={t('chats.newChat')} onClick={newChat} />
        </Menu.Row>
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
    const settings = useProjectSettings(endpoints, isCurrent);

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

    const switcherItem = (row: ProjectMenuRow, recent: boolean): SwitcherItem => ({
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
        actions: recent ? (
            <ProjectPlaceActions row={row} platform={servers[row.endpointId]?.platform ?? null} current={false} />
        ) : (
            <ProjectActions
                row={row}
                platform={servers[row.endpointId]?.platform ?? null}
                current={isCurrent(row)}
                onSettings={() => settings.openFor(row)}
                onClose={() => void askClose(row)}
            />
        ),
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
                projects={open.map((row) => switcherItem(row, false))}
                recentProjects={recent.map((row) => switcherItem(row, true))}
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
                before={chats !== null || offersChat ? <ChatsRow chats={chats} offersChat={offersChat} /> : undefined}
            >
                <Menu.Item onClick={() => useUi.getState().openFolderBrowser()}>
                    <Icon icon={FolderOpen} size={14} /> {t('projectMenu.openFolder')}
                </Menu.Item>
            </ProjectSwitcher>

            <ProjectSettingsDialog
                subject={settings.subject}
                open={settings.open}
                onOpenChange={settings.setOpen}
                onOpenChangeComplete={(open) => !open && settings.clear()}
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

/* The settings dialog of one row of the menu, or of the open project when the application menu asks for it. */
function useProjectSettings(endpoints: readonly Endpoint[], isCurrent: (row: ProjectMenuRow) => boolean) {
    const rows = useProjectList((s) => s.projects);
    const current = useProject((s) => s.current);
    const [target, setTarget] = useState<ProjectMenuRow | null>(null);
    /* Apart from the target, which outlives it: the dialog closes first and is emptied afterwards. */
    const [open, setOpen] = useState(false);
    const project =
        target === null
            ? null
            : isCurrent(target)
              ? current
              : (rows.find((row) => row.endpointId === target.endpointId && row.summary.projectId === target.summary.projectId)?.summary ?? target.summary);
    useMachineHold(target === null ? null : (endpoints.find((endpoint) => endpoint.id === target.endpointId) ?? null));

    const openFor = (row: ProjectMenuRow): void => {
        setTarget(row);
        setOpen(true);
    };

    // The application menu asks for the settings of the project that is open.
    useEffect(
        () =>
            useUi.subscribe((state) => {
                if (!state.projectSettingsAsked) {
                    return;
                }
                useUi.getState().askProjectSettings(false);
                const { current: shown, currentEndpointId: endpointId } = useProject.getState();
                const row = useProjectList
                    .getState()
                    .projects.find((candidate) => candidate.endpointId === endpointId && candidate.summary.projectId === shown?.projectId);
                if (row) {
                    openFor({ endpointId: row.endpointId, machineLabel: '', connected: true, summary: row.summary });
                }
            }),
        []
    );

    const appearance = async (change: Partial<Pick<ActionInput<'project.setAppearance'>, 'name' | 'icon' | 'image'>>): Promise<void> => {
        if (target === null) {
            return;
        }
        const done = await performAsPerson('project.setAppearance', {
            endpointId: target.endpointId,
            projectId: target.summary.projectId,
            name: change.name ?? null,
            icon: change.icon ?? null,
            image: change.image ?? null
        });
        const row = useProjectList
            .getState()
            .projects.find((candidate) => candidate.endpointId === done.endpointId && candidate.summary.projectId === done.projectId);
        setTarget((previous) =>
            previous?.summary.projectId === done.projectId ? { ...previous, endpointId: done.endpointId, summary: row?.summary ?? previous.summary } : previous
        );
    };

    const subject: ProjectSettingsSubject | null =
        target === null || project === null
            ? null
            : {
                  project,
                  endpointId: target.endpointId,
                  actions: {
                      rename: (name) => appearance({ name }),
                      setChosenIcon: (icon) => appearance({ icon: icon.value }),
                      uploadIcon: (mime, base64) => appearance({ image: { mime, base64 } }),
                      useFolderIcon: () => appearance({ icon: 'folder' })
                  }
              };

    return { subject, open, setOpen, openFor, clear: () => setTarget(null) };
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ActionInput } from '@ruimte/actions';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { chatsProjects, menuProjects, openableRows, type ProjectMenuRow } from '@/project/list';
import { useOffersNewChat } from '@/project/new-chat';
import { ignoreRefusal, perform } from '@/actions/client-actions';
import { closingProject } from '@/project/open';
import { closeWarning, sessionNodesOf } from '@/project/project-sessions';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { ProjectSettingsDialog, type ProjectSettingsSubject } from '@/shell/ProjectSettingsDialog';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { useProjectList } from '@/state/project-list';
import { useProject } from '@/state/project';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { useMachineHold, useOpenEndpoints } from '@/transport/status';
import { ProjectActions, ProjectPlaceActions } from '@/shell/ProjectActions';
import { PromptDialog, type ProjectSwitcherItem } from '@adecore/ui';

export interface SwitcherItem extends ProjectSwitcherItem {
    row: ProjectMenuRow;
}

/*
 * What the switcher and the tabs share: the rows to offer, a row's actions, and the two dialogs that
 * settle a project's settings and closing. `dialogs` goes in the tree of whichever draws the rows.
 */
export function useProjectMenu() {
    const { t } = useTranslation(['shell', 'common']);
    const rows = useProjectList((s) => s.projects);
    const current = useProject((s) => s.current);
    const currentEndpointId = useProject((s) => s.currentEndpointId);
    const stored = useEndpoints((s) => s.endpoints);
    const endpoints = listedEndpoints(stored);
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
    const chats = chatsProjects(rows, endpoints, connected).find((row) => row.endpointId === machineId && row.summary.available) ?? null;
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
            await perform('project.close', { endpointId: row.endpointId, projectId: row.summary.projectId }).catch(ignoreRefusal);
            return;
        }
        setClosing({ row, name: (here ? current?.name : null) ?? row.summary.name, ...answer });
    };

    const close = async (): Promise<void> => {
        const target = closing;
        setClosing(null);
        if (target) {
            await perform('project.close', { endpointId: target.row.endpointId, projectId: target.row.summary.projectId }).catch(ignoreRefusal);
        }
    };

    /* `leading` is what only the place that draws the menu offers, such as the pin of a tab. The Chats project has no settings and never closes. */
    const actionsOf = (row: ProjectMenuRow, leading?: ReactNode): ReactNode => (
        <ProjectActions
            row={row}
            platform={servers[row.endpointId]?.platform ?? null}
            current={isCurrent(row)}
            leading={leading}
            {...(row.summary.scratch === true ? {} : { onSettings: () => settings.openFor(row), onClose: () => void askClose(row) })}
        />
    );

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
        actions: recent ? <ProjectPlaceActions row={row} platform={servers[row.endpointId]?.platform ?? null} current={false} /> : actionsOf(row),
        row
    });

    const dialogs = (
        <>
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

    return {
        current,
        currentEndpointId,
        machine,
        machineIcon,
        chats,
        offersChat,
        projects: open.map((row) => switcherItem(row, false)),
        recentProjects: recent.map((row) => switcherItem(row, true)),
        actionsOf,
        askClose,
        dialogs
    };
}

export type ProjectMenuModel = ReturnType<typeof useProjectMenu>;

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
            useUi.subscribe(() => {
                // Read now and not off the change: another menu on screen may have answered the ask already.
                if (!useUi.getState().projectSettingsAsked) {
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

    const appearance = async (change: Partial<Pick<ActionInput<'project.setAppearance'>, 'name' | 'icon' | 'image' | 'color'>>): Promise<void> => {
        if (target === null) {
            return;
        }
        const done = await perform('project.setAppearance', {
            endpointId: target.endpointId,
            projectId: target.summary.projectId,
            name: change.name ?? null,
            icon: change.icon ?? null,
            image: change.image ?? null,
            color: change.color ?? null
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
                      setColor: (color) => appearance({ color }),
                      setChosenIcon: (icon) => appearance({ icon: icon.value }),
                      uploadIcon: (mime, base64) => appearance({ image: { mime, base64 } }),
                      useFolderIcon: () => appearance({ icon: 'folder' })
                  }
              };

    return { subject, open, setOpen, openFor, clear: () => setTarget(null) };
}

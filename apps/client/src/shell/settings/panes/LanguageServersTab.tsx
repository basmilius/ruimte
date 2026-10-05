import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CustomLanguageServer, LanguageServerStatus } from '@ruimte/contracts';
import { Button, Icon, PromptDialog, Spinner } from '@basmilius/desktop-ui';
import { SettingsRow } from '@basmilius/desktop-ui/settings';
import { CustomServerDialog } from '@/language/CustomServerDialog';
import { draftOf, emptyDraft, type CustomDraft } from '@/language/custom-draft';
import { CustomServersTracker, useCustomServers } from '@/language/custom-servers';
import { Dot, LogDialog } from '@/language/ServerParts';
import { report, serverDetail, sidecarDetails, useStatuses } from '@/language/server-status';
import { draftFiles } from '@/language/project-files';
import { acquireProjectLanguage, type ProjectLanguage } from '@/language/project-language';
import { actionsOf, groupedStatuses, isOwn, kindOf, nameOf, packageOf, toneOf } from '@/language/status-view';
import type { LanguageStatusTracker } from '@/language/status';
import { createHolder } from '@/shell/panels/use-editor-language';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useProject } from '@/state/project';
import { useWindow, workspaceOf } from '@/state/window';

/* The language side of the project this window shows, for as long as the tab is up. Null on the start screen, where no project runs a server. */
function useWindowProjectLanguage(): ProjectLanguage | null {
    const workspace = useWindow((s) => workspaceOf(s.content));
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const folder = useProject((s) => s.current?.folder ?? null);
    const [holder] = useState(() => createHolder<ProjectLanguage>());

    useEffect(() => {
        if (workspace === null || projectId === null || folder === null) {
            return;
        }
        const { transport, endpointId } = workspace.connection;
        const held = acquireProjectLanguage(transport, projectId, folder, draftFiles(endpointId, transport));
        holder.set(held.language);
        return () => {
            holder.set(null);
            held.release();
        };
    }, [workspace, projectId, folder, holder]);

    return useSyncExternalStore(holder.subscribe, holder.get);
}

/* The servers a person added on the machine of this window, for as long as the tab is up. */
function useWindowCustomServers(): { tracker: CustomServersTracker; endpointId: string } | null {
    const workspace = useWindow((s) => workspaceOf(s.content));
    const [holder] = useState(() => createHolder<{ tracker: CustomServersTracker; endpointId: string }>());

    useEffect(() => {
        if (workspace === null) {
            return;
        }
        const { transport, endpointId } = workspace.connection;
        const tracker = new CustomServersTracker(transport);
        holder.set({ tracker, endpointId });
        void tracker.refresh().catch(() => undefined);
        return () => {
            holder.set(null);
            tracker.dispose();
        };
    }, [workspace, holder]);

    return useSyncExternalStore(holder.subscribe, holder.get);
}

interface ServerRowProps {
    status: LanguageServerStatus;
    statuses: readonly LanguageServerStatus[];
    tracker: LanguageStatusTracker;
    searchId?: string;
    onLog(): void;
}

function ServerRow({ status, statuses, tracker, searchId, onLog }: ServerRowProps) {
    const { t } = useTranslation('panels');
    const kind = kindOf(status.server);
    const actions = actionsOf(status);
    const detail = serverDetail(status, t);
    const fail = (error: unknown): void => report(error, t);

    return (
        <SettingsRow
            searchId={searchId}
            leading={
                <span className="flex h-5.5 shrink-0 items-center">
                    {status.state === 'installing' ? <Spinner size={12} /> : <Dot tone={toneOf(status.state)} />}
                </span>
            }
            label={
                <>
                    {nameOf(status.server, statuses)} <span className="font-mono text-xs text-text-faint">{status.version}</span>
                </>
            }
            description={
                <>
                    {packageOf(status.server, statuses)}
                    {detail !== '' && <span className="block break-words">{detail}</span>}
                    {sidecarDetails(status, t).map((line) => (
                        <span key={line} className="block break-words">
                            {line}
                        </span>
                    ))}
                </>
            }
            control={
                <>
                    <span className="text-xs text-text-muted">{t(`language.state.${status.state}`)}</span>
                    {status.chosen === true && <span className="text-xs text-text-muted">{t('language.inUse')}</span>}
                    {kind !== null && status.chosen === false && (
                        <Button size="sm" variant="secondary" onClick={() => void tracker.prefer(kind).catch(fail)}>
                            {t('language.use')}
                        </Button>
                    )}
                    {kind !== null && actions.install && (
                        <Button size="sm" variant="secondary" onClick={() => void tracker.install(kind).catch(fail)}>
                            {t('language.install')}
                        </Button>
                    )}
                    {actions.restart && (
                        <Button size="sm" variant="secondary" onClick={() => void tracker.restart(status.server).catch(fail)}>
                            {t('language.restart')}
                        </Button>
                    )}
                    {actions.log && (
                        <Button size="sm" onClick={onLog}>
                            {t('language.showLog')}
                        </Button>
                    )}
                </>
            }
        />
    );
}

interface OwnRowProps {
    server: CustomLanguageServer;
    status: LanguageServerStatus | undefined;
    tracker: LanguageStatusTracker;
    searchId?: string;
    onLog(): void;
    onEdit(): void;
    onRemove(): void;
}

/* A server of the person's own: what it runs and serves, how it is doing in this project, and the ways to change it. */
function OwnRow({ server, status, tracker, searchId, onLog, onEdit, onRemove }: OwnRowProps) {
    const { t } = useTranslation('settings');
    const { t: tPanels } = useTranslation('panels');
    const actions = status === undefined ? null : actionsOf(status);
    const fail = (error: unknown): void => report(error, tPanels);
    const serves = [...server.languages, ...server.patterns].join(', ');
    const command = [server.command, ...server.args].join(' ');
    const detail = status === undefined || status.message === undefined ? '' : status.message;

    return (
        <SettingsRow
            searchId={searchId}
            leading={
                <span className="flex h-5.5 shrink-0 items-center">{status === undefined ? <Dot tone="idle" /> : <Dot tone={toneOf(status.state)} />}</span>
            }
            label={server.name}
            description={
                <>
                    <span className="block break-words">{t('editor.servers.own.serves', { what: serves })}</span>
                    <span className="block font-mono break-all text-text-faint">{command}</span>
                    {server.projects !== undefined && (
                        <span className="block break-words">{t('editor.servers.own.someProjects', { count: server.projects.length })}</span>
                    )}
                    {detail !== '' && <span className="block break-words">{detail}</span>}
                </>
            }
            control={
                <>
                    <span className="text-xs text-text-muted">
                        {status === undefined ? t('editor.servers.own.elsewhere') : tPanels(`language.state.${status.state}`)}
                    </span>
                    {server.held !== true && actions?.restart === true && (
                        <Button size="sm" variant="secondary" onClick={() => void tracker.restart(server.id).catch(fail)}>
                            {tPanels('language.restart')}
                        </Button>
                    )}
                    {actions?.log === true && (
                        <Button size="sm" onClick={onLog}>
                            {tPanels('language.showLog')}
                        </Button>
                    )}
                    <Button size="sm" onClick={onEdit}>
                        {t('editor.servers.own.edit')}
                    </Button>
                    <Button size="sm" variant="danger-outline" onClick={onRemove}>
                        {t('editor.servers.own.remove')}
                    </Button>
                </>
            }
        />
    );
}

function OwnServers({
    custom,
    endpointId,
    statuses,
    tracker,
    onLog
}: {
    custom: CustomServersTracker;
    endpointId: string;
    statuses: readonly LanguageServerStatus[];
    tracker: LanguageStatusTracker;
    onLog(server: string): void;
}) {
    const { t } = useTranslation('settings');
    const servers = useCustomServers(custom);
    const [dialog, setDialog] = useState<CustomDraft | null>(null);
    const [removing, setRemoving] = useState<CustomLanguageServer | null>(null);

    return (
        <>
            <SettingsSection
                title={t('editor.servers.own.title')}
                description={t('editor.servers.own.description')}
                action={
                    <Button size="sm" onClick={() => setDialog(emptyDraft())}>
                        <Icon icon={Plus} size={14} /> {t('editor.servers.own.add')}
                    </Button>
                }
            >
                {servers === null || servers.length === 0 ? (
                    <SettingsRow muted searchId="editor.servers.own" label={servers === null ? '' : t('editor.servers.own.empty')} />
                ) : (
                    servers.map((server, index) => (
                        <OwnRow
                            key={server.id}
                            server={server}
                            status={statuses.find((status) => status.server === server.id)}
                            tracker={tracker}
                            searchId={index === 0 ? 'editor.servers.own' : undefined}
                            onLog={() => onLog(server.id)}
                            onEdit={() => setDialog(draftOf(server))}
                            onRemove={() => setRemoving(server)}
                        />
                    ))
                )}
            </SettingsSection>
            <CustomServerDialog draft={dialog} endpointId={endpointId} tracker={custom} onClose={() => setDialog(null)} />
            <PromptDialog
                open={removing !== null}
                title={t('editor.servers.own.removeTitle', { name: removing?.name ?? '' })}
                description={t('editor.servers.own.removeDescription')}
                confirmLabel={t('editor.servers.own.remove')}
                danger
                onConfirm={async () => {
                    if (removing !== null) {
                        await custom.remove(removing.id);
                    }
                    setRemoving(null);
                }}
                onOpenChange={() => setRemoving(null)}
            />
        </>
    );
}

function ServerList({ language }: { language: ProjectLanguage }) {
    const { t } = useTranslation('settings');
    const tracker = language.status;
    const statuses = useStatuses(tracker);
    const own = useWindowCustomServers();
    const [logOf, setLogOf] = useState<string | null>(null);
    const groups = useMemo(() => groupedStatuses(statuses.filter((status) => !isOwn(status))), [statuses]);

    return (
        <>
            {groups.map((group, index) => (
                <SettingsSection
                    key={group.id}
                    title={t(`editor.servers.groups.${group.id}`)}
                    description={index === 0 ? t('editor.servers.description') : undefined}
                >
                    {group.statuses.map((status, row) => (
                        <ServerRow
                            key={status.server}
                            status={status}
                            statuses={statuses}
                            tracker={tracker}
                            searchId={index === 0 && row === 0 ? 'editor.servers' : undefined}
                            onLog={() => setLogOf(status.server)}
                        />
                    ))}
                </SettingsSection>
            ))}
            {own !== null && <OwnServers custom={own.tracker} endpointId={own.endpointId} statuses={statuses} tracker={tracker} onLog={setLogOf} />}
            <LogDialog server={logOf} tracker={tracker} onClose={() => setLogOf(null)} />
        </>
    );
}

/* The servers of the open project with the same actions as the status bar, so a person can install or restart one without opening a file, and the servers they added themselves. */
export function LanguageServersTab() {
    const { t } = useTranslation('settings');
    const language = useWindowProjectLanguage();

    if (language === null) {
        return (
            <SettingsSection title={t('editor.servers.title')}>
                <SettingsRow muted searchId="editor.servers" label={t('editor.servers.needsProject')} />
            </SettingsSection>
        );
    }
    return <ServerList language={language} />;
}

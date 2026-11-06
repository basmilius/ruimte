import { createHolder } from '@adecore/editor-react';
import { Button, Icon, PromptDialog, Spinner } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import type { CustomLanguageServer, LanguageServerStatus } from '@ruimte/contracts';
import { Plus } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { draftOf, emptyDraft, type CustomDraft } from '@/language/custom-draft';
import { CustomServersTracker, useCustomServers } from '@/language/custom-servers';
import { CustomServerDialog } from '@/language/CustomServerDialog';
import type { RuimteProject } from '@/language/ruimte-project';
import { report, serverDetail, sidecarDetails, useStatuses } from '@/language/server-status';
import { Dot, LogDialog, ServerActionButtons } from '@/language/ServerParts';
import type { LanguageStatusTracker } from '@/language/status';
import { actionsOf, groupedStatuses, isOwn, kindOf, nameOf, packageOf, toneOf } from '@/language/status-view';
import { useWindowProject } from '@/language/window-project';
import { SettingsSection } from '@/machines/SettingsSection';
import { useWindow, workspaceOf } from '@/workspace/window';

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
                    <ServerActionButtons status={status} tracker={tracker} size="sm" stepBack={actions.rollback} onLog={onLog} />
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
    const detail = status?.message ?? '';

    return (
        <SettingsRow
            searchId={searchId}
            leading={
                <span className="flex h-5.5 shrink-0 items-center">
                    <Dot tone={status === undefined ? 'idle' : toneOf(status.state)} />
                </span>
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

function ServerList({ project }: { project: RuimteProject }) {
    const { t } = useTranslation('settings');
    const tracker = project.status;
    const statuses = useStatuses(tracker);
    const own = useWindowCustomServers();
    const [logOf, setLogOf] = useState<string | null>(null);
    const groups = groupedStatuses(statuses.filter((status) => !isOwn(status)));

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
    const project = useWindowProject();

    if (project === null) {
        return (
            <SettingsSection title={t('editor.servers.title')}>
                <SettingsRow muted searchId="editor.servers" label={t('editor.servers.needsProject')} />
            </SettingsSection>
        );
    }
    return <ServerList project={project} />;
}

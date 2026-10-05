import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { LanguageServerStatus } from '@ruimte/contracts';
import { Button, Spinner } from '@basmilius/desktop-ui';
import { SettingsRow } from '@basmilius/desktop-ui/settings';
import { Dot, LogDialog } from '@/language/ServerParts';
import { report, serverDetail, useStatuses } from '@/language/server-status';
import { draftFiles } from '@/language/project-files';
import { acquireProjectLanguage, type ProjectLanguage } from '@/language/project-language';
import { actionsOf, kindOf, nameOf, packageOf, toneOf } from '@/language/status-view';
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

interface ServerRowProps {
    status: LanguageServerStatus;
    tracker: LanguageStatusTracker;
    searchId?: string;
    onLog(): void;
}

function ServerRow({ status, tracker, searchId, onLog }: ServerRowProps) {
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
                    {nameOf(status.server)} <span className="font-mono text-xs text-text-faint">{status.version}</span>
                </>
            }
            description={
                <>
                    {packageOf(status.server)}
                    {detail !== '' && <span className="block break-words">{detail}</span>}
                </>
            }
            control={
                <>
                    <span className="text-xs text-text-muted">{t(`language.state.${status.state}`)}</span>
                    {kind !== null && actions.install && (
                        <Button size="sm" variant="secondary" onClick={() => void tracker.install(kind).catch(fail)}>
                            {t('language.install')}
                        </Button>
                    )}
                    {kind !== null && actions.restart && (
                        <Button size="sm" variant="secondary" onClick={() => void tracker.restart(kind).catch(fail)}>
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

function ServerList({ language }: { language: ProjectLanguage }) {
    const { t } = useTranslation('settings');
    const tracker = language.status;
    const statuses = useStatuses(tracker);
    const [logOf, setLogOf] = useState<string | null>(null);

    return (
        <>
            <SettingsSection title={t('editor.servers.title')} description={t('editor.servers.description')}>
                {statuses.map((status, index) => (
                    <ServerRow
                        key={status.server}
                        status={status}
                        tracker={tracker}
                        searchId={index === 0 ? 'editor.servers' : undefined}
                        onLog={() => setLogOf(status.server)}
                    />
                ))}
            </SettingsSection>
            <LogDialog server={logOf} tracker={tracker} onClose={() => setLogOf(null)} />
        </>
    );
}

/* The servers of the open project with the same actions as the status bar, so a person can install or restart one without opening a file. */
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

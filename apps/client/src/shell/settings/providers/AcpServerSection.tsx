import { useTranslation } from 'react-i18next';
import type { AgentServerStatus, ProviderInfo } from '@ruimte/contracts';
import { Button, Spinner } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import type { AcpServer } from '@/shell/settings/providers/use-acp-server';

function useServerWords(acp: AcpServer, server: AgentServerStatus) {
    const { t } = useTranslation('settings');
    const description =
        acp.error ??
        (server.state === 'failed' ? (server.error ?? '') : t(`providers.acpServer.state.${server.state}`, { version: server.installed ?? server.version }));
    const offersInstall = server.state === 'missing' || server.state === 'failed' || (server.state === 'installed' && server.installed !== server.version);
    const action = server.installed === null ? t('providers.acpServer.install') : t('providers.acpServer.update', { version: server.version });
    return { description: acp.local ? description : t('providers.acpServer.localOnly'), offersInstall, action };
}

function InstallButton({ acp, label, variant }: { acp: AcpServer; label: string; variant: 'primary' | 'secondary' }) {
    return (
        <Button size="sm" variant={variant} disabled={!acp.local} onClick={() => void acp.install()}>
            {label}
        </Button>
    );
}

/* The server of an installed CLI, where a newer pinned version is offered as an update. */
export function AcpServerSection({ provider, acp, server }: { provider: ProviderInfo; acp: AcpServer; server: AgentServerStatus }) {
    const { t } = useTranslation('settings');
    const { description, offersInstall, action } = useServerWords(acp, server);
    return (
        <SettingsSection title={t('providers.acpServer.title', { name: provider.name })} description={t('providers.acpServer.description')} scope="machine">
            <SettingsRow
                searchId="providers.acpServer"
                label={t('providers.acpServer.label', { version: server.version })}
                description={description}
                control={
                    server.state === 'installing' ? <Spinner size={12} /> : offersInstall && <InstallButton acp={acp} label={action} variant="secondary" />
                }
            />
        </SettingsSection>
    );
}

/* The server as the step after the CLI on a provider's install page. */
export function AcpServerStepBody({ acp, server }: { acp: AcpServer; server: AgentServerStatus }) {
    const { t } = useTranslation('settings');
    const { description, offersInstall, action } = useServerWords(acp, server);
    return (
        <>
            <p className="text-xs text-text-muted">{t('providers.acpServer.description')}</p>
            <div className="flex min-w-0 items-center gap-3">
                {server.state === 'installing' ? <Spinner size={12} /> : offersInstall && <InstallButton acp={acp} label={action} variant="primary" />}
                <span className="min-w-0 text-xs text-text-muted">{description}</span>
            </div>
        </>
    );
}

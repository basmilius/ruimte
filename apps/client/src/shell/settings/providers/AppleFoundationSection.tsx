import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderInfo } from '@ruimte/contracts';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Toggle } from '@/shell/settings/controls';
import { useServers } from '@/state/server';
import { useProvidersStore } from '@/state/providers';
import { useToasts } from '@/state/toasts';
import { transportFor } from '@/transport';
import { useEndpointConnection } from '@/transport/status';

export function AppleFoundationSection({ endpointId, provider }: { endpointId: string; provider: ProviderInfo }) {
    const { t } = useTranslation('settings');
    const info = useServers((state) => state.byEndpoint[endpointId]);
    const connection = useEndpointConnection(endpointId);
    const [busy, setBusy] = useState(false);
    const connected = connection.status === 'open';
    const supported = info?.appleFoundationEnabled !== null && info?.appleFoundationEnabled !== undefined;
    const enabled = info?.appleFoundationEnabled === true;

    const setEnabled = async (checked: boolean): Promise<void> => {
        const link = transportFor(endpointId);
        if (!link) {
            return;
        }
        setBusy(true);
        try {
            const next = await link.request('endpoint.setIdentity', {
                name: info?.nameSource === 'chosen' ? (info.label ?? null) : null,
                icon: info?.icon ?? null,
                appleFoundationEnabled: checked
            });
            useServers.getState().setIdentity(endpointId, {
                label: next.label,
                nameSource: next.nameSource ?? null,
                icon: next.icon ?? null,
                agentsDeleteAnyView: next.agentsDeleteAnyView === true,
                appleFoundationEnabled: next.appleFoundationEnabled ?? null
            });
            const { providers } = await link.request('provider.list', {});
            useProvidersStore.getState().setProviders(endpointId, providers);
        } catch (error) {
            useToasts.getState().show({
                id: `apple-foundation-${endpointId}`,
                kind: 'error',
                title: t('providers.apple.saveFailed'),
                description: error instanceof Error ? error.message : t('machine.toast.unchanged')
            });
        } finally {
            setBusy(false);
        }
    };

    const status = !connected
        ? t('machine.notAnswering')
        : info?.platform !== 'darwin'
          ? t('providers.apple.requiresMac')
          : !supported
            ? t('providers.apple.updateRequired')
            : !enabled
              ? t('providers.apple.disabled')
              : provider.installed
                ? t('providers.apple.ready')
                : (provider.version ?? t('providers.apple.unavailable'));

    return (
        <SettingsSection title="Apple Foundation Models" description={t('providers.apple.description')} scope="machine" footer={t('providers.apple.tools')}>
            <SettingsRow
                searchId="providers.apple"
                label={t('providers.apple.label')}
                description={t('providers.apple.toggleDescription')}
                control={
                    <Toggle
                        checked={enabled}
                        onChange={(checked) => void setEnabled(checked)}
                        label={t('providers.apple.label')}
                        disabled={busy || !connected || !supported || info?.platform !== 'darwin'}
                    />
                }
            />
            <SettingsRow label={t('providers.apple.status')} description={status} />
        </SettingsSection>
    );
}

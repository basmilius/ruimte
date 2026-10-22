import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import type { CliVersion, ProviderInfo } from '@ruimte/contracts';
import { Button, IconButton, Spinner } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import type { CliVersionsState } from '@/shell/settings/providers/use-provider-installs';

function useVersionWords(version: CliVersion) {
    const { t } = useTranslation('settings');
    const route = t(`providers.version.method.${version.method}`, { package: version.package ?? '' });
    const parts = [
        version.version === null ? t('providers.version.noVersion') : t('providers.version.current', { version: version.version }),
        version.method === 'unknown'
            ? t('providers.version.ownInstaller')
            : version.updatable && version.latest !== null
              ? t('providers.version.available', { version: version.latest })
              : version.latest !== null
                ? t('providers.version.upToDate')
                : null
    ];
    const line = parts.filter((part) => part !== null).join(' ');
    return { route, description: version.state === 'failed' || version.error ? (version.error ?? line) : line };
}

/* Under a CLI's detail: the version on the machine, how it was installed, and an update through that same route. */
export function CliVersionSection({ provider, versions, version }: { provider: ProviderInfo; versions: CliVersionsState; version: CliVersion }) {
    const { t } = useTranslation('settings');
    const { route, description } = useVersionWords(version);
    const checking = versions.checking.has(provider.kind);
    // Ruimte installed an agent of the registry itself, so it is the one that takes it off again.
    const removable = version.method === 'ruimte' && provider.kind !== 'antigravity';
    const control = (() => {
        if (version.state === 'updating' || checking) {
            return <Spinner size={12} />;
        }
        if (version.updatable && version.latest !== null) {
            return (
                <Button size="sm" variant="secondary" disabled={!versions.local} onClick={() => void versions.update(provider.kind)}>
                    {t('providers.version.update', { version: version.latest })}
                </Button>
            );
        }
        if (version.method === 'unknown') {
            return null;
        }
        return <IconButton icon={RefreshCw} size="sm" label={t('providers.version.check')} onClick={() => void versions.check(provider.kind)} />;
    })();
    return (
        <SettingsSection title={t('providers.version.title')} scope="machine" footer={versions.local ? undefined : t('providers.version.localOnly')}>
            <SettingsRow searchId="providers.version" label={route} description={description} control={control} />
            {removable && (
                <SettingsRow
                    searchId="providers.version.remove"
                    label={t('providers.version.remove')}
                    description={t('providers.version.removeDescription', { name: provider.name })}
                    control={
                        <Button size="sm" variant="secondary" disabled={!versions.local} onClick={() => void versions.remove(provider.kind)}>
                            {t('providers.version.removeButton')}
                        </Button>
                    }
                />
            )}
        </SettingsSection>
    );
}

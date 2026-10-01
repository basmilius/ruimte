import { useTranslation } from 'react-i18next';
import type { ProviderInfo } from '@ruimte/contracts';
import { SettingsRow } from '@basmilius/desktop-ui/settings';
import { Switch } from '@basmilius/desktop-ui';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { useAppleFoundation } from '@/shell/settings/providers/use-apple-foundation';

export function AppleFoundationSection({ endpointId, provider }: { endpointId: string; provider: ProviderInfo }) {
    const { t } = useTranslation('settings');
    const apple = useAppleFoundation(endpointId, provider);

    return (
        <SettingsSection title="Apple Foundation Models" description={t('providers.apple.description')} scope="machine" footer={t('providers.apple.tools')}>
            <SettingsRow
                searchId="providers.apple"
                label={t('providers.apple.label')}
                description={t('providers.apple.toggleDescription')}
                control={<Switch checked={apple.enabled} onCheckedChange={apple.setEnabled} label={t('providers.apple.label')} disabled={!apple.switchable} />}
            />
            <SettingsRow label={t('providers.apple.status')} description={apple.status} />
        </SettingsSection>
    );
}

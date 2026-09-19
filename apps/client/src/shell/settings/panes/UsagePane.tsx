import { useTranslation } from 'react-i18next';
import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Segmented } from '@/shell/settings/controls';
import { useUsage, useUsageStore } from '@/state/usage';
import type { UsageCurrency } from '@/shell/usage/format';

const CURRENCIES: readonly UsageCurrency[] = ['USD', 'EUR'];

/* Every price a model has is in dollars, so the only choice here is what to read them in. */
export function UsagePane() {
    const { t } = useTranslation('settings');
    const currency = useUsage((s) => s.currency);
    const rate = useUsage((s) => s.summary?.rate ?? null);

    return (
        <SettingsSection title={t('usage.title')}>
            <SettingsRow
                label={t('usage.currency.label')}
                description={
                    currency === 'USD'
                        ? t('usage.currency.dollars')
                        : rate === null
                          ? t('usage.currency.noRate')
                          : t('usage.currency.converted', { date: rate.date })
                }
                control={
                    <Segmented
                        value={currency}
                        options={CURRENCIES.map((id) => ({ id, label: t(`usage.currency.options.${id}`) }))}
                        onChange={(id) => useUsageStore.getState().setCurrency(id)}
                        label={t('usage.currency.label')}
                    />
                }
            />
        </SettingsSection>
    );
}

import { ChartNoAxesColumn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsRow } from '@ruimte/ui/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Segmented } from '@ruimte/ui/controls';
import { useUi } from '@/state/ui';
import { useUsage, useUsageStore } from '@/state/usage';
import type { UsageCurrency } from '@/shell/usage/format';
import { Button } from '@ruimte/ui/Button';
import { Icon } from '@ruimte/ui/Icon';

const CURRENCIES: readonly UsageCurrency[] = ['USD', 'EUR'];

// The usage page is a dialog of its own, so settings step aside rather than stack two dialogs.
const openUsage = (): void => {
    const ui = useUi.getState();
    ui.setSettings({ open: false });
    ui.setUsageOpen(true);
};

/* Every price a model has is in dollars, so the only choice here is what to read them in. */
export function UsagePane() {
    const { t } = useTranslation('settings');
    const currency = useUsage((s) => s.currency);
    const rate = useUsage((s) => s.summary?.rate ?? null);

    return (
        <SettingsSection>
            <SettingsRow
                searchId="usage.currency"
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
            <SettingsRow
                searchId="usage.page"
                label={t('usage.page.label')}
                description={t('usage.page.description')}
                control={
                    <Button variant="secondary" onClick={openUsage}>
                        <Icon icon={ChartNoAxesColumn} size={14} /> {t('usage.page.open')}
                    </Button>
                }
            />
        </SettingsSection>
    );
}

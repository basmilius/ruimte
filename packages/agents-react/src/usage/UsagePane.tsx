import { ChartNoAxesColumn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsRow } from '@ruimte/ui/settings/SettingsRow';
import { SettingsSection } from '@ruimte/ui/settings/SettingsSection';
import { Segmented } from '@ruimte/ui/controls';
import { useUsage, useUsageStore } from '../state/usage';
import type { UsageCurrency } from './format';
import { Button } from '@ruimte/ui/Button';
import { Icon } from '@ruimte/ui/Icon';

const CURRENCIES: readonly UsageCurrency[] = ['USD', 'EUR'];

/*
 * Every price a model has is in dollars, so the only choice here is what to read them in. The usage
 * page is a dialog of its own, so `onOpenPage` is where the app lets settings step aside for it.
 */
export function UsagePane({ onOpenPage }: { onOpenPage(): void }) {
    const { t } = useTranslation('agent-usage');
    const currency = useUsage((s) => s.currency);
    const rate = useUsage((s) => s.summary?.rate ?? null);

    return (
        <SettingsSection>
            <SettingsRow
                searchId="usage.currency"
                label={t('settings.currency.label')}
                description={
                    currency === 'USD'
                        ? t('settings.currency.dollars')
                        : rate === null
                          ? t('settings.currency.noRate')
                          : t('settings.currency.converted', { date: rate.date })
                }
                control={
                    <Segmented
                        value={currency}
                        options={CURRENCIES.map((id) => ({ id, label: t(`settings.currency.options.${id}`) }))}
                        onChange={(id) => useUsageStore.getState().setCurrency(id)}
                        label={t('settings.currency.label')}
                    />
                }
            />
            <SettingsRow
                searchId="usage.page"
                label={t('settings.page.label')}
                description={t('settings.page.description')}
                control={
                    <Button variant="secondary" onClick={onOpenPage}>
                        <Icon icon={ChartNoAxesColumn} size={14} /> {t('settings.page.open')}
                    </Button>
                }
            />
        </SettingsSection>
    );
}

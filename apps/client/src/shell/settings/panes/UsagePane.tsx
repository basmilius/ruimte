import { SettingsRow } from '@/shell/settings/SettingsRow';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { Segmented } from '@/shell/settings/controls';
import { useUsage, useUsageStore } from '@/state/usage';
import type { UsageCurrency } from '@/shell/usage/format';

const CURRENCIES: readonly { id: UsageCurrency; label: string }[] = [
    { id: 'USD', label: 'Dollars' },
    { id: 'EUR', label: 'Euros' }
];

/* Every price a model has is in dollars, so the only choice here is what to read them in. */
export function UsagePane() {
    const currency = useUsage((s) => s.currency);
    const rate = useUsage((s) => s.summary?.rate ?? null);

    return (
        <SettingsSection title="Usage">
            <SettingsRow
                label="Currency"
                description={
                    currency === 'USD'
                        ? 'Prices as published, in dollars.'
                        : rate === null
                          ? 'No exchange rate yet. The page shows dollars until there is one.'
                          : `Converted at the ECB reference rate of ${rate.date}.`
                }
                control={<Segmented value={currency} options={CURRENCIES} onChange={(id) => useUsageStore.getState().setCurrency(id)} label="Currency" />}
            />
        </SettingsSection>
    );
}

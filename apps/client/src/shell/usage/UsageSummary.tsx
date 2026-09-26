import { useTranslation } from 'react-i18next';
import type { UsageTotals } from '@ruimte/contracts';
import type { UsageMetric } from '@ruimte/agents-react/state/usage';
import { ProviderLogo } from '@ruimte/agents-react/agents/ProviderLogo';
import { totalTokensOf } from '@ruimte/contracts';
import { formatCount, formatTokens, PROVIDER_COLORS, PROVIDER_LABELS } from '@ruimte/agents-react/usage/format';
import { useMoney } from '@ruimte/agents-react/usage/money';
import type { ProviderTotal } from '@/shell/usage/summary';

interface UsageSummaryProps {
    metric: UsageMetric;
    costUsd: number;
    totals: UsageTotals;
    sessions: number;
    providers: readonly ProviderTotal[];
}

/*
 * The number the page is about, with a row per provider under it. Those rows double as the chart's
 * legend, which is why the mark is the same color the bar segment is drawn in.
 */
export function UsageSummary({ metric, costUsd, totals, sessions, providers }: UsageSummaryProps) {
    const { t } = useTranslation('usage');
    const money = useMoney();
    return (
        <div className="flex flex-col gap-4">
            <div>
                <p className="text-4xl font-semibold tabular-nums">{metric === 'cost' ? money(costUsd) : formatTokens(totalTokensOf(totals))}</p>
                {/* A subscription is not billed per call, so the label spells out that these are API rates. */}
                <p className="mt-1 text-xs text-text-muted">
                    {t('summary.sessions', { count: sessions, sessions: formatCount(sessions) })} ·{' '}
                    {t('summary.calls', { count: totals.calls, calls: formatCount(totals.calls) })} · {t('summary.apiRates')}
                </p>
            </div>
            <div className="flex flex-col gap-2">
                {providers.map((provider) => (
                    <div key={provider.provider} className="flex items-center gap-2 text-xs">
                        <span style={{ color: PROVIDER_COLORS[provider.provider] }}>
                            <ProviderLogo provider={provider.provider} />
                        </span>
                        <span className="text-text">{PROVIDER_LABELS[provider.provider]}</span>
                        <span className="ml-auto tabular-nums text-text-muted">
                            {money(provider.costUsd)} · {formatTokens(totalTokensOf(provider.totals))}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

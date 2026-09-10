import type { UsageTotals } from '@ruimte/contracts';
import type { UsageMetric } from '@/state/usage';
import { formatCount, formatTokens, formatUsd, PROVIDER_COLORS, PROVIDER_LABELS, totalTokensOf } from '@/shell/usage/format';
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
 * legend, which is why the dot is the same color the bar segment is drawn in.
 */
export function UsageSummary({ metric, costUsd, totals, sessions, providers }: UsageSummaryProps) {
    return (
        <div className="flex flex-col gap-4">
            <div>
                <p className="text-4xl font-semibold tabular-nums">{metric === 'cost' ? formatUsd(costUsd) : formatTokens(totalTokensOf(totals))}</p>
                {/* A subscription is not billed per call, so the figure says what it is: API rates. */}
                <p className="mt-1 text-xs text-text-muted">
                    {formatCount(sessions)} {sessions === 1 ? 'session' : 'sessions'} · {formatCount(totals.calls)} calls · at API rates
                </p>
            </div>
            <div className="flex flex-col gap-2">
                {providers.map((provider) => (
                    <div key={provider.provider} className="flex items-center gap-2 text-xs">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: PROVIDER_COLORS[provider.provider] }} />
                        <span className="text-text">{PROVIDER_LABELS[provider.provider]}</span>
                        <span className="ml-auto tabular-nums text-text-muted">
                            {formatUsd(provider.costUsd)} · {formatTokens(totalTokensOf(provider.totals))}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

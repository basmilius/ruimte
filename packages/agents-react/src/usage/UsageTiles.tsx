import { useTranslation } from 'react-i18next';
import type { UsageTotals } from '@ruimte/agent-contracts';
import { totalTokensOf } from '@ruimte/agent-contracts';
import { formatTokens } from './format';
import { useMoney } from './money';

interface UsageTilesProps {
    totals: UsageTotals;
    cacheSavingsUsd: number;
}

/* What the period moved, split by the kinds of token that are priced differently. */
export function UsageTiles({ totals, cacheSavingsUsd }: UsageTilesProps) {
    const { t } = useTranslation('agent-usage');
    const money = useMoney();
    const tiles: { id: string; value: string }[] = [
        { id: 'processed', value: formatTokens(totalTokensOf(totals)) },
        { id: 'uncachedInput', value: formatTokens(totals.input) },
        { id: 'cachedInput', value: formatTokens(totals.cacheRead) },
        { id: 'cacheWrites', value: formatTokens(totals.cacheWrite) },
        { id: 'output', value: formatTokens(totals.output) },
        { id: 'cacheSavings', value: money(cacheSavingsUsd) }
    ];
    return (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            {tiles.map((tile) => (
                <div key={tile.id} className="rounded-xl border border-border bg-surface px-4 py-3">
                    <p className="text-xs text-text-muted">{t(`tiles.${tile.id}`)}</p>
                    <p className="mt-0.5 text-base font-medium tabular-nums">{tile.value}</p>
                </div>
            ))}
        </div>
    );
}

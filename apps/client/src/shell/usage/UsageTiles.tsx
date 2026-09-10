import type { UsageTotals } from '@ruimte/contracts';
import { formatTokens, formatUsd, totalTokensOf } from '@/shell/usage/format';

interface UsageTilesProps {
    totals: UsageTotals;
    cacheSavingsUsd: number;
}

/* What the period moved, split by the kinds of token that are priced differently. */
export function UsageTiles({ totals, cacheSavingsUsd }: UsageTilesProps) {
    const tiles: { label: string; value: string }[] = [
        { label: 'Processed', value: formatTokens(totalTokensOf(totals)) },
        { label: 'Uncached input', value: formatTokens(totals.input) },
        { label: 'Cached input', value: formatTokens(totals.cacheRead) },
        { label: 'Cache writes', value: formatTokens(totals.cacheWrite) },
        { label: 'Output', value: formatTokens(totals.output) },
        { label: 'Cache savings', value: formatUsd(cacheSavingsUsd) }
    ];
    return (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            {tiles.map((tile) => (
                <div key={tile.label} className="rounded-xl border border-border bg-surface px-4 py-3">
                    <p className="text-xs text-text-muted">{tile.label}</p>
                    <p className="mt-0.5 text-base font-medium tabular-nums">{tile.value}</p>
                </div>
            ))}
        </div>
    );
}

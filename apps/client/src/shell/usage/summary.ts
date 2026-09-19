import type { UsageProvider, UsageSummaryResult, UsageTotals } from '@ruimte/contracts';
import type { UsageMetric } from '@/state/usage';
import { EMPTY_TOTALS, USAGE_PROVIDERS, addTotals, totalTokensOf } from '@ruimte/contracts';

/* One bar of the chart: what each provider put in this slot, and the height of the stack. */
export interface ChartSlot {
    slot: string;
    byProvider: Partial<Record<UsageProvider, number>>;
    total: number;
}

/* One row of the legend, which is also one provider's share of the period. */
export interface ProviderTotal {
    provider: UsageProvider;
    costUsd: number;
    totals: UsageTotals;
}

/* Three or four round numbers up the side. The one piece of arithmetic a chart library would bring. */
export const niceScale = (max: number, ticks = 4): { max: number; step: number } => {
    if (!Number.isFinite(max) || max <= 0) {
        return { max: 1, step: 1 };
    }
    const rough = max / ticks;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const normalized = rough / magnitude;
    const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
    return { max: Math.ceil(max / step) * step, step };
};

export interface DerivedUsage {
    slots: ChartSlot[];
    providers: ProviderTotal[];
    /* The providers that did anything, in the order the chart stacks them. */
    active: UsageProvider[];
    totals: UsageTotals;
    costUsd: number;
    cacheSavingsUsd: number;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/*
 * Every slot the period has, whether anything happened in it or not: an empty day keeps its place on
 * the axis, so a gap in the work reads as a gap and not as a shorter week.
 */
export const enumerateSlots = (summary: Pick<UsageSummaryResult, 'from' | 'to' | 'resolution'>): string[] => {
    if (summary.resolution === 'hour') {
        return Array.from({ length: 24 }, (_, hour) => `${summary.to}T${pad(hour)}`);
    }
    const slots: string[] = [];
    const at = new Date(`${summary.from}T00:00:00`);
    const end = new Date(`${summary.to}T00:00:00`);
    // A calendar loop rather than adding milliseconds: a day is 23 or 25 hours long twice a year.
    while (at <= end && slots.length < 400) {
        slots.push(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`);
        at.setDate(at.getDate() + 1);
    }
    return slots;
};

/* How often an x label fits: every third hour, every day, every week, every fortnight. */
export const labelEveryFor = (slots: number): number => (slots <= 10 ? 1 : slots <= 24 ? 3 : slots <= 31 ? 7 : 15);

/*
 * The buckets folded into what the page draws. The daemon sends one bucket per slot, provider and
 * model, which is the smallest thing every part of the page can be summed out of.
 */
export const deriveUsage = (summary: UsageSummaryResult, metric: UsageMetric): DerivedUsage => {
    const bySlot = new Map<string, ChartSlot>();
    for (const slot of enumerateSlots(summary)) {
        bySlot.set(slot, { slot, byProvider: {}, total: 0 });
    }
    const byProvider = new Map<UsageProvider, ProviderTotal>();
    let totals = EMPTY_TOTALS;
    let costUsd = 0;
    let cacheSavingsUsd = 0;

    for (const bucket of summary.buckets) {
        const value = metric === 'cost' ? (bucket.costUsd ?? 0) : totalTokensOf(bucket.totals);
        const slot = bySlot.get(bucket.slot);
        if (slot !== undefined) {
            slot.byProvider[bucket.provider] = (slot.byProvider[bucket.provider] ?? 0) + value;
            slot.total += value;
        }
        const provider = byProvider.get(bucket.provider) ?? { provider: bucket.provider, costUsd: 0, totals: EMPTY_TOTALS };
        provider.costUsd += bucket.costUsd ?? 0;
        provider.totals = addTotals(provider.totals, bucket.totals);
        byProvider.set(bucket.provider, provider);
        totals = addTotals(totals, bucket.totals);
        costUsd += bucket.costUsd ?? 0;
        cacheSavingsUsd += bucket.cacheSavingsUsd;
    }

    const providers = [...byProvider.values()].sort((a, b) => b.costUsd - a.costUsd);
    return {
        slots: [...bySlot.values()],
        providers,
        active: USAGE_PROVIDERS.filter((provider) => byProvider.has(provider)),
        totals,
        costUsd,
        cacheSavingsUsd
    };
};

/* One row of the Day table: what each provider cost that day, and what the day moved in all. */
export interface UsageDay {
    /* `YYYY-MM-DD`, always a calendar day, whatever resolution the chart above it is drawn at. */
    slot: string;
    costByProvider: Partial<Record<UsageProvider, number>>;
    costUsd: number;
    tokens: number;
}

/*
 * The same buckets the chart draws, written out as a table of calendar days, newest first. Today is
 * drawn per hour but read per day, so an hour slot is folded onto the date it names. A day nothing
 * happened in is left out: the chart already shows the gap, and a quiet fortnight would otherwise be
 * fourteen rows of zeroes between the days worth reading.
 */
export const deriveDays = (summary: UsageSummaryResult): UsageDay[] => {
    const rows = new Map<string, UsageDay>();
    for (const bucket of summary.buckets) {
        const day = bucket.slot.slice(0, 10);
        const row = rows.get(day) ?? { slot: day, costByProvider: {}, costUsd: 0, tokens: 0 };
        const cost = bucket.costUsd ?? 0;
        row.costByProvider[bucket.provider] = (row.costByProvider[bucket.provider] ?? 0) + cost;
        row.costUsd += cost;
        row.tokens += totalTokensOf(bucket.totals);
        rows.set(day, row);
    }
    return [...rows.values()].sort((a, b) => b.slot.localeCompare(a.slot));
};

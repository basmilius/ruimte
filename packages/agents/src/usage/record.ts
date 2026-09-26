import type { UsageProvider, UsageTotals } from '@ruimte/agent-contracts';

/* One priced call, as a reader found it on a line. The scanner keeps these; the aggregator sums them. */
export interface UsageRecord {
    provider: UsageProvider;
    timestampMs: number;
    model: string;
    sessionId: string;
    /* The directory the call was made in, which is what a per-project breakdown folds. */
    cwd: string;
    /* The account the call was made under; absent is the default account of the CLI. */
    account?: string;
    totals: UsageTotals;
    /* What identifies the message this line reports on, or null when nothing does. */
    dedupeKey: string | null;
}

/* A count on the wire is a whole non-negative number, whatever a transcript put in the field. */
export const int = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0);

/* A field a transcript wrote as anything; a reader takes what it can use and nothing else. */
export const asObject = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

export const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const maxTotals = (into: UsageTotals, from: UsageTotals): void => {
    into.calls = Math.max(into.calls, from.calls);
    into.input = Math.max(into.input, from.input);
    into.cacheRead = Math.max(into.cacheRead, from.cacheRead);
    into.cacheWrite = Math.max(into.cacheWrite, from.cacheWrite);
    into.cacheWrite1h = Math.max(into.cacheWrite1h, from.cacheWrite1h);
    into.output = Math.max(into.output, from.output);
    into.reasoning = Math.max(into.reasoning, from.reasoning);
};

// Claude repeats growing usage per message and across resumed transcripts; keep each field's maximum.
export const foldByKey = (records: readonly UsageRecord[]): UsageRecord[] => {
    const folded: UsageRecord[] = [];
    const at = new Map<string, number>();
    for (const record of records) {
        if (record.dedupeKey === null) {
            folded.push(record);
            continue;
        }
        const seen = at.get(record.dedupeKey);
        if (seen === undefined) {
            at.set(record.dedupeKey, folded.length);
            folded.push({ ...record, totals: { ...record.totals } });
            continue;
        }
        maxTotals(folded[seen]!.totals, record.totals);
    }
    return folded;
};

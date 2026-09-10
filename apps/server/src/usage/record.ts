import type { UsageProvider, UsageTotals } from '@ruimte/contracts';

/* One priced call, as a reader found it on a line. The scanner keeps these; the aggregator sums them. */
export interface UsageRecord {
    provider: UsageProvider;
    timestampMs: number;
    model: string;
    sessionId: string;
    /* The directory the call was made in, which is what a per-project breakdown folds. */
    cwd: string;
    totals: UsageTotals;
    /* What identifies the message this line reports on, or null when nothing does. */
    dedupeKey: string | null;
}

export const EMPTY_TOTALS: UsageTotals = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0, reasoning: 0 };

/* A count on the wire is a whole non-negative number, whatever a transcript put in the field. */
export const int = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0);

export const addTotals = (into: UsageTotals, from: UsageTotals): void => {
    into.calls += from.calls;
    into.input += from.input;
    into.cacheRead += from.cacheRead;
    into.cacheWrite += from.cacheWrite;
    into.cacheWrite1h += from.cacheWrite1h;
    into.output += from.output;
    into.reasoning += from.reasoning;
};

const maxTotals = (into: UsageTotals, from: UsageTotals): void => {
    into.calls = Math.max(into.calls, from.calls);
    into.input = Math.max(into.input, from.input);
    into.cacheRead = Math.max(into.cacheRead, from.cacheRead);
    into.cacheWrite = Math.max(into.cacheWrite, from.cacheWrite);
    into.cacheWrite1h = Math.max(into.cacheWrite1h, from.cacheWrite1h);
    into.output = Math.max(into.output, from.output);
    into.reasoning = Math.max(into.reasoning, from.reasoning);
};

export const totalTokensOf = (totals: UsageTotals): number => totals.input + totals.cacheRead + totals.cacheWrite + totals.output;

/*
 * Claude Code writes one line per content block and rewrites the line while a message streams, and
 * it copies finished messages forward into the transcript of a resumed or forked session. Every one
 * of those lines repeats the same usage object, sometimes half filled. Keeping the largest value per
 * field per message covers both: the growing copy and the repeated one. Records without a key are a
 * call of their own and pass through untouched, in the order they were read.
 */
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

import type { UsageProvider, UsageTotals } from '@ruimte/contracts';

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const SMALL_USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
const COUNT = new Intl.NumberFormat('en-US');

/* Under a cent the two decimals of a currency read as zero, which is the one thing it is not. */
export const formatUsd = (value: number): string => (value !== 0 && Math.abs(value) < 0.01 ? SMALL_USD.format(value) : USD.format(value));

export const formatCount = (value: number): string => COUNT.format(Math.round(value));

/* `1.2M`, `412K`, `640`: a token count is read as a size, not counted. */
export const formatTokens = (value: number): string => {
    const rounded = Math.round(value);
    if (rounded >= 1_000_000) {
        return `${(rounded / 1_000_000).toFixed(rounded >= 10_000_000 ? 0 : 1)}M`;
    }
    if (rounded >= 1_000) {
        return `${(rounded / 1_000).toFixed(rounded >= 10_000 ? 0 : 1)}K`;
    }
    return String(rounded);
};

export const PROVIDER_LABELS: Record<UsageProvider, string> = { claude: 'Claude Code', codex: 'Codex' };

export const PROVIDER_COLORS: Record<UsageProvider, string> = { claude: 'var(--chart-claude)', codex: 'var(--chart-codex)' };

export const USAGE_PROVIDERS: readonly UsageProvider[] = ['claude', 'codex'];

/* Reasoning is a part of the output, so adding it would count those tokens twice. */
export const totalTokensOf = (totals: UsageTotals): number => totals.input + totals.cacheRead + totals.cacheWrite + totals.output;

export const addTotals = (into: UsageTotals, from: UsageTotals): UsageTotals => ({
    calls: into.calls + from.calls,
    input: into.input + from.input,
    cacheRead: into.cacheRead + from.cacheRead,
    cacheWrite: into.cacheWrite + from.cacheWrite,
    cacheWrite1h: into.cacheWrite1h + from.cacheWrite1h,
    output: into.output + from.output,
    reasoning: into.reasoning + from.reasoning
});

export const EMPTY_TOTALS: UsageTotals = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0, reasoning: 0 };

const DAY_LABEL = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const SHORT_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/* A slot is `2026-09-10` or `2026-09-10T14`, already in the viewer's own zone, so it is read as
   plain wall clock and never handed to a parser that would shift it back. */
const dateOfSlot = (slot: string): Date => new Date(Number(slot.slice(0, 4)), Number(slot.slice(5, 7)) - 1, Number(slot.slice(8, 10)));

const hourOfSlot = (slot: string): number | null => (slot.length > 10 ? Number(slot.slice(11, 13)) : null);

export const slotLabel = (slot: string): string => {
    const hour = hourOfSlot(slot);
    if (hour === null) {
        return DAY_LABEL.format(dateOfSlot(slot));
    }
    const suffix = hour < 12 ? 'AM' : 'PM';
    return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`;
};

export const slotAxisLabel = (slot: string): string => {
    const hour = hourOfSlot(slot);
    return hour === null ? SHORT_DAY.format(dateOfSlot(slot)) : `${hour}:00`;
};

const CLOCK = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const formatClock = (at: number): string => CLOCK.format(new Date(at));

export const formatDate = (at: number): string => SHORT_DAY.format(new Date(at));

import type { UsageProvider, UsageRate } from '@ruimte/agent-contracts';
import { formatDay, formatHour, formatWeekdayDay } from '@ruimte/ui/format/datetime';
import { formatMoney, formatNumber, formatTokens } from '@ruimte/ui/format/number';

/* Dollars are what a price table is in; euros are what the page can be set to. */
export type UsageCurrency = 'USD' | 'EUR';

/* Every number on this page is read in the region of the machine looking at it, as a bank statement
   would be: `$5,480.96` in the US, `$ 5.480,96` in the Netherlands. The labels stay English. */
export const formatCount = (value: number): string => formatNumber(value);

export { formatTokens };

/*
 * What a call cost, in the currency the page is set to. Prices are in dollars, so anything else is
 * that amount at the day's reference rate; without a rate the page stays in dollars rather than
 * showing a euro sign in front of a dollar amount.
 */
export const moneyFormat = (currency: UsageCurrency, rate: UsageRate | null): ((usd: number) => string) => {
    const converts = currency !== 'USD' && rate !== null && rate.currency === currency;
    const factor = converts ? rate.rate : 1;
    const code = converts ? currency : 'USD';
    return (usd) => {
        const value = usd * factor;
        // Under a cent the two decimals of a currency read as zero, which is the one thing it is not.
        return formatMoney(value, code, value !== 0 && Math.abs(value) < 0.01 ? 4 : undefined);
    };
};

/* The dollar amounts of a page that has no summary yet, and of a tooltip that prices nothing. */
export const formatUsd = moneyFormat('USD', null);

export const PROVIDER_LABELS: Record<UsageProvider, string> = { claude: 'Claude Code', codex: 'Codex' };

export const PROVIDER_COLORS: Record<UsageProvider, string> = { claude: 'var(--chart-claude)', codex: 'var(--chart-codex)' };

/* A slot is `2026-09-10` or `2026-09-10T14`, already in the viewer's own zone, so it is read as
   plain wall clock and never handed to a parser that would shift it back. */
const dateOfSlot = (slot: string): Date => new Date(Number(slot.slice(0, 4)), Number(slot.slice(5, 7)) - 1, Number(slot.slice(8, 10)));

const hourOfSlot = (slot: string): number | null => (slot.length > 10 ? Number(slot.slice(11, 13)) : null);

const atHour = (slot: string, hour: number): Date => {
    const day = dateOfSlot(slot);
    day.setHours(hour);
    return day;
};

export const slotLabel = (slot: string): string => {
    const hour = hourOfSlot(slot);
    return hour === null ? formatWeekdayDay(dateOfSlot(slot)) : formatHour(atHour(slot, hour));
};

export const slotAxisLabel = (slot: string): string => {
    const hour = hourOfSlot(slot);
    return hour === null ? formatDay(dateOfSlot(slot)) : formatHour(atHour(slot, hour));
};

export { formatClock } from '@ruimte/ui/format/datetime';

export const formatDate = (at: number): string => formatDay(at);

/* A path under a row that already carries the name: enough of the tail to tell two checkouts of the
   same repository apart, without the home directory nobody needs to read again. */
export const shortPath = (path: string): string => {
    const parts = path.split('/').filter(Boolean);
    return parts.length <= 3 ? path : `…/${parts.slice(-3).join('/')}`;
};

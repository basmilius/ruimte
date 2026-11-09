import { formatDateTime } from '@adecore/ui/format';

// 3 January 2000 was a Monday, so an ISO weekday is that date plus the weekday less one.
function weekdayAt(weekday: number): number {
    return Date.UTC(2000, 0, 2 + weekday, 12, 0);
}

/* The name of an ISO weekday (1 is Monday) in the interface language. */
export function weekdayWords(weekday: number, width: 'short' | 'long' = 'short'): string {
    return formatDateTime(weekdayAt(weekday), { weekday: width, timeZone: 'UTC' });
}

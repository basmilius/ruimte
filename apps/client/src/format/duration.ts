import { formatDecimal, formatNumber } from '@/format/number';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/*
 * How long something took, at the coarsest unit that still says something. The units are English
 * abbreviations, the way the rest of the interface is written; only the number bends to the region,
 * which is what `1,5 h` against `1.5 h` is about.
 */
export const formatDuration = (ms: number): string => {
    const seconds = Math.max(0, Math.round(ms / SECOND));
    if (seconds < 60) {
        return `${formatNumber(seconds)} s`;
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${formatNumber(minutes)} min`;
    }
    return `${formatDecimal(minutes / 60)} h`;
};

/* How long a window still has, tight enough for the end of a bar: `4d 3h`, `12h 8m`, `9m`. */
export const formatCountdown = (ms: number): string => {
    const left = Math.max(0, ms);
    if (left >= DAY) {
        return `${formatNumber(Math.floor(left / DAY))}d ${formatNumber(Math.round((left % DAY) / HOUR))}h`;
    }
    if (left >= HOUR) {
        return `${formatNumber(Math.floor(left / HOUR))}h ${formatNumber(Math.round((left % HOUR) / MINUTE))}m`;
    }
    return `${formatNumber(Math.max(1, Math.round(left / MINUTE)))}m`;
};

/* How long ago something was, short enough for the right edge of a row. */
export const formatAgo = (ms: number): string => {
    const past = Math.max(0, ms);
    if (past < MINUTE) {
        return 'just now';
    }
    if (past < HOUR) {
        return `${formatNumber(Math.floor(past / MINUTE))}m ago`;
    }
    if (past < DAY) {
        return `${formatNumber(Math.floor(past / HOUR))}h ago`;
    }
    return `${formatNumber(Math.floor(past / DAY))}d ago`;
};

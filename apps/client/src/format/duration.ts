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

/* How long a step took when it is measured in milliseconds: `840 ms`, and `2.4 s` from a second up. */
export const formatLatency = (ms: number): string => {
    const rounded = Math.max(0, Math.round(ms));
    return rounded < SECOND ? `${formatNumber(rounded)} ms` : `${formatDecimal(rounded / SECOND)} s`;
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

/*
 * How long something has been running, to two units and no space to spare: `12s`, `2m 5s`, `3h 20m`.
 * A call that took a fraction of a second still took some, so anything above zero reads as at least
 * `1s`; only a clock that runs ahead of the start comes out as `0s`.
 */
export const formatElapsedShort = (ms: number): string => {
    const seconds = ms <= 0 ? 0 : Math.max(1, Math.round(ms / SECOND));
    if (seconds < 60) {
        return `${formatNumber(seconds)}s`;
    }
    if (seconds < 3600) {
        const rest = seconds % 60;
        const minutes = Math.floor(seconds / 60);
        return rest === 0 ? `${formatNumber(minutes)}m` : `${formatNumber(minutes)}m ${formatNumber(rest)}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes === 0 ? `${formatNumber(hours)}h` : `${formatNumber(hours)}h ${formatNumber(minutes)}m`;
};

/* A stopwatch that is watched while it runs: `00:14`, and `1:02:03` once it passes an hour. */
export const formatClockDuration = (ms: number): string => {
    const seconds = Math.max(0, Math.floor(ms / SECOND));
    const pad = (value: number): string => String(value).padStart(2, '0');
    const clock = `${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
    const hours = Math.floor(seconds / 3600);
    return hours > 0 ? `${formatNumber(hours)}:${clock}` : clock;
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

import { localTimeZone } from '@adecore/ui/format';
import { ClockTimeSchema, quietState, WeekdaySchema, type QuietHours, type QuietState } from '@ruimte/contracts';

export const DEFAULT_QUIET_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
export const DEFAULT_QUIET_START = '22:00';
export const DEFAULT_QUIET_END = '07:00';

/* The stretches of work a break reminder offers, in minutes. */
export const BREAK_STRETCHES: readonly number[] = [30, 45, 50, 60, 75, 90, 120];
export const DEFAULT_BREAK_STRETCH = 50;

/* The four settings that make up this client's quiet hours. */
interface QuietSettings {
    quietHoursOn: boolean;
    quietHoursDays: readonly number[];
    quietHoursStart: string;
    quietHoursEnd: string;
}

const NO_QUIET: QuietState = { quiet: false, changesAt: null };

/* Days as stored: each ISO weekday once, Monday first; a list with none left is every day. */
export function quietDaysFrom(value: unknown): number[] {
    const days = Array.isArray(value) ? [...new Set(value.filter((day) => WeekdaySchema.safeParse(day).success))].sort() : [];

    return days.length > 0 ? days : [...DEFAULT_QUIET_DAYS];
}

export function quietClockFrom(value: unknown, fallback: string): string {
    return ClockTimeSchema.safeParse(value).success ? (value as string) : fallback;
}

export function breakStretchFrom(value: unknown): number {
    return typeof value === 'number' && BREAK_STRETCHES.includes(value) ? value : DEFAULT_BREAK_STRETCH;
}

/* The hours as the machine wants them, on this computer's clock; null while they are off. */
export function quietHoursOf(settings: QuietSettings): QuietHours | null {
    if (!settings.quietHoursOn) {
        return null;
    }

    return { days: [...settings.quietHoursDays], start: settings.quietHoursStart, end: settings.quietHoursEnd, timeZone: localTimeZone() ?? 'UTC' };
}

/* Whether this client is in its quiet hours at `now`, and when that changes. */
export function clientQuietState(settings: QuietSettings, now: number): QuietState {
    const hours = quietHoursOf(settings);

    return hours === null ? NO_QUIET : quietState(hours, now);
}

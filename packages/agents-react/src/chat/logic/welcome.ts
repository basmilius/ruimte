/* The part of the day a greeting names, on the local clock; the night runs until five. */
export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export function dayPartOf(now: Date): DayPart {
    const hour = now.getHours();
    if (hour < 5) {
        return 'night';
    }
    if (hour < 12) {
        return 'morning';
    }
    return hour < 18 ? 'afternoon' : 'evening';
}

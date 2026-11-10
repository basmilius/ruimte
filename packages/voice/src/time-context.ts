/* A zone the caller sent that this runtime does not know reads as UTC, and says so, rather than failing the session. */
function zoneOf(timeZone: string): { zone: string; known: boolean } {
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone });
        return { zone: timeZone, known: true };
    } catch {
        return { zone: 'UTC', known: false };
    }
}

/*
 * The time of the person Voice speaks with, as one line for the speech model. It is not something a person
 * reads, so a fixed `en-GB` keeps the date unambiguous whatever language is spoken. A caller that does not
 * know its zone passes null and gets the runtime's own, said as unknown.
 */
export function timeContext(now: number, timeZone: string | null): string {
    const iso = new Date(now).toISOString();
    if (timeZone === null) {
        const local = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'long' }).format(now);
        return `User local date and time: ${local}. IANA time zone: unknown. UTC time: ${iso}.`;
    }
    const { zone, known } = zoneOf(timeZone);
    const local = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'long', timeZone: zone }).format(now);
    return `User local date and time: ${local}. IANA time zone: ${known ? zone : `unknown (${timeZone.slice(0, 64)}), shown in UTC`}. UTC time: ${iso}.`;
}

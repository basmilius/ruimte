import type { RoutineEntry } from './routine.ts';

/* A person's no to a routine as it stands: it stands until the routine changes, so it names the digest it was said to. */
export function isDeclined(entry: Pick<RoutineEntry, 'local' | 'digest'>): boolean {
    return entry.local.declined === entry.digest;
}

/* Whether the machine owes a routine its times: approved as it stands and not said no to. */
export function isScheduled(entry: Pick<RoutineEntry, 'approved' | 'local' | 'digest'>): boolean {
    return entry.approved && !isDeclined(entry);
}

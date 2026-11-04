const ACTIVITY_LIMIT = 10;

/* Something the main thread began: a request or a tool, by its type and never its payload. */
export interface Activity {
    readonly label: string;
    readonly at: number;
}

/*
 * The last things the daemon's main thread began, sent to the hang watchdog with every heartbeat. The
 * worker cannot take a stack of the main thread, so a block is named by what started just before it.
 */
export class ActivityLog {
    private readonly entries: Activity[] = [];

    note(label: string, at: number): void {
        this.entries.push({ label, at });

        if (this.entries.length > ACTIVITY_LIMIT) {
            this.entries.shift();
        }
    }

    recent(): readonly Activity[] {
        return [...this.entries];
    }
}

export const daemonActivity = new ActivityLog();

export function noteActivity(label: string): void {
    daemonActivity.note(label, Date.now());
}

/* Newest first, each with how long before `now` it began, as a report reads it. */
export function describeActivity(entries: readonly Activity[], now: number): string[] {
    return entries.toReversed().map((entry) => `${entry.label} ${((now - entry.at) / 1000).toFixed(1)} s before`);
}

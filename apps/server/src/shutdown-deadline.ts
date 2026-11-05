import { realTimers, type Timers } from './timers.ts';

// Well under the time launchd and systemd give a stopping service before they kill it.
export const SHUTDOWN_LIMIT_MS = 10_000;

/*
 * Ends the process once a shutdown has run this long, so a step that never settles cannot keep the
 * daemon alive while a second signal is ignored. Answers a disarm for a test; a finished shutdown
 * exits on its own.
 */
export function armShutdownDeadline(exit: (code: number) => void, timers: Timers = realTimers, limitMs: number = SHUTDOWN_LIMIT_MS): () => void {
    return timers.set(() => {
        console.error(`ruimte server did not stop within ${limitMs} ms, exiting`);
        exit(0);
    }, limitMs);
}

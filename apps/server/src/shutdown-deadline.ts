import { errorText } from './error-text.ts';
import { realTimers, type Timers } from './timers.ts';

// With the last step's limit after it, still under the 20 s launchd gives a stopping service before it kills it.
export const SHUTDOWN_LIMIT_MS = 10_000;
// Above the 3 s the sessions take to settle their kills, so a slow taskkill on Windows still finishes.
export const LAST_STEP_LIMIT_MS = 4_000;

/*
 * Ends the process once a shutdown has run this long, so a step that never settles cannot keep the
 * daemon alive while a second signal is ignored. The step that must not be skipped (ending the
 * terminals) runs then under a limit of its own, and the exit code says the shutdown did not finish.
 * Answers a disarm for a test; a finished shutdown exits on its own.
 */
export function armShutdownDeadline(
    exit: (code: number) => void,
    last: () => Promise<void>,
    timers: Timers = realTimers,
    limitMs: number = SHUTDOWN_LIMIT_MS
): () => void {
    return timers.set(() => {
        console.error(`ruimte server did not stop within ${limitMs} ms, ending the terminals and exiting`);
        let exited = false;

        const leave = (): void => {
            if (!exited) {
                exited = true;
                exit(1);
            }
        };

        const cancel = timers.set(leave, LAST_STEP_LIMIT_MS);
        void last()
            .catch((e: unknown) => console.error('Ending terminals after the deadline failed:', errorText(e)))
            .finally(() => {
                cancel();
                leave();
            });
    }, limitMs);
}

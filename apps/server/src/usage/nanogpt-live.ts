import type { UsageWindow } from '@ruimte/contracts';
import type { ProbeResult } from '@adecore/agents/usage';

/* Between two questions to the API, so a chat that calls it every few seconds is not a poll of its own. */
const MIN_GAP_MS = 2000;

export interface LiveWindows {
    /* Puts what the API says onto the bar the monitor already draws, the way a turn of a CLI does. */
    apply(update: { plan: string | null; windows: UsageWindow[] }): void;
}

/*
 * The allowance of a subscription moves with every call, a tool loop of a chat spends a share of the
 * week in a minute, and the monitor reads it every few minutes, so its bar is always behind the one
 * the provider shows. After each call this asks again and applies the answer. Calls that come while a
 * question is out share the next one, and a failed question is left to the monitor's own read.
 */
export function followPlan(
    read: () => Promise<ProbeResult>,
    target: LiveWindows,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): () => void {
    let running = false;
    let again = false;
    const run = async (): Promise<void> => {
        running = true;
        try {
            do {
                again = false;
                const reading = await read();
                if ('windows' in reading) {
                    target.apply({ plan: reading.plan, windows: reading.windows });
                }
                if (again) {
                    await sleep(MIN_GAP_MS);
                }
            } while (again);
        } catch {
            // The next read of the monitor tries again, and keeps the numbers it has.
        } finally {
            running = false;
        }
    };
    return () => {
        if (running) {
            again = true;
            return;
        }
        void run();
    };
}

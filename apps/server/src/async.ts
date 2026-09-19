/* The two waits the daemon does: a pause it can be woken from, and a deadline on somebody else's promise. */

/*
 * Resolves after `ms`, or at once when the signal is raised. An abort ends the wait rather than
 * failing it: every caller here is a loop that checks the signal itself on the next turn, and a
 * rejection would only be caught and thrown away.
 */
export const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true }
        );
    });

/*
 * The promise, or `message` when it takes longer than `ms`. The timer is cleared either way, so a
 * call that answers at once does not hold the process for the rest of its deadline.
 */
export const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (e: unknown) => {
                clearTimeout(timer);
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        );
    });

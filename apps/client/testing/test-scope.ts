import { afterEach, beforeEach } from 'bun:test';

/*
 * Bun lets a test that ran out of time go on beside the tests after it. Its next `act()` would overlap
 * theirs, which leaves React's act scope deeper than zero for the rest of the run, so nothing drawn after
 * it lands. And a window it opened but never closed stays in the page, under every later query. So
 * between tests, whatever the end of the last one, what it still waited on settles and what it opened closes.
 *
 * Without imports of its own: the DOM run's preload loads it before React (`dom-preload.ts`).
 */

let generation = 0;
let waiting: Promise<unknown> | null = null;
const open = new Set<() => Promise<void> | void>();

/* The test now running, for a wait to tell whether its own test is still the one running. */
export function currentTest(): number {
    return generation;
}

/* A turn of a wait in its test, which the test's end lets finish first. */
export async function waitTurn<T>(turn: PromiseLike<T>): Promise<T> {
    const settled = Promise.resolve(turn);
    waiting = settled;
    try {
        return await settled;
    } finally {
        if (waiting === settled) {
            waiting = null;
        }
    }
}

/* Closes `close` after the test that opened it, once, unless the test closed it first through what this returns. */
export function closedAfterTest(close: () => Promise<void> | void): () => Promise<void> {
    let closed: Promise<void> | null = null;
    const once = (): Promise<void> => {
        open.delete(once);
        closed ??= Promise.resolve(close());
        return closed;
    };
    open.add(once);
    return once;
}

async function settle(): Promise<void> {
    generation++;
    await waiting?.catch(() => undefined);
    for (const close of [...open].reverse()) {
        await close();
    }
}

// Bun skips the preload's `afterEach` once a test file's own throws, so the next test settles first as well.
afterEach(settle);
beforeEach(settle);

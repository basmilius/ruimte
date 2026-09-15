// Kept apart from `rate-limit.ts` and free of Workers types, so the tests read the same numbers the Worker counts with.

export const WINDOW_MS = 60_000;

/*
 * Requests per minute for the routes that sign, mint or verify something. A person signs in once and
 * asks for a statement per connection attempt, and the daemon's reconnect loop tops out at one attempt
 * per 10 seconds, so these are only ever met by a script.
 */
export const LIMITS = {
    loginIp: 20,
    sessionIp: 30,
    registerAccount: 20,
    registerIp: 30,
    statementAccount: 30,
    statementIp: 60,
    // A terminal starts one link per `ruimte login` and polls every five seconds; a person types a code a few times.
    deviceStartIp: 10,
    devicePollIp: 60,
    deviceCodeAccount: 20,
    deviceCodeIp: 30
} as const;

export const windowStartOf = (now: number): number => now - (now % WINDOW_MS);

// Whole seconds until the window `now` falls in ends, rounded up so a client that waits them is never early.
export const retryAfterSeconds = (now: number): number => Math.ceil((windowStartOf(now) + WINDOW_MS - now) / 1000);

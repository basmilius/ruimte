// Kept apart from `rate-limit.ts` and free of Workers types, so the tests read the same numbers the Worker counts with.

// The platform's limiter knows only 10 and 60 seconds; every limit here is per minute.
export const PERIOD_SECONDS = 60;

/*
 * Requests per minute for the routes that sign, mint or verify something. A person signs in once and
 * asks for a statement per connection attempt, and the daemon's reconnect loop tops out at one attempt
 * per 10 seconds, so these are only ever met by a script.
 */
export const LIMITS = {
    loginIp: 20,
    sessionIp: 30,
    // A person adds a provider once; a few tries cover a cancelled browser.
    linkAccount: 10,
    // A person deletes an account once; a few tries cover a name typed wrong.
    deleteAccount: 5,
    registerAccount: 20,
    registerIp: 30,
    statementAccount: 30,
    statementIp: 60,
    // A person links a machine to another once; a few tries cover a machine that was away.
    peerStatementAccount: 10,
    peerStatementIp: 20,
    // A terminal starts one link per `ruimte login` and polls every five seconds; a person types a code a few times.
    deviceStartIp: 10,
    devicePollIp: 60,
    deviceCodeAccount: 20,
    deviceCodeIp: 30,
    // A ticket lasts an hour and a client asks again a few minutes before it ends, so only a script meets these.
    mapsTicketAccount: 10,
    mapsTicketIp: 30,
    // A machine pushes per turn and a Live Activity per update; a session registers its device on every launch.
    pushRegisterSession: 20,
    pushDeviceSession: 60,
    pushIp: 240,
    pushMachine: 120,
    pushHandle: 60
} as const;

export interface RateLimiter {
    limit(options: { key: string }): Promise<{ success: boolean }>;
}

/*
 * A binding counts against one fixed limit, so every distinct number above has its own binding,
 * `RATE_LIMIT_<limit>` in `wrangler.jsonc`, and the bucket in the key keeps the routes apart.
 */
export type RateLimitValue = (typeof LIMITS)[keyof typeof LIMITS];
export type RateLimitBinding = `RATE_LIMIT_${RateLimitValue}`;

export function rateLimitBindingOf(limit: RateLimitValue): RateLimitBinding {
    return `RATE_LIMIT_${limit}`;
}

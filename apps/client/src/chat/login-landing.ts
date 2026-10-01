import type { ProviderAccountStatus } from '@ruimte/contracts';

/* What the CLI said, without the moment it said it, which a recheck moves without anything changing. */
const reading = (status: ProviderAccountStatus): string => JSON.stringify({ ...status, checkedAt: 0 });

/*
 * Whether a login in progress has landed: the account reads logged in, and not the way it read before
 * the login started. Logging in again to an account that already was only lands once the CLI tells
 * something new, such as another email; until then the person closes the terminal.
 */
export const loginLanded = (before: ProviderAccountStatus | null, now: ProviderAccountStatus | null): boolean =>
    now?.state === 'ready' && (before === null || reading(before) !== reading(now));

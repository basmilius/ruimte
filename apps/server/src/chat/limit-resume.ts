import type { ChatItem, ChatTurnItem, ChatTurnLimit } from '@ruimte/contracts';

/* How long the daemon waits before each next try of a turn that stopped on a limit; one more limited turn in a row than there are delays is an error like any other. */
export const LIMIT_RETRY_DELAYS_MS: readonly number[] = [60_000, 5 * 60_000, 15 * 60_000];

/* The last turn of a thread, when it stopped on a limit. */
export const limitedTurn = (items: readonly ChatItem[]): (ChatTurnItem & { limit: ChatTurnLimit }) | null => {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]!;
        if (item.kind === 'turn') {
            return item.state === 'error' && item.limit !== undefined ? (item as ChatTurnItem & { limit: ChatTurnLimit }) : null;
        }
    }
    return null;
};

/* How many turns in a row, up to and including this one, stopped on a limit: the tries a person did not step in between. */
const limitedInARow = (items: readonly ChatItem[], turn: ChatTurnItem): number => {
    let count = 0;
    let seen = false;
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]!;
        if (item.kind !== 'turn') {
            continue;
        }
        seen ||= item.id === turn.id;
        if (!seen) {
            continue;
        }
        if (item.state !== 'error' || item.limit === undefined) {
            break;
        }
        count += 1;
    }
    return count;
};

/*
 * When the daemon takes a limited turn up again, or null when it does not: a usage limit at its reset
 * and an overload after 1, 5 and 15 minutes. A usage limit that holds past its reset waits those too,
 * so a reset the plan did not keep never turns into a loop.
 */
export const limitResumeAt = (items: readonly ChatItem[], turn: ChatTurnItem, now: number): number | null => {
    if (turn.state !== 'error' || turn.limit === undefined) {
        return null;
    }
    const tries = limitedInARow(items, turn);
    const delay = LIMIT_RETRY_DELAYS_MS[tries - 1];
    if (delay === undefined) {
        return null;
    }
    if (turn.limit.kind === 'overload') {
        return now + delay;
    }
    if (turn.limit.resetsAt === undefined) {
        return null;
    }
    return tries === 1 ? turn.limit.resetsAt : Math.max(turn.limit.resetsAt, now + delay);
};

/* The turn the daemon opens to take a limited one up again: what the CLI is told, and what a person reads above it. */
export const limitResumeWake = (kind: ChatTurnLimit['kind']): { text: string; label: string; note: string } =>
    kind === 'usage'
        ? {
              text: 'Your previous turn stopped on a usage limit, which has reset now. Continue where you left off.',
              label: 'Usage limit reset',
              note: 'Resumed after the usage limit reset'
          }
        : {
              text: 'Your previous turn stopped because the model was overloaded. Continue where you left off.',
              label: 'Overloaded model',
              note: 'Tried again after the model was overloaded'
          };

import type { UsageWindow } from '@ruimte/contracts';

const MINUTE_MS = 60_000;

/* What the push of a chat stopped on its plan's usage limit says about the account and its plan. */
export interface LimitContext {
    providerName: string;
    accountLabel: string;
    windows: readonly UsageWindow[];
    /* Whether the daemon takes the chat up again once the limit lifts, so nothing waits on the person. */
    resumes: boolean;
}

/* The window that ran out: the one that resets with the limit, else one used up, else none the reads know of. */
export function limitWindow(windows: readonly UsageWindow[], resetsAt: number | undefined): UsageWindow | null {
    const byReset =
        resetsAt === undefined ? undefined : windows.find((window) => window.resetsAt !== null && Math.abs(window.resetsAt - resetsAt) <= MINUTE_MS);

    return byReset ?? windows.find((window) => window.used >= 1) ?? null;
}

/* "Codex (Blis): weekly limit reached." The daemon writes no time, which the device words in its own language and region. */
export function limitBody(context: LimitContext | null, window: UsageWindow | null): string {
    const what = window === null || window.kind === 'other' ? 'usage limit reached.' : `${window.kind} limit reached.`;

    if (context === null) {
        return `${what.charAt(0).toUpperCase()}${what.slice(1)}`;
    }

    const name = context.accountLabel === context.providerName ? context.providerName : `${context.providerName} (${context.accountLabel})`;

    return `${name}: ${what}`;
}

/* One limit of one account, so every chat that stops on it raises a single push. */
export function limitKey(provider: string, account: string, resetsAt: number | undefined): string {
    return `${provider}:${account}:${resetsAt === undefined ? '-' : Math.round(resetsAt / MINUTE_MS)}`;
}

import type { AgentKind, ProviderAccounts, UsageLimitsProvider, UsageLimitsSnapshot, UsageWindow } from '@ruimte/contracts';
import { accountsOfKind, type AccountEntry } from '@/agents/accounts';

/* The account a plan entry is of; an entry from a machine before accounts is its CLI's default account. */
export const limitsAccountId = (entry: UsageLimitsProvider): string => entry.account?.id ?? entry.kind;

export const limitsOfAccount = (snapshot: UsageLimitsSnapshot | null, id: string): UsageLimitsProvider | null =>
    snapshot?.providers.find((entry) => limitsAccountId(entry) === id) ?? null;

export const sessionWindow = (entry: UsageLimitsProvider | null): UsageWindow | null => entry?.windows.find((window) => window.kind === 'session') ?? null;

/* The numbers were read, and no window of the plan is spent. An account never read has no known room. */
const hasRoom = (entry: UsageLimitsProvider | null): entry is UsageLimitsProvider =>
    entry !== null && entry.checkedAt > 0 && entry.unavailable === null && entry.windows.length > 0 && entry.windows.every((window) => window.used < 1);

/* What a turn of this account would run into first: its session window, else its fullest one. */
const pressure = (entry: UsageLimitsProvider): number => sessionWindow(entry)?.used ?? Math.max(...entry.windows.map((window) => window.used));

/* The other accounts of the CLI a chat could go on under right now: on, and signed in. */
const others = (accounts: ProviderAccounts | null, kind: AgentKind, current: string | undefined): AccountEntry[] =>
    accountsOfKind(accounts, kind).filter((entry) => entry.id !== (current ?? kind) && entry.account.enabled !== false && entry.status?.state === 'ready');

/*
 * The account a chat that stopped on a limit could go on under: another one of its CLI that is on,
 * signed in and has room, the one with the least of its session spent. Null when none has room, or
 * none was read yet; the choice is only ever offered, never made.
 */
export const continueTarget = (
    accounts: ProviderAccounts | null,
    snapshot: UsageLimitsSnapshot | null,
    kind: AgentKind,
    current: string | undefined
): AccountEntry | null => {
    const roomy = others(accounts, kind, current).flatMap((entry) => {
        const limits = limitsOfAccount(snapshot, entry.id);
        return hasRoom(limits) ? [{ entry, pressure: pressure(limits) }] : [];
    });
    roomy.sort((a, b) => a.pressure - b.pressure);
    return roomy[0]?.entry ?? null;
};

/* Whether another account a chat could go on under has no numbers yet, since the machine only reads one in use by itself. */
export const hasUnreadAccount = (
    accounts: ProviderAccounts | null,
    snapshot: UsageLimitsSnapshot | null,
    kind: AgentKind,
    current: string | undefined
): boolean => others(accounts, kind, current).some((entry) => (limitsOfAccount(snapshot, entry.id)?.checkedAt ?? 0) === 0);

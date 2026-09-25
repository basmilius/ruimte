import i18next from 'i18next';
import {
    USAGE_PROVIDERS,
    type ProviderAccounts,
    type ProviderAccountStatus,
    type UsageLimitsProvider,
    type UsageLimitsSnapshot,
    type UsageProvider,
    type UsageWindow
} from '@ruimte/contracts';
import { limitsAccountId } from '@/agents/account-limits';
import { accountName, accountsOfKind, accountStatusLine } from '@/agents/accounts';
import { formatDuration } from '@/format/duration';
import { PROVIDER_LABELS } from '@/shell/usage/format';

const MINUTE = 60_000;

/* One account of a CLI as the limits draw it. */
export interface LimitAccount {
    id: string;
    kind: UsageProvider;
    name: string;
    color: string | undefined;
    /* Null for an account the machine does not read, which is one that is not signed in. */
    entry: UsageLimitsProvider | null;
    /* Null for a machine from before accounts, and for an account the machine has not described yet. */
    status: ProviderAccountStatus | null;
}

export interface LimitGroup {
    kind: UsageProvider;
    accounts: LimitAccount[];
}

/*
 * The plan numbers per CLI, one row per account. The machine only reads an account that is signed in,
 * so an account that is on but signed out comes from the account list, where it can say why it has
 * no numbers. An account that is off is left out, unless the machine still reads it (a CLI's default).
 */
export const limitGroups = (snapshot: UsageLimitsSnapshot, accounts: ProviderAccounts | null): LimitGroup[] =>
    USAGE_PROVIDERS.flatMap((kind) => {
        const known = accountsOfKind(accounts, kind);
        const read = snapshot.providers
            .filter((entry) => entry.kind === kind)
            .map((entry): LimitAccount => {
                const id = limitsAccountId(entry);
                const account = known.find((each) => each.id === id);
                return {
                    id,
                    kind,
                    name: account === undefined ? (entry.account?.label ?? PROVIDER_LABELS[kind]) : accountName(account, PROVIDER_LABELS[kind]),
                    color: account === undefined ? entry.account?.color : account.account.color,
                    entry,
                    status: account?.status ?? null
                };
            });
        const unread = known
            .filter((account) => account.account.enabled !== false && !read.some((row) => row.id === account.id))
            .map((account): LimitAccount => ({
                id: account.id,
                kind,
                name: accountName(account, PROVIDER_LABELS[kind]),
                color: account.account.color,
                entry: null,
                status: account.status
            }));
        const rows = [...read, ...unread];
        return rows.length === 0 ? [] : [{ kind, accounts: rows }];
    });

/* Whether any CLI has more than one account, which is when the limits name the account of every row. */
export const hasSeveralAccounts = (groups: readonly LimitGroup[]): boolean => groups.some((group) => group.accounts.length > 1);

export const isSignedOut = (account: LimitAccount): boolean => account.status?.state === 'signed-out';

/* The window that resets first from now, the one reset a line per window has no room to repeat. */
export const nextReset = (windows: readonly UsageWindow[], now: number): (UsageWindow & { resetsAt: number }) | null => {
    let next: (UsageWindow & { resetsAt: number }) | null = null;
    for (const window of windows) {
        if (window.resetsAt !== null && window.resetsAt > now && (next === null || window.resetsAt < next.resetsAt)) {
            next = { ...window, resetsAt: window.resetsAt };
        }
    }
    return next;
};

/* When the numbers came in and from where: a read of the machine's own, or a turn that reported them. Null before the first read. */
export const checkedLabel = (entry: UsageLimitsProvider, now: number): string | null => {
    if (entry.checkedAt <= 0) {
        return null;
    }
    const past = now - entry.checkedAt;
    const when = past < MINUTE ? i18next.t('usage:limits.checked.now') : i18next.t('usage:limits.checked.ago', { duration: formatDuration(past) });
    return entry.source === 'event' ? i18next.t('usage:limits.checked.fromTurn', { when }) : when;
};

/* Why a read account has no bars, or null when it has them. */
export const explain = (provider: UsageLimitsProvider): string | null => {
    if (provider.unavailable === null) {
        return provider.windows.length === 0 ? i18next.t('usage:limits.none') : null;
    }
    if (provider.unavailable.reason === 'not-installed') {
        return i18next.t('usage:limits.notInstalled');
    }
    if (provider.unavailable.reason === 'no-subscription') {
        return i18next.t('usage:limits.noSubscription');
    }
    return provider.unavailable.message ?? i18next.t('usage:limits.unreachable');
};

/* Why an account has no bars, or null when it has them. An account the machine does not read says what its login is doing. */
export const accountNote = (account: LimitAccount): string | null =>
    account.entry === null ? accountStatusLine(account.status, true).text : explain(account.entry);

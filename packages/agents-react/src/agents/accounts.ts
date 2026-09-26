import i18next from 'i18next';
import type { AgentKind, ProviderAccount, ProviderAccounts, ProviderAccountStatus } from '@ruimte/agent-contracts';
import { chatHost } from '../host';

/*
 * An account wears one of the host's accents, so the app paints from one palette. A color that is none
 * of them (an older name, or one written by hand) reads as undefined, and the dot takes the accent.
 */
export const accountColor = (color: string | undefined): string | undefined => chatHost().accents.all.find((entry) => entry.id === color)?.color;

/*
 * The variable each CLI reads its config folder from, as the daemon's providers name them. Only for
 * the sentence under the folder; a CLI missing here still works, the sentence just does not name it.
 */
export const FOLDER_VARIABLES: Partial<Record<AgentKind, string>> = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' };

export interface AccountEntry {
    id: string;
    account: ProviderAccount;
    status: ProviderAccountStatus | null;
    /* The account under the CLI's own id, in the CLI's own folder. */
    isDefault: boolean;
}

/* The accounts of one CLI, its default one first and the others in the order the machine keeps them. */
export const accountsOfKind = (accounts: ProviderAccounts | null, kind: AgentKind): AccountEntry[] => {
    if (accounts === null) {
        return [];
    }
    const statuses = new Map(accounts.statuses.map((status) => [status.id, status]));
    return Object.entries(accounts.accounts)
        .filter(([, account]) => account.kind === kind)
        .map(([id, account]) => ({ id, account, status: statuses.get(id) ?? null, isDefault: id === kind }))
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
};

/* A default account nobody named goes by its CLI's name. */
export const accountName = (entry: Pick<AccountEntry, 'id' | 'account' | 'isDefault'>, providerName: string): string =>
    entry.account.label ?? (entry.isDefault ? providerName : entry.id);

export type AccountTone = 'muted' | 'needs-you' | 'error';

export const ACCOUNT_TONE_CLASSES: Record<AccountTone, string> = {
    muted: 'text-text-muted',
    'needs-you': 'text-status-needs-you',
    error: 'text-status-error'
};

/*
 * What an account's row says about it, in a few words. `canLogIn` is false for a CLI without a config
 * folder: it has no login of its own to report, so being there is all a ready one says.
 */
export const accountStatusLine = (status: ProviderAccountStatus | null, canLogIn: boolean): { text: string; tone: AccountTone } => {
    const words = (key: string, values?: Record<string, string>): string => i18next.t(`agent-providers:status.${key}`, values);
    switch (status?.state ?? 'checking') {
        case 'checking':
            return { text: words('checking'), tone: 'muted' };
        case 'disabled':
            return { text: words('disabled'), tone: 'muted' };
        case 'not-found':
            return { text: words('notFound'), tone: 'muted' };
        case 'signed-out':
            return { text: words('signedOut'), tone: 'needs-you' };
        case 'ready':
            if (!canLogIn) {
                return { text: words('available'), tone: 'muted' };
            }
            return { text: status?.plan ? words('readyPlan', { plan: status.plan }) : words('ready'), tone: 'muted' };
        case 'folder-missing':
            return { text: words('folderMissing'), tone: 'error' };
        case 'unavailable':
            return { text: words('unavailable'), tone: 'muted' };
        case 'failed':
            return { text: words('failed'), tone: 'error' };
    }
};

/* The part of a name an id can hold, the way the machine makes one: `Work (EU)` becomes `work-eu`. */
const slugOf = (label: string): string =>
    label
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

/* A free id for an account a person links to a folder of their own; one the machine makes gets its id from the machine. */
export const mintAccountId = (kind: AgentKind, label: string, taken: ReadonlySet<string>): string => {
    const base = `${kind}_${slugOf(label) || 'account'}`.slice(0, 60).replace(/-+$/, '');
    let id = base;
    for (let suffix = 2; taken.has(id); suffix += 1) {
        id = `${base}-${suffix}`;
    }
    return id;
};

/*
 * The first featured accent no account of the CLI wears yet, then any other, so a new one stands apart.
 * An account without a color of its own wears `fallback`, the accent the app is painted in.
 */
export const freeAccountColor = (entries: readonly AccountEntry[], fallback: string): string => {
    const { all, featured } = chatHost().accents;
    const worn = new Set(entries.map((entry) => (accountColor(entry.account.color) === undefined ? fallback : entry.account.color)));
    const choices = [...featured, ...all.map((entry) => entry.id).filter((id) => !featured.includes(id))];
    return choices.find((id) => !worn.has(id)) ?? featured[entries.length % featured.length] ?? fallback;
};

/* The accounts of a CLI a picker offers: every one that is on, and the one in use even while it is off. */
export const offeredAccounts = (entries: readonly AccountEntry[], current: string | undefined): AccountEntry[] =>
    entries.filter((entry) => entry.account.enabled !== false || entry.id === current);

/* Whether a person has a choice of account for this CLI at all, which is when a chat shows its account. */
export const hasAccountChoice = (entries: readonly AccountEntry[]): boolean => entries.filter((entry) => entry.account.enabled !== false).length >= 2;

/*
 * Whether a chat of one account can go on under another, the way the machine decides it: the same
 * account, or two of the chat's CLI that write their conversations to one folder. A machine that does
 * not say where an account writes them answers no, so the person forks instead of being refused.
 */
export const canContinueOn = (accounts: ProviderAccounts | null, kind: AgentKind, from: string | undefined, to: string | undefined): boolean => {
    const fromId = from ?? kind;
    const toId = to ?? kind;
    if (fromId === toId) {
        return true;
    }
    const folderOf = (id: string): string | undefined =>
        accounts?.accounts[id]?.kind === kind ? accounts.statuses.find((status) => status.id === id)?.transcripts : undefined;
    const folder = folderOf(fromId);
    return folder !== undefined && folder !== '' && folder === folderOf(toId);
};

import i18next from 'i18next';
import type { AgentKind, ProviderAccount, ProviderAccounts, ProviderAccountStatus } from '@ruimte/contracts';

/* The swatches an account can wear, which are the drawing colors, so a dot reads the same in both themes. */
export const ACCOUNT_COLORS = ['blue', 'purple', 'green', 'orange', 'pink'] as const;
export type AccountColor = (typeof ACCOUNT_COLORS)[number];

// Written out whole, since Tailwind only generates a class it finds as a literal.
const DOT_CLASSES: Record<string, string> = {
    blue: 'bg-draw-blue',
    purple: 'bg-draw-purple',
    green: 'bg-draw-green',
    orange: 'bg-draw-orange',
    pink: 'bg-draw-pink',
    // The note colors an account written by hand may name.
    yellow: 'bg-draw-yellow',
    gray: 'bg-draw-muted'
};

export const accountDotClass = (color: string | undefined): string => DOT_CLASSES[color ?? ''] ?? 'bg-draw-muted';

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
    const words = (key: string, values?: Record<string, string>): string => i18next.t(`settings:providers.status.${key}`, values);
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

/* The first swatch no account of the CLI wears yet, so a new one stands apart from the others. */
export const freeAccountColor = (entries: readonly AccountEntry[]): AccountColor => {
    const worn = new Set(entries.map((entry) => entry.account.color));
    return ACCOUNT_COLORS.find((color) => !worn.has(color)) ?? ACCOUNT_COLORS[entries.length % ACCOUNT_COLORS.length]!;
};

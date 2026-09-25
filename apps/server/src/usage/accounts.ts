import {
    USAGE_PROVIDERS,
    type AgentInfo,
    type AgentLaunch,
    type ChatInfo,
    type ProviderAccounts,
    type UsageAccount,
    type UsageProvider
} from '@ruimte/contracts';
import { definedEnv } from '../providers/accounts/launch.ts';
import type { ProviderAccountsService } from '../providers/accounts/service.ts';
import type { LimitAccount, LimitAccounts } from './limits/monitor.ts';
import { accountRoots, type UsageRootPath } from './roots.ts';

const isUsageProvider = (kind: string): kind is UsageProvider => (USAGE_PROVIDERS as readonly string[]).includes(kind);

interface MachineAccount extends UsageAccount {
    isDefault: boolean;
    enabled: boolean;
    signedIn: boolean;
}

/* The accounts of the CLIs whose usage the daemon reads; a default account nobody named is called after its CLI. */
export const machineAccounts = (snapshot: ProviderAccounts, nameOf: (kind: UsageProvider) => string): MachineAccount[] =>
    Object.entries(snapshot.accounts).flatMap(([id, account]) => {
        if (!isUsageProvider(account.kind)) {
            return [];
        }
        const isDefault = id === account.kind;
        const state = snapshot.statuses.find((status) => status.id === id)?.state;
        return [
            {
                id,
                kind: account.kind,
                label: account.label ?? (isDefault ? nameOf(account.kind) : id),
                ...(account.color === undefined ? {} : { color: account.color }),
                isDefault,
                enabled: account.enabled !== false,
                signedIn: state === 'ready'
            }
        ];
    });

const usageAccount = ({ id, kind, label, color }: MachineAccount): UsageAccount => ({ id, kind, label, ...(color === undefined ? {} : { color }) });

/* What the usage page may filter by: every account, whether it is on or signed in or not, since what it spent still counts. */
export const usageAccountsOf = (service: ProviderAccountsService, nameOf: (kind: UsageProvider) => string): UsageAccount[] =>
    machineAccounts(service.snapshot(), nameOf).map(usageAccount);

/* The transcripts of every account the machine has. */
export const usageRootsOf = (service: ProviderAccountsService): UsageRootPath[] =>
    accountRoots(
        Object.entries(service.snapshot().accounts).flatMap(([id, { kind }]) => {
            if (!isUsageProvider(kind)) {
                return [];
            }
            const folder = service.transcriptFolder(kind, id);
            return folder === null || folder === '' ? [] : [{ id, kind, folder }];
        })
    );

/* The plans the limits monitor reads: the default account of every CLI, and every other one that is on and signed in. */
export const limitAccountsOf = (
    service: ProviderAccountsService,
    nameOf: (kind: UsageProvider) => string,
    baseEnv: Record<string, string | undefined>
): LimitAccounts => ({
    list: () =>
        machineAccounts(service.snapshot(), nameOf)
            .filter((account) => account.isDefault || (account.enabled && account.signedIn))
            .map((account): LimitAccount => ({ ...usageAccount(account), isDefault: account.isDefault })),
    envFor: (kind, id) => definedEnv(service.envFor(kind, id, baseEnv)),
    lastUsedAt: (id) => service.lastLaunchAt(id)
});

/* The account every CLI session a chat or a terminal here ran was under, by `<provider>\0<sessionId>`, for the transcripts accounts share. */
export const sessionAccountsOf = (
    chats: ReadonlyArray<Pick<ChatInfo, 'provider' | 'agentSessionId' | 'account'>>,
    terminals: ReadonlyArray<{ agent: AgentInfo | null; launch: AgentLaunch | null }>
): Map<string, string> => {
    const known = new Map<string, string>();
    for (const chat of chats) {
        if (chat.agentSessionId !== null) {
            known.set(`${chat.provider}\0${chat.agentSessionId}`, chat.account ?? chat.provider);
        }
    }
    for (const { agent, launch } of terminals) {
        if (agent !== null && launch !== null && launch.kind === agent.kind) {
            known.set(`${agent.kind}\0${agent.agentSessionId}`, launch.account ?? agent.kind);
        }
    }
    return known;
};

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProviderAccountIdSchema, ProviderAccountSchema, type AgentKind, type ProviderAccount, type ProviderAccountMap } from '@ruimte/agent-contracts';
import { CodedError } from '../../coded-error.ts';
import { isNotFound, writeAtomic } from '../../fs.ts';
import type { ChatProvider } from '../provider.ts';
import {
    accountFolder,
    accountProblem,
    defaultFolder,
    expandHome,
    folderVariablesOf,
    isDefaultAccount,
    isKnownKind,
    readAccount,
    withDefaults,
    type Env
} from './accounts.ts';
import { DEFAULT_ACCOUNTS_HOST, redactVariables, type AccountsHost } from './variables.ts';

const FILE_VERSION = 1;

export const accountsPath = (home: string): string => join(home, 'providers.json');

/*
 * The accounts as the file holds them. A known kind is a parsed account; an unknown one is the entry
 * exactly as it was read, so a newer version's fields survive this one writing the file.
 */
export type StoredAccounts = Record<string, unknown>;

/* Every entry that does not parse is dropped on its own; a file that is not JSON at all reads as none. */
export const readAccounts = async (
    path: string,
    providerOf: (kind: AgentKind) => ChatProvider,
    env: Env,
    host: AccountsHost = DEFAULT_ACCOUNTS_HOST
): Promise<StoredAccounts> => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
        if (isNotFound(e) || e instanceof SyntaxError) {
            return {};
        }
        throw e;
    }
    const entries = typeof parsed === 'object' && parsed !== null ? (parsed as { accounts?: unknown }).accounts : null;
    if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
        return {};
    }
    const stored: StoredAccounts = {};
    for (const [id, raw] of Object.entries(entries)) {
        if (!ProviderAccountIdSchema.safeParse(id).success) {
            continue;
        }
        const account = readAccount(id, raw, providerOf, env, host);
        if (account !== null) {
            stored[id] = account;
        }
    }
    return stored;
};

export const writeAccounts = async (path: string, stored: StoredAccounts): Promise<void> => {
    await writeAtomic(path, `${JSON.stringify({ version: FILE_VERSION, accounts: stored }, null, 2)}\n`, 0o600);
};

/* What a client reads of an entry of a kind it may not know either: the fields this version knows. */
const wireAccount = (entry: unknown): ProviderAccount => {
    const parsed = ProviderAccountSchema.safeParse(entry);
    if (!parsed.success) {
        return { kind: String((entry as { kind?: unknown }).kind) };
    }
    return parsed.data.env === undefined ? parsed.data : { ...parsed.data, env: redactVariables(parsed.data.env) };
};

export const wireAccounts = (stored: StoredAccounts): ProviderAccountMap =>
    withDefaults(Object.fromEntries(Object.entries(stored).map(([id, entry]) => [id, wireAccount(entry)])));

export class InvalidAccountError extends CodedError<'invalid-account'> {
    constructor(message: string) {
        super('invalid-account', message);
    }
}

const storedFolders = (entry: unknown): Pick<ProviderAccount, 'home' | 'shadowHome'> => {
    const parsed = ProviderAccountSchema.safeParse(entry);
    return parsed.success ? { home: parsed.data.home, shadowHome: parsed.data.shadowHome } : {};
};

/*
 * What is wrong with the folders of an account a person points somewhere new, or null. An account
 * whose folders did not change is left alone, so one whose folder went missing can still be renamed.
 */
const linkProblem = (
    id: string,
    account: ProviderAccount,
    before: unknown,
    provider: ChatProvider,
    env: Env,
    isDirectory: (path: string) => boolean
): string | null => {
    if (isDefaultAccount(id, account) || provider.home === undefined || account.home === undefined) {
        return null;
    }
    const was = storedFolders(before);
    if (was.home === account.home && was.shadowHome === account.shadowHome) {
        return null;
    }
    for (const folder of [account.home, account.shadowHome]) {
        if (folder !== undefined && !isDirectory(expandHome(folder, env))) {
            return `${folder} is not a folder on this machine`;
        }
    }
    if (accountFolder(id, account, provider, env) === defaultFolder(provider, env)) {
        return `${defaultFolder(provider, env)} is the folder of the default ${provider.name} account`;
    }
    return null;
};

/*
 * The whole map a person saved, as the file will hold it. A mistake in an account of a known kind
 * refuses the save; an account of an unknown kind keeps the entry the file had under its id, which a
 * client that knows the kind no better than this host could only have cut short. Sensitive values
 * are still in it: the caller puts them in the keychain before the file is written.
 */
export const acceptAccounts = (
    saved: ProviderAccountMap,
    before: StoredAccounts,
    providerOf: (kind: AgentKind) => ChatProvider,
    env: Env,
    isDirectory: (path: string) => boolean,
    host: AccountsHost = DEFAULT_ACCOUNTS_HOST
): StoredAccounts => {
    const stored: StoredAccounts = {};
    const reserved = { host, folderVariables: folderVariablesOf(providerOf) };
    for (const [id, account] of Object.entries(withDefaults(saved))) {
        if (!isKnownKind(account.kind)) {
            if (isKnownKind(id)) {
                throw new InvalidAccountError(`"${id}" is the id of the default ${id} account`);
            }
            const kept = before[id];
            const keptKind = typeof kept === 'object' && kept !== null ? (kept as { kind?: unknown }).kind : undefined;
            stored[id] = keptKind === account.kind ? kept : account;
            continue;
        }
        const provider = providerOf(account.kind);
        const problem = accountProblem(id, account, provider, env, reserved) ?? linkProblem(id, account, before[id], provider, env, isDirectory);
        if (problem !== null) {
            throw new InvalidAccountError(`${id}: ${problem}`);
        }
        stored[id] = account;
    }
    return stored;
};

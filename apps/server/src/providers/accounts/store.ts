import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProviderAccountIdSchema, ProviderAccountSchema, type AgentKind, type ProviderAccount, type ProviderAccountMap } from '@ruimte/contracts';
import { CodedError } from '../../coded-error.ts';
import { isNotFound, writeAtomic } from '../../fs.ts';
import type { ChatProvider } from '../provider.ts';
import { accountProblem, isKnownKind, readAccount, withDefaults, type Env } from './accounts.ts';

const FILE_VERSION = 1;

export const accountsPath = (ruimteHome: string): string => join(ruimteHome, 'providers.json');

/*
 * The accounts as the file holds them. A known kind is a parsed account; an unknown one is the entry
 * exactly as it was read, so a newer version's fields survive this one writing the file.
 */
export type StoredAccounts = Record<string, unknown>;

/* Every entry that does not parse is dropped on its own; a file that is not JSON at all reads as none. */
export const readAccounts = async (path: string, providerOf: (kind: AgentKind) => ChatProvider, env: Env): Promise<StoredAccounts> => {
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
        const account = readAccount(id, raw, providerOf, env);
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
    return parsed.success ? parsed.data : { kind: String((entry as { kind?: unknown }).kind) };
};

export const wireAccounts = (stored: StoredAccounts): ProviderAccountMap =>
    withDefaults(Object.fromEntries(Object.entries(stored).map(([id, entry]) => [id, wireAccount(entry)])));

export class InvalidAccountError extends CodedError<'invalid-account'> {
    constructor(message: string) {
        super('invalid-account', message);
    }
}

/*
 * The whole map a person saved, as the file will hold it. A mistake in an account of a known kind
 * refuses the save; an account of an unknown kind keeps the entry the file had under its id, which a
 * client that knows the kind no better than this daemon could only have cut short.
 */
export const acceptAccounts = (saved: ProviderAccountMap, before: StoredAccounts, providerOf: (kind: AgentKind) => ChatProvider, env: Env): StoredAccounts => {
    const stored: StoredAccounts = {};
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
        const problem = accountProblem(id, account, providerOf(account.kind), env);
        if (problem !== null) {
            throw new InvalidAccountError(`${id}: ${problem}`);
        }
        stored[id] = account;
    }
    return stored;
};

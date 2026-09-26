import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { AgentKindSchema, ProviderAccountSchema, type AgentKind, type ProviderAccount, type ProviderAccountMap } from '@ruimte/agent-contracts';
import type { ChatProvider } from '../provider.ts';
import { DEFAULT_ACCOUNTS_HOST, variablesProblem, type AccountsHost, type ReservedVariables } from './variables.ts';

export type Env = Record<string, string | undefined>;

const KNOWN_KINDS: readonly string[] = AgentKindSchema.options;

export const isKnownKind = (kind: string): kind is AgentKind => KNOWN_KINDS.includes(kind);

/* The default account of a CLI is the folder the CLI uses without being told, and its id is the CLI's kind. */
export const isDefaultAccount = (id: string, account: Pick<ProviderAccount, 'kind'>): boolean => id === account.kind;

export const expandHome = (path: string, env: Env): string => {
    const home = env.HOME ?? homedir();
    if (path === '~') {
        return home;
    }
    if (path.startsWith('~/')) {
        return join(home, path.slice(2));
    }
    return resolve(path);
};

/* A folder the daemon can resolve the same way whatever folder it was started in. */
const isRootedPath = (path: string): boolean => path === '~' || path.startsWith('~/') || isAbsolute(path);

/*
 * What is wrong with an account of a CLI this version knows, or null when nothing is. An account of
 * an unknown kind is never judged: it is kept the way it was written, for a version that knows it.
 */
export const accountProblem = (
    id: string,
    account: ProviderAccount,
    provider: ChatProvider,
    env: Env,
    reserved: ReservedVariables = { host: DEFAULT_ACCOUNTS_HOST, folderVariables: [] }
): string | null => {
    if (isKnownKind(id) && id !== account.kind) {
        return `"${id}" is the id of the default ${id} account`;
    }
    const variables = variablesProblem(account.env ?? [], reserved);
    if (variables !== null) {
        return variables;
    }
    if (isDefaultAccount(id, account)) {
        return account.home !== undefined || account.shadowHome !== undefined ? 'The default account uses the folder of the CLI itself' : null;
    }
    if (provider.home === undefined) {
        return null;
    }
    if (account.home === undefined) {
        return 'An account needs a config folder';
    }
    if (!isRootedPath(account.home)) {
        return 'A config folder is an absolute path or starts with ~';
    }
    if (account.shadowHome === undefined) {
        return null;
    }
    if (account.kind !== 'codex') {
        return 'Only a Codex account has a shadow home';
    }
    if (!isRootedPath(account.shadowHome)) {
        return 'A shadow home is an absolute path or starts with ~';
    }
    if (expandHome(account.shadowHome, env) === expandHome(account.home, env)) {
        return 'The shadow home has to be another folder than the config folder';
    }
    return null;
};

/* The variables that point a CLI at its folder, which no account may set by hand. */
export const folderVariablesOf = (providerOf: (kind: AgentKind) => ChatProvider): string[] =>
    AgentKindSchema.options.flatMap((kind) => {
        const home = providerOf(kind).home;
        return home === undefined ? [] : [home.env];
    });

/* The map with a default account for every CLI this version knows, those first and in catalog order. */
export const withDefaults = (accounts: ProviderAccountMap): ProviderAccountMap => {
    const complete: ProviderAccountMap = {};
    for (const kind of KNOWN_KINDS) {
        complete[kind] = accounts[kind] ?? { kind };
    }
    for (const [id, account] of Object.entries(accounts)) {
        complete[id] ??= account;
    }
    return complete;
};

/* The folder the CLI itself falls back on, as the daemon's own environment sets it. */
export const defaultFolder = (provider: ChatProvider, env: Env): string => {
    if (provider.home === undefined) {
        return '';
    }
    return env[provider.home.env] ?? join(env.HOME ?? homedir(), provider.home.fallback);
};

/* The folder a CLI of this account is started with: for a Codex account with a shadow home, that one. */
export const accountFolder = (id: string, account: ProviderAccount, provider: ChatProvider, env: Env): string => {
    if (isDefaultAccount(id, account) || provider.home === undefined || account.home === undefined) {
        return defaultFolder(provider, env);
    }
    return expandHome(account.shadowHome ?? account.home, env);
};

/* Where the account's conversations are written, which a shadow home shares with its `home`. */
export const transcriptFolder = (id: string, account: ProviderAccount, provider: ChatProvider, env: Env): string => {
    if (isDefaultAccount(id, account) || provider.home === undefined || account.home === undefined) {
        return defaultFolder(provider, env);
    }
    return expandHome(account.home, env);
};

/*
 * The environment of a CLI process of this account. The default account runs in the daemon's own. Any
 * other gets its folder in the CLI's variable, and loses the variables that would sign the CLI in over
 * that folder's login: an inherited key would win, and only the bill would tell. Never HOME, which
 * moves where Claude Code looks in the keychain. The account's own variables come last, so a key a
 * person set there is the one that counts.
 */
export const accountEnv = (id: string, account: ProviderAccount, provider: ChatProvider, baseEnv: Env, variables: Record<string, string> = {}): Env => {
    const withVariables = (env: Env): Env => (Object.keys(variables).length === 0 ? env : { ...env, ...variables });
    if (isDefaultAccount(id, account) || provider.home === undefined || account.home === undefined) {
        return withVariables(baseEnv);
    }
    const env = { ...baseEnv };
    for (const name of provider.home.loginEnv) {
        delete env[name];
    }
    env[provider.home.env] = accountFolder(id, account, provider, baseEnv);
    return withVariables(env);
};

export interface NamedAccount {
    id: string;
    account: ProviderAccount;
}

/*
 * Whether a conversation of one account can go on under the other: the same CLI, reading the same
 * transcripts. Two Codex accounts over one `home` can, shadow home or not; two Claude folders never.
 */
export const canContinue = (from: NamedAccount, to: NamedAccount, providerOf: (kind: AgentKind) => ChatProvider, env: Env): boolean => {
    if (from.id === to.id) {
        return true;
    }
    const kind = from.account.kind;
    if (kind !== to.account.kind || !isKnownKind(kind)) {
        return false;
    }
    const provider = providerOf(kind);
    return transcriptFolder(from.id, from.account, provider, env) === transcriptFolder(to.id, to.account, provider, env);
};

/*
 * An account as the file holds it, or null for one to drop. An unknown kind comes back as it was
 * read, extra fields included; a known kind has to parse and make sense.
 */
export const readAccount = (
    id: string,
    raw: unknown,
    providerOf: (kind: AgentKind) => ChatProvider,
    env: Env,
    host: AccountsHost = DEFAULT_ACCOUNTS_HOST
): unknown => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return null;
    }
    const kind = (raw as { kind?: unknown }).kind;
    if (typeof kind !== 'string' || kind === '') {
        return null;
    }
    if (!isKnownKind(kind)) {
        return isKnownKind(id) ? null : raw;
    }
    const parsed = ProviderAccountSchema.safeParse(raw);
    if (!parsed.success || accountProblem(id, parsed.data, providerOf(kind), env, { host, folderVariables: folderVariablesOf(providerOf) }) !== null) {
        return null;
    }
    return parsed.data;
};

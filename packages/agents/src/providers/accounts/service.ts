import { existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
    AgentKindSchema,
    type AgentKind,
    type ProviderAccount,
    type ProviderAccountCreatePayload,
    type ProviderAccountCreateResult,
    type ProviderAccountMap,
    type ProviderAccounts,
    type ProviderAccountStatus,
    type ProviderAccountVariable,
    type ProviderInfo
} from '@ruimte/agent-contracts';
import { ClientSinks } from '../../client-sinks.ts';
import { errorText } from '../../error-text.ts';
import type { AgentEvent, AgentSink } from '../../events.ts';
import type { ChatProvider } from '../provider.ts';
import { accountEnv, accountFolder, canContinue, defaultFolder, expandHome, isDefaultAccount, isKnownKind, transcriptFolder, type Env } from './accounts.ts';
import { AccountError, isDefaultAccountOf, type AccountLaunches } from './launch.ts';
import { prepareShadowHome, type ShadowHomeReport } from './shadow-home.ts';
import { askAccountAs, type AskAccount } from './status.ts';
import { acceptAccounts, accountsPath, InvalidAccountError, readAccounts, wireAccounts, writeAccounts, type StoredAccounts } from './store.ts';
import { DEFAULT_ACCOUNTS_HOST, platformSecrets, secretKey, SecretsUnavailableError, type AccountsHost, type SecretStore } from './variables.ts';
import { DEFAULT_CODEX_CLIENT, type CodexClientInfo } from '../../chat/codex-transport.ts';

/* Who is signed in changes by hand and rarely; often enough to notice, rarely enough not to start CLIs all day. */
const CHECK_INTERVAL_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
// A login in a terminal is a browser round trip: quick enough to notice at once, and given up on after a while.
const LOGIN_POLL_MS = 3_000;
const LOGIN_WATCH_MS = 5 * 60_000;

export interface ProviderAccountsOptions {
    // The data folder: `providers.json`, and a folder per account the host makes.
    home: string;
    host?: AccountsHost;
    // How the host names itself to an app-server it asks who is signed in.
    client?: CodexClientInfo;
    providers: { list(): Promise<ProviderInfo[]>; get(kind: AgentKind): ChatProvider; enabled?(kind: AgentKind): boolean };
    env?: Env;
    // How to ask a CLI who is signed in; a test answers without starting one.
    ask?: AskAccount;
    prepareShadow?: (home: string, shadow: string) => Promise<ShadowHomeReport>;
    folderExists?: (path: string) => boolean;
    // What the host puts in a config folder of an account (its hooks); absent puts nothing there.
    install?: (kind: AgentKind, folder: string) => Promise<void>;
    // Where sensitive values are kept; null on a machine without a keychain. Absent is the platform's own.
    secrets?: SecretStore | null;
    now?: () => number;
    // How a login watch waits between two checks; a test moves its clock instead.
    sleep?: (ms: number) => Promise<void>;
}

interface LoginWatch {
    deadline: number;
    done: Promise<void>;
}

interface AccountState {
    status: ProviderAccountStatus;
    // The account as it was when this status was drawn, so a save that changes it asks again.
    drawnFor: string;
    backoffMs: number;
    nextAt: number;
}

// Asked on every start of a CLI under an account, which is one stat and never worth an await in the way of a spawn.
const isFolder = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;

const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms).unref();
    });

/* The part of a label an id can hold: `Work (EU)` becomes `work-eu`. */
const slugOf = (label: string): string =>
    label
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

const sensitiveNames = (entry: unknown): string[] => {
    const variables = typeof entry === 'object' && entry !== null ? (entry as { env?: unknown }).env : undefined;
    if (!Array.isArray(variables)) {
        return [];
    }
    return variables.flatMap((variable: unknown) => {
        const { name, sensitive } = (variable ?? {}) as { name?: unknown; sensitive?: unknown };
        return sensitive === true && typeof name === 'string' ? [name] : [];
    });
};

/* A status without the moment it was drawn, to tell whether anything a person reads changed. */
const sameStatus = (left: ProviderAccountStatus, right: ProviderAccountStatus): boolean =>
    JSON.stringify({ ...left, checkedAt: 0 }) === JSON.stringify({ ...right, checkedAt: 0 });

/*
 * The accounts of every agent CLI on this machine: the list a person keeps in `providers.json`, and
 * what each CLI says about who is signed in there. The list is the person's; the statuses are only
 * ever the CLI's answer, held in memory and asked again on a slow clock.
 */
export class ProviderAccountsService implements AccountLaunches {
    private readonly path: string;
    private readonly home: string;
    private readonly host: AccountsHost;
    private readonly providers: ProviderAccountsOptions['providers'];
    private readonly env: Env;
    private readonly ask: AskAccount;
    private readonly prepareShadow: NonNullable<ProviderAccountsOptions['prepareShadow']>;
    private readonly folderExists: NonNullable<ProviderAccountsOptions['folderExists']>;
    private readonly install: ProviderAccountsOptions['install'];
    private readonly secrets: SecretStore | null;
    // The sensitive values by `secretKey`, read from the keychain once, since a spawn asks for them without waiting.
    private readonly secretValues = new Map<string, string>();
    private readonly now: () => number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly watches = new Map<string, LoginWatch>();
    private writes: Promise<unknown> = Promise.resolve();
    private readonly sinks = new ClientSinks<AgentEvent>();
    private readonly listeners = new Set<() => void>();
    // When a CLI last started under each account, by id; kept in memory, so a restart forgets it.
    private readonly launches = new Map<string, number>();
    private readonly states = new Map<string, AccountState>();
    private stored: StoredAccounts = {};
    private accounts: ProviderAccountMap = wireAccounts({});
    private passes: Promise<void> = Promise.resolve();
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(options: ProviderAccountsOptions) {
        this.path = accountsPath(options.home);
        this.home = options.home;
        this.host = options.host ?? DEFAULT_ACCOUNTS_HOST;
        this.providers = options.providers;
        this.env = options.env ?? process.env;
        this.ask = options.ask ?? askAccountAs(options.client ?? DEFAULT_CODEX_CLIENT);
        this.prepareShadow = options.prepareShadow ?? prepareShadowHome;
        this.folderExists = options.folderExists ?? isFolder;
        this.install = options.install;
        this.secrets = options.secrets === undefined ? platformSecrets(this.host, options.home) : options.secrets;
        this.now = options.now ?? Date.now;
        this.sleep = options.sleep ?? sleep;
    }

    async load(): Promise<void> {
        this.stored = await readAccounts(this.path, (kind) => this.providers.get(kind), this.env, this.host);
        this.accounts = wireAccounts(this.stored);
        await this.readSecrets();
    }

    subscribe(clientId: string, sink: AgentSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    snapshot(): ProviderAccounts {
        const loginCommands: Partial<Record<AgentKind, string>> = {};
        for (const kind of AgentKindSchema.options) {
            const command = this.providers.get(kind).home?.loginCommand;
            if (command !== undefined) {
                loginCommands[kind] = command;
            }
        }
        return {
            accounts: this.accounts,
            statuses: Object.entries(this.accounts).map(([id, account]) => this.statusOf(id, account)),
            secretsAvailable: this.secrets !== null,
            loginCommands
        };
    }

    /* The account under an id, for a launch; null for an id this machine does not have. */
    get(id: string): ProviderAccount | null {
        return this.accounts[id] ?? null;
    }

    /*
     * The environment a CLI of this kind runs in under this account. An account that cannot be used
     * refuses the start, since falling back on the default account would run it on someone else's costs.
     */
    envFor(kind: AgentKind, id: string | undefined, baseEnv: Env): Env {
        const key = id ?? kind;
        const refuse = (why: string): AccountError =>
            new AccountError('account-unavailable', `The account '${this.labelOf(key)}' is not available on this machine: ${why}.`);
        const provider = this.providers.get(kind);
        const variables = (account: ProviderAccount): Record<string, string> => {
            const { values, missing } = this.variablesOf(key, account);
            if (missing !== null) {
                throw refuse(`the keychain does not give the value of ${missing}`);
            }
            return values;
        };
        if (isDefaultAccountOf(kind, id)) {
            const account = this.accounts[kind] ?? { kind };
            return accountEnv(kind, account, provider, baseEnv, variables(account));
        }
        const account = this.accounts[key];
        if (account === undefined) {
            throw refuse('no account on it has that id');
        }
        if (account.kind !== kind) {
            throw refuse(`it is an account of ${isKnownKind(account.kind) ? this.providers.get(account.kind).name : account.kind}, not of ${provider.name}`);
        }
        if (account.enabled === false) {
            throw refuse('it is turned off');
        }
        if (provider.home === undefined || account.home === undefined) {
            throw refuse(`${provider.name} has no setting for its config folder`);
        }
        for (const folder of [account.home, account.shadowHome]) {
            if (folder !== undefined && !this.folderExists(expandHome(folder, this.env))) {
                throw refuse(`its folder ${folder} is missing`);
            }
        }
        return accountEnv(key, account, provider, baseEnv, variables(account));
    }

    transcriptFolder(kind: AgentKind, id: string | undefined): string | null {
        const key = id ?? kind;
        const account = this.accounts[key];
        if (account === undefined || account.kind !== kind) {
            return null;
        }
        return transcriptFolder(key, account, this.providers.get(kind), this.env);
    }

    homeFolder(kind: AgentKind, id: string | undefined): string | null {
        const key = id ?? kind;
        const account = this.accounts[key];
        if (account === undefined || account.kind !== kind) {
            return null;
        }
        return accountFolder(key, account, this.providers.get(kind), this.env);
    }

    canContinue(kind: AgentKind, from: string | undefined, to: string | undefined): boolean {
        const fromId = from ?? kind;
        const toId = to ?? kind;
        const fromAccount = this.accounts[fromId];
        const toAccount = this.accounts[toId];
        if (fromId === toId) {
            return true;
        }
        if (fromAccount === undefined || toAccount === undefined || fromAccount.kind !== kind) {
            return false;
        }
        return canContinue({ id: fromId, account: fromAccount }, { id: toId, account: toAccount }, (each) => this.providers.get(each), this.env);
    }

    labelOf(id: string): string {
        return this.accounts[id]?.label ?? id;
    }

    launched(kind: AgentKind, id: string | undefined): void {
        this.launches.set(id ?? kind, this.now());
    }

    /* When a CLI last started under this account; null when none did since the daemon started. */
    lastLaunchAt(id: string): number | null {
        return this.launches.get(id) ?? null;
    }

    /* Told whenever the accounts or what their CLIs said changed, after the clients were. */
    listen(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /* Checks every account once at once, and the ones due on the clock after that. */
    start(): void {
        this.timer ??= setInterval(() => void this.queue(false), CHECK_INTERVAL_MS);
        void this.queue(false);
    }

    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /* Answers at once; an account that changed reads `checking` until its CLI answered, which arrives as `accounts.changed`. */
    save(accounts: ProviderAccountMap): Promise<ProviderAccounts> {
        return this.serial(() => this.commit(accounts, this.folderExists));
    }

    /*
     * An account in a folder of its own under `<home>/accounts`, signed in by nobody yet. A
     * Codex account is a shadow home over the CLI's own folder, so its threads go on under the other.
     */
    create(payload: ProviderAccountCreatePayload): Promise<ProviderAccountCreateResult> {
        return this.serial(async () => {
            const { kind, label, color } = payload;
            const provider = this.providers.get(kind);
            if (provider.home === undefined) {
                throw new InvalidAccountError(`${provider.name} has no setting for its config folder, so it only has its default account`);
            }
            const id = this.mintId(kind, label);
            const folder = join(this.accountsFolder(), id);
            await mkdir(this.accountsFolder(), { recursive: true, mode: 0o700 });
            await mkdir(folder, { mode: 0o700 });
            const folders = kind === 'codex' ? { home: defaultFolder(provider, this.env), shadowHome: folder } : { home: folder };
            const account: ProviderAccount = { kind, label, ...(color === undefined ? {} : { color }), ...folders };
            await this.prepare(id, kind, account);
            const snapshot = await this.commit({ ...this.accounts, [id]: account }, (path) => path === folder || this.folderExists(path));
            return { ...snapshot, id };
        });
    }

    /*
     * Asks the CLI of one account again every few seconds, for a login running in a terminal, until
     * it is signed in or a few minutes passed. Resolves when the watch ends; a second call for the
     * same account only moves the end.
     */
    watchLogin(id: string): Promise<void> {
        if (this.accounts[id] === undefined) {
            throw new AccountError('account-unavailable', `The account '${id}' is not available on this machine: no account on it has that id.`);
        }
        const deadline = this.now() + LOGIN_WATCH_MS;
        const running = this.watches.get(id);
        if (running !== undefined) {
            running.deadline = deadline;
            return running.done;
        }
        const watch: LoginWatch = { deadline, done: Promise.resolve() };
        watch.done = this.runWatch(id, watch).finally(() => this.watches.delete(id));
        this.watches.set(id, watch);
        return watch.done;
    }

    /* Asks every CLI again, and answers once they all did. */
    async refresh(): Promise<ProviderAccounts> {
        await this.queue(true);
        return this.snapshot();
    }

    private async runWatch(id: string, watch: LoginWatch): Promise<void> {
        while (this.now() < watch.deadline) {
            await this.sleep(LOGIN_POLL_MS);
            if (this.accounts[id] === undefined) {
                return;
            }
            await this.queue(true, id);
            if (this.states.get(id)?.status.state === 'ready') {
                return;
            }
        }
    }

    /* One change of the file at a time: a create and a save both read what the other just wrote. */
    private serial<T>(work: () => Promise<T>): Promise<T> {
        const next = this.writes.then(work);
        this.writes = next.catch(() => undefined);
        return next;
    }

    private async commit(accounts: ProviderAccountMap, isDirectory: (path: string) => boolean): Promise<ProviderAccounts> {
        const stored = acceptAccounts(accounts, this.stored, (kind) => this.providers.get(kind), this.env, isDirectory, this.host);
        const { writes, removals } = this.planSecrets(stored);
        for (const [key, value] of writes) {
            await this.requireSecrets().write(key, value);
            this.secretValues.set(key, value);
        }
        await writeAccounts(this.path, stored);
        this.stored = stored;
        this.accounts = wireAccounts(stored);
        for (const key of removals) {
            this.secretValues.delete(key);
            await this.secrets?.remove(key).catch((e: unknown) => console.error(`Could not remove ${key} from the keychain:`, errorText(e)));
        }
        const rewritten = new Set([...writes.keys()].map((key) => key.slice(0, key.indexOf('/'))));
        for (const id of this.states.keys()) {
            // A new secret can be a new login, which the account as the file holds it does not show.
            if (this.accounts[id] === undefined || rewritten.has(id)) {
                this.states.delete(id);
            }
        }
        this.emit();
        void this.queue(false);
        return this.snapshot();
    }

    /*
     * Takes every sensitive value out of the accounts about to be written, leaving the redacted form
     * the file keeps. Answers which values go into the keychain and which keys no account has any more.
     */
    private planSecrets(stored: StoredAccounts): { writes: Map<string, string>; removals: string[] } {
        const writes = new Map<string, string>();
        const kept = new Set<string>();
        for (const [id, entry] of Object.entries(stored)) {
            const kind = (entry as { kind: string }).kind;
            if (!isKnownKind(kind)) {
                for (const name of sensitiveNames(entry)) {
                    kept.add(secretKey(id, name));
                }
                continue;
            }
            const account = entry as ProviderAccount;
            if (account.env === undefined) {
                continue;
            }
            const had = new Set(sensitiveNames(this.stored[id]));
            const variables = account.env.map((variable): ProviderAccountVariable => {
                if (!variable.sensitive) {
                    return { name: variable.name, value: variable.value, sensitive: false };
                }
                const key = secretKey(id, variable.name);
                this.requireSecrets();
                if (variable.value !== '') {
                    writes.set(key, variable.value);
                } else if (variable.valueRedacted !== true || !had.has(variable.name)) {
                    throw new InvalidAccountError(`${id}: ${variable.name} has no value`);
                }
                kept.add(key);
                return { name: variable.name, value: '', sensitive: true, valueRedacted: true };
            });
            const { env: _env, ...rest } = account;
            stored[id] = variables.length === 0 ? rest : { ...rest, env: variables };
        }
        const removals = Object.entries(this.stored).flatMap(([id, entry]) =>
            sensitiveNames(entry)
                .map((name) => secretKey(id, name))
                .filter((key) => !kept.has(key))
        );
        return { writes, removals };
    }

    private requireSecrets(): SecretStore {
        if (this.secrets === null) {
            throw new SecretsUnavailableError();
        }
        return this.secrets;
    }

    private async readSecrets(): Promise<void> {
        if (this.secrets === null) {
            return;
        }
        for (const [id, entry] of Object.entries(this.stored)) {
            for (const name of sensitiveNames(entry)) {
                const key = secretKey(id, name);
                try {
                    const value = await this.secrets.read(key);
                    if (value !== null) {
                        this.secretValues.set(key, value);
                    }
                } catch (e) {
                    console.error(`Could not read ${key} from the keychain:`, errorText(e));
                }
            }
        }
    }

    /* The variables of an account as a CLI gets them, and the first sensitive one the keychain did not give. */
    private variablesOf(id: string, account: ProviderAccount): { values: Record<string, string>; missing: string | null } {
        const values: Record<string, string> = {};
        for (const variable of account.env ?? []) {
            const value = variable.sensitive ? this.secretValues.get(secretKey(id, variable.name)) : variable.value;
            if (value === undefined) {
                return { values, missing: variable.name };
            }
            values[variable.name] = value;
        }
        return { values, missing: null };
    }

    private accountsFolder(): string {
        return join(this.home, 'accounts');
    }

    /* A free id for a new account; a folder a removed account left behind is never handed to another. */
    private mintId(kind: AgentKind, label: string): string {
        const base = `${kind}_${slugOf(label) || 'account'}`.slice(0, 60).replace(/-+$/, '');
        const taken = (id: string): boolean => this.accounts[id] !== undefined || this.stored[id] !== undefined || existsSync(join(this.accountsFolder(), id));
        let id = base;
        for (let suffix = 2; taken(id); suffix += 1) {
            id = `${base}-${suffix}`;
        }
        return id;
    }

    /* One pass at a time, in the order they were asked for, so a save during a pass is checked after it. */
    private queue(force: boolean, only?: string): Promise<void> {
        const pass = this.passes.then(() => this.runAll(force, only));
        this.passes = pass.catch((e: unknown) => console.error('Could not check the provider accounts:', errorText(e)));
        return this.passes;
    }

    private statusOf(id: string, account: ProviderAccount): ProviderAccountStatus {
        const state = this.states.get(id);
        if (state !== undefined && state.drawnFor === JSON.stringify(account)) {
            return state.status;
        }
        return this.status(id, account, 'checking', { checkedAt: 0 });
    }

    private status(
        id: string,
        account: ProviderAccount,
        state: ProviderAccountStatus['state'],
        fields: Partial<Omit<ProviderAccountStatus, 'id' | 'kind' | 'state'>> = {}
    ): ProviderAccountStatus {
        const provider = isKnownKind(account.kind) ? this.providers.get(account.kind) : null;
        const folder = provider === null ? '' : accountFolder(id, account, provider, this.env);
        return {
            id,
            kind: account.kind,
            state,
            email: null,
            plan: null,
            organization: null,
            home: folder,
            ...(provider === null ? {} : { transcripts: transcriptFolder(id, account, provider, this.env) }),
            message: null,
            checkedAt: this.now(),
            ...fields
        };
    }

    private async runAll(force: boolean, only: string | undefined): Promise<void> {
        const installed = await this.providers.list();
        const due = Object.entries(this.accounts).filter(([id, account]) => {
            if (only !== undefined && id !== only) {
                return false;
            }
            const state = this.states.get(id);
            return force || state === undefined || state.drawnFor !== JSON.stringify(account) || this.now() >= state.nextAt;
        });
        const results = await Promise.all(due.map(async ([id, account]) => ({ id, account, status: await this.check(id, account, installed) })));
        let changed = false;
        for (const { id, account, status } of results) {
            if (this.accounts[id] === undefined) {
                continue;
            }
            const before = this.states.get(id);
            const drawnFor = JSON.stringify(account);
            const failed = status.state === 'failed';
            const backoffMs = failed ? Math.min(MAX_BACKOFF_MS, (before?.backoffMs ?? CHECK_INTERVAL_MS / 2) * 2) : CHECK_INTERVAL_MS;
            this.states.set(id, { status, drawnFor, backoffMs, nextAt: this.now() + backoffMs });
            // An account a save changed read `checking` since, whatever it read before.
            changed ||= before === undefined || before.drawnFor !== drawnFor || !sameStatus(before.status, status);
        }
        if (changed) {
            this.emit();
        }
    }

    private async check(id: string, account: ProviderAccount, installed: ProviderInfo[]): Promise<ProviderAccountStatus> {
        const kind = account.kind;
        if (!isKnownKind(kind)) {
            return this.status(id, account, 'unavailable', { message: `This version of ${this.host.name} does not know this CLI` });
        }
        const provider = this.providers.get(kind);
        const isDefault = isDefaultAccount(id, account);
        if (!isDefault && provider.home === undefined) {
            return this.status(id, account, 'unavailable', {
                message: `${provider.name} has no setting for its config folder, so it only has its default account`
            });
        }
        if (account.enabled === false || this.providers.enabled?.(kind) === false) {
            return this.status(id, account, 'disabled');
        }
        if (installed.find((info) => info.kind === kind)?.installed !== true) {
            return this.status(id, account, 'not-found');
        }
        if (provider.home === undefined) {
            return this.status(id, account, 'ready');
        }
        const folders = isDefault
            ? []
            : [account.home, account.shadowHome].filter((folder) => folder !== undefined).map((folder) => expandHome(folder, this.env));
        for (const folder of folders) {
            if (!this.folderExists(folder)) {
                return this.status(id, account, 'folder-missing', { message: `${folder} does not exist` });
            }
        }
        try {
            const message = await this.prepare(id, kind, account);
            const { values, missing } = this.variablesOf(id, account);
            if (missing !== null) {
                throw new Error(`The keychain does not give the value of ${missing}`);
            }
            const reading = await this.ask(kind, provider.command, accountEnv(id, account, provider, this.env, values));
            return this.status(id, account, reading.signedIn ? 'ready' : 'signed-out', {
                email: reading.email,
                plan: reading.plan,
                organization: reading.organization,
                message
            });
        } catch (e) {
            return this.status(id, account, 'failed', { message: errorText(e) });
        }
    }

    /*
     * Puts the hooks in the account's folder and links a shadow home to the home it shares, before the
     * CLI is asked anything: Codex writes its own files into a fresh home the moment it starts, and a
     * real file there is one the daemon will never replace by a link. Answers what a person should
     * know about the shadow home, and throws when it cannot be used.
     */
    private async prepare(id: string, kind: AgentKind, account: ProviderAccount): Promise<string | null> {
        if (isDefaultAccount(id, account) || account.home === undefined) {
            return null;
        }
        const home = expandHome(account.home, this.env);
        await this.install?.(kind, home).catch((e: unknown) => console.error(`Could not install hooks in ${home}:`, errorText(e)));
        if (account.shadowHome === undefined) {
            return null;
        }
        const report = await this.prepareShadow(home, expandHome(account.shadowHome, this.env));
        if (report.sharedLogin) {
            throw new Error('auth.json in the shadow home is a link, so this account would sign in as another one');
        }
        return report.unshared.length > 0 ? `Not shared with ${home}: ${report.unshared.join(', ')}` : null;
    }

    private emit(): void {
        this.sinks.emit({ event: 'accounts.changed', payload: this.snapshot() });
        for (const listener of this.listeners) {
            listener();
        }
    }
}

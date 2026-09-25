import { statSync } from 'node:fs';
import type { AgentKind, ProviderAccount, ProviderAccountMap, ProviderAccounts, ProviderAccountStatus, ProviderInfo } from '@ruimte/contracts';
import { ClientSinks } from '../../client-sinks.ts';
import { errorText } from '../../error-text.ts';
import type { SessionSink } from '../../sessions/manager.ts';
import type { ChatProvider } from '../provider.ts';
import { accountEnv, accountFolder, canContinue, expandHome, isDefaultAccount, isKnownKind, transcriptFolder, type Env } from './accounts.ts';
import { AccountError, isDefaultAccountOf, type AccountLaunches } from './launch.ts';
import { prepareShadowHome, type ShadowHomeReport } from './shadow-home.ts';
import { askAccount, type AskAccount } from './status.ts';
import { acceptAccounts, accountsPath, readAccounts, wireAccounts, writeAccounts, type StoredAccounts } from './store.ts';

/* Who is signed in changes by hand and rarely; often enough to notice, rarely enough not to start CLIs all day. */
const CHECK_INTERVAL_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;

export interface ProviderAccountsOptions {
    ruimteHome: string;
    providers: { list(): Promise<ProviderInfo[]>; get(kind: AgentKind): ChatProvider };
    env?: Env;
    // How to ask a CLI who is signed in; a test answers without starting one.
    ask?: AskAccount;
    prepareShadow?: (home: string, shadow: string) => Promise<ShadowHomeReport>;
    folderExists?: (path: string) => boolean;
    // What the daemon puts in a config folder of an account (its hooks); absent puts nothing there.
    install?: (kind: AgentKind, folder: string) => Promise<void>;
    now?: () => number;
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
    private readonly providers: ProviderAccountsOptions['providers'];
    private readonly env: Env;
    private readonly ask: AskAccount;
    private readonly prepareShadow: NonNullable<ProviderAccountsOptions['prepareShadow']>;
    private readonly folderExists: NonNullable<ProviderAccountsOptions['folderExists']>;
    private readonly install: ProviderAccountsOptions['install'];
    private readonly now: () => number;
    private readonly sinks = new ClientSinks();
    private readonly states = new Map<string, AccountState>();
    private stored: StoredAccounts = {};
    private accounts: ProviderAccountMap = wireAccounts({});
    private passes: Promise<void> = Promise.resolve();
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(options: ProviderAccountsOptions) {
        this.path = accountsPath(options.ruimteHome);
        this.providers = options.providers;
        this.env = options.env ?? process.env;
        this.ask = options.ask ?? askAccount;
        this.prepareShadow = options.prepareShadow ?? prepareShadowHome;
        this.folderExists = options.folderExists ?? isFolder;
        this.install = options.install;
        this.now = options.now ?? Date.now;
    }

    async load(): Promise<void> {
        this.stored = await readAccounts(this.path, (kind) => this.providers.get(kind), this.env);
        this.accounts = wireAccounts(this.stored);
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    snapshot(): ProviderAccounts {
        return { accounts: this.accounts, statuses: Object.entries(this.accounts).map(([id, account]) => this.statusOf(id, account)) };
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
        if (id === undefined || isDefaultAccountOf(kind, id)) {
            return baseEnv;
        }
        const account = this.accounts[id];
        const refuse = (why: string): AccountError =>
            new AccountError('account-unavailable', `The account '${this.labelOf(id)}' is not available on this machine: ${why}.`);
        const provider = this.providers.get(kind);
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
        return accountEnv(id, account, provider, baseEnv);
    }

    transcriptFolder(kind: AgentKind, id: string | undefined): string | null {
        const key = id ?? kind;
        const account = this.accounts[key];
        if (account === undefined || account.kind !== kind) {
            return null;
        }
        return transcriptFolder(key, account, this.providers.get(kind), this.env);
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

    /* Answers at once; an account that changed reads `checking` until its CLI answered, which arrives as `providers.changed`. */
    async save(accounts: ProviderAccountMap): Promise<ProviderAccounts> {
        const stored = acceptAccounts(accounts, this.stored, (kind) => this.providers.get(kind), this.env);
        await writeAccounts(this.path, stored);
        this.stored = stored;
        this.accounts = wireAccounts(stored);
        for (const id of this.states.keys()) {
            if (this.accounts[id] === undefined) {
                this.states.delete(id);
            }
        }
        this.emit();
        void this.queue(false);
        return this.snapshot();
    }

    /* Asks every CLI again, and answers once they all did. */
    async refresh(): Promise<ProviderAccounts> {
        await this.queue(true);
        return this.snapshot();
    }

    /* One pass at a time, in the order they were asked for, so a save during a pass is checked after it. */
    private queue(force: boolean): Promise<void> {
        const pass = this.passes.then(() => this.runAll(force));
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
        const folder = isKnownKind(account.kind) ? accountFolder(id, account, this.providers.get(account.kind), this.env) : '';
        return {
            id,
            kind: account.kind,
            state,
            email: null,
            plan: null,
            organization: null,
            home: folder,
            message: null,
            checkedAt: this.now(),
            ...fields
        };
    }

    private async runAll(force: boolean): Promise<void> {
        const installed = await this.providers.list();
        const due = Object.entries(this.accounts).filter(([id, account]) => {
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
            return this.status(id, account, 'unavailable', { message: 'This version of Ruimte does not know this CLI' });
        }
        const provider = this.providers.get(kind);
        const isDefault = isDefaultAccount(id, account);
        if (!isDefault && provider.home === undefined) {
            return this.status(id, account, 'unavailable', {
                message: `${provider.name} has no setting for its config folder, so it only has its default account`
            });
        }
        if (account.enabled === false) {
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
            const reading = await this.ask(kind, provider.command, accountEnv(id, account, provider, this.env));
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
        this.sinks.emit({ event: 'providers.changed', payload: this.snapshot() });
    }
}

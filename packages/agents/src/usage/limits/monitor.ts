import type { UsageLimitsProvider, UsageLimitsSnapshot, UsageProvider } from '@ruimte/agent-contracts';
import { definedEnv } from '../../providers/accounts/launch.ts';
import type { ProviderRegistry } from '../../providers/registry.ts';
import type { AgentEvent, AgentSink } from '../../events.ts';
import { mergeWindows, type LimitsUpdate } from './normalize.ts';
import type { CodexClientInfo } from '../../chat/codex-transport.ts';
import { probeClaude, probeCodex, type ProbeResult } from './probe.ts';
import { ClientSinks } from '../../client-sinks.ts';
import { errorText } from '../../error-text.ts';

/* Often enough that a bar is never far behind, rarely enough that two CLIs are not started all day. */
const PROBE_INTERVAL_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
/* An account other than the default one that nobody started a CLI under for this long is only read when a person asks. */
const RECENT_USE_MS = 24 * 60 * 60_000;

const PROVIDERS: readonly UsageProvider[] = ['claude', 'codex'];

export type ProbeEnv = Record<string, string>;

/* An account whose plan is read. The default account of a CLI has the CLI's kind as its id. */
export interface LimitAccount {
    id: string;
    kind: UsageProvider;
    label: string;
    color?: string;
    isDefault: boolean;
}

export interface LimitAccounts {
    /* The default account of every CLI, and every other account that is on and signed in. */
    list(): LimitAccount[];
    /* The environment a probe of this account runs in. Throws for an account this machine cannot start. */
    envFor(kind: UsageProvider, id: string): ProbeEnv;
    /* When a chat or a terminal last started under this account; null when none did since the daemon started. */
    lastUsedAt(id: string): number | null;
}

interface ProviderState {
    kind: UsageProvider;
    published: UsageLimitsProvider;
    /* How long to wait after a failure; it doubles up to an hour and resets on the first answer. */
    backoffMs: number;
    nextAt: number;
}

const blank = (kind: UsageProvider): UsageLimitsProvider => ({
    kind,
    plan: null,
    checkedAt: 0,
    source: 'probe',
    windows: [],
    cost: null,
    unavailable: null
});

export interface UsageMonitorOptions {
    providers: ProviderRegistry;
    /* The accounts to read; absent reads the default account of every CLI and names none. */
    accounts?: LimitAccounts;
    /* How to ask; a test answers without starting a CLI. */
    probe?: (kind: UsageProvider, command: readonly string[], env: ProbeEnv) => Promise<ProbeResult>;
    now?: () => number;
    // How the host names itself to the app-server a probe opens.
    client?: CodexClientInfo;
}

/*
 * What is left of each plan, per account. Two sources feed it: a read of our own every five minutes,
 * which starts the CLI, asks and ends it, and the events a running turn streams in between, which
 * cost nothing and arrive the moment a number moves. Neither reads a credential: both CLIs already
 * hold their own login and answer the question themselves.
 */
export class UsageMonitor {
    private readonly registry: ProviderRegistry;
    private readonly accounts: LimitAccounts | null;
    private readonly probe: NonNullable<UsageMonitorOptions['probe']>;
    private readonly now: () => number;
    private readonly sinks = new ClientSinks<AgentEvent>();
    // By account id, so the default account of a CLI is under the CLI's kind.
    private readonly states = new Map<string, ProviderState>();
    private inFlight: Promise<void> | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(options: UsageMonitorOptions) {
        this.registry = options.providers;
        this.accounts = options.accounts ?? null;
        this.probe = options.probe ?? ((kind, command, env) => (kind === 'claude' ? probeClaude(command, env) : probeCodex(command, env, options.client)));
        this.now = options.now ?? Date.now;
        for (const kind of PROVIDERS) {
            this.stateOf(kind, kind);
        }
    }

    subscribe(clientId: string, sink: AgentSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* Per CLI its default account first, in the shape an entry had before accounts, then its other accounts. */
    snapshot(): UsageLimitsSnapshot {
        const providers = this.listed().map(({ id, kind, label, color }) => {
            const published = this.stateOf(kind, id).published;
            return this.accounts === null ? published : { ...published, account: { id, label, ...(color === undefined ? {} : { color }) } };
        });
        return { providers };
    }

    /* Starts the five minute pass. The first read runs at once, so a fresh daemon has numbers. */
    start(): void {
        this.timer ??= setInterval(() => void this.refresh(false), PROBE_INTERVAL_MS);
        void this.refresh(false);
    }

    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /* One pass at a time; a second caller waits for the first one's answer rather than starting a CLI. */
    refresh(force: boolean): Promise<void> {
        this.inFlight ??= this.runAll(force).finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    /* An account came, went, was renamed or signed in: the list a client holds is drawn again. */
    accountsChanged(): void {
        this.emit();
    }

    /*
     * A number a running turn reported, on the account the turn ran under. It lands on the row a full
     * read drew, keeping the reset and the length the event leaves out, so the bar moves without
     * waiting for the next pass.
     */
    applyLive(update: LimitsUpdate): void {
        if (update.windows.length === 0) {
            return;
        }
        const state = this.stateOf(update.kind, update.account ?? update.kind);
        state.published = {
            ...state.published,
            plan: update.plan ?? state.published.plan,
            checkedAt: this.now(),
            source: 'event',
            windows: mergeWindows(state.published.windows, update.windows),
            unavailable: null
        };
        this.emit();
    }

    /* Every account of a CLI whose plan is read, the default one first. */
    private listed(): LimitAccount[] {
        const accounts = this.accounts?.list() ?? PROVIDERS.map((kind) => ({ id: kind, kind, label: kind, isDefault: true }));
        return PROVIDERS.flatMap((kind) => {
            const own = accounts.filter((account) => account.kind === kind);
            return [...own.filter((account) => account.isDefault), ...own.filter((account) => !account.isDefault)];
        });
    }

    private stateOf(kind: UsageProvider, id: string): ProviderState {
        let state = this.states.get(id);
        if (state === undefined || state.kind !== kind) {
            state = { kind, published: blank(kind), backoffMs: PROBE_INTERVAL_MS, nextAt: 0 };
            this.states.set(id, state);
        }
        return state;
    }

    /* The default account on the clock; another only while it is in use, since every read starts its CLI. */
    private due(account: LimitAccount, state: ProviderState, force: boolean): boolean {
        if (force) {
            return true;
        }
        if (this.now() < state.nextAt) {
            return false;
        }
        if (account.isDefault) {
            return true;
        }
        const used = this.accounts?.lastUsedAt(account.id) ?? null;
        return used !== null && this.now() - used < RECENT_USE_MS;
    }

    private async runAll(force: boolean): Promise<void> {
        const installed = await this.registry.list();
        let changed = false;
        for (const account of this.listed()) {
            const { kind } = account;
            const state = this.stateOf(kind, account.id);
            if (!this.due(account, state, force)) {
                continue;
            }
            const info = installed.find((provider) => provider.kind === kind);
            if (info === undefined || !info.installed) {
                state.published = { ...blank(kind), checkedAt: this.now(), unavailable: { reason: 'not-installed', message: null } };
                state.nextAt = this.now() + PROBE_INTERVAL_MS;
                changed = true;
                continue;
            }
            const result = await this.read(account);
            const failed = 'unavailable' in result && result.unavailable?.reason === 'failed';
            state.backoffMs = failed ? Math.min(MAX_BACKOFF_MS, state.backoffMs * 2) : PROBE_INTERVAL_MS;
            state.nextAt = this.now() + state.backoffMs;
            if (failed && state.published.windows.length > 0) {
                // A pass that could not reach the CLI leaves the last good numbers where they are.
                continue;
            }
            state.published =
                'unavailable' in result
                    ? { ...blank(kind), checkedAt: this.now(), unavailable: result.unavailable }
                    : { kind, plan: result.plan, checkedAt: this.now(), source: 'probe', windows: result.windows, cost: result.cost, unavailable: null };
            changed = true;
        }
        if (changed) {
            this.emit();
        }
    }

    private async read(account: LimitAccount): Promise<ProbeResult> {
        let env: ProbeEnv;
        try {
            env = this.accounts === null ? definedEnv(process.env) : this.accounts.envFor(account.kind, account.id);
        } catch (e) {
            return { unavailable: { reason: 'failed', message: errorText(e) } };
        }
        return this.probe(account.kind, this.registry.get(account.kind).command, env);
    }

    private emit(): void {
        const event: AgentEvent = { event: 'usage.limitsChanged', payload: this.snapshot() };
        this.sinks.emit(event);
    }
}

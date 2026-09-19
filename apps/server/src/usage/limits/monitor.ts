import type { UsageLimitsProvider, UsageLimitsSnapshot, UsageProvider } from '@ruimte/contracts';
import type { ProviderRegistry } from '../../providers/registry.ts';
import type { SessionEvent, SessionSink } from '../../sessions/manager.ts';
import { mergeWindows, type LimitsUpdate } from './normalize.ts';
import { probeClaude, probeCodex, type ProbeResult } from './probe.ts';
import { ClientSinks } from '../../client-sinks.ts';

/* Often enough that a bar is never far behind, rarely enough that two CLIs are not started all day. */
const PROBE_INTERVAL_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;

const PROVIDERS: readonly UsageProvider[] = ['claude', 'codex'];

interface ProviderState {
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
    /* How to ask; a test answers without starting a CLI. */
    probe?: (kind: UsageProvider, command: readonly string[]) => Promise<ProbeResult>;
}

/*
 * What is left of each plan. Two sources feed it: a read of our own every five minutes, which starts
 * the CLI, asks and ends it, and the events a running turn streams in between, which cost nothing
 * and arrive the moment a number moves. Neither reads a credential: both CLIs already hold their
 * own login and answer the question themselves.
 */
export class UsageMonitor {
    private readonly registry: ProviderRegistry;
    private readonly probe: NonNullable<UsageMonitorOptions['probe']>;
    private readonly sinks = new ClientSinks();
    private readonly states = new Map<UsageProvider, ProviderState>();
    private inFlight: Promise<void> | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(options: UsageMonitorOptions) {
        this.registry = options.providers;
        this.probe = options.probe ?? ((kind, command) => (kind === 'claude' ? probeClaude(command) : probeCodex(command)));
        for (const kind of PROVIDERS) {
            this.states.set(kind, { published: blank(kind), backoffMs: PROBE_INTERVAL_MS, nextAt: 0 });
        }
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    snapshot(): UsageLimitsSnapshot {
        return { providers: [...this.states.values()].map((state) => state.published) };
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

    /*
     * A number a running turn reported. It lands on the row a full read drew, keeping the reset and
     * the length the event leaves out, so the bar moves without waiting for the next pass.
     */
    applyLive(update: LimitsUpdate): void {
        const state = this.states.get(update.kind);
        if (state === undefined || update.windows.length === 0) {
            return;
        }
        state.published = {
            ...state.published,
            plan: update.plan ?? state.published.plan,
            checkedAt: Date.now(),
            source: 'event',
            windows: mergeWindows(state.published.windows, update.windows),
            unavailable: null
        };
        this.emit();
    }

    private async runAll(force: boolean): Promise<void> {
        const installed = await this.registry.list();
        let changed = false;
        for (const kind of PROVIDERS) {
            const state = this.states.get(kind)!;
            if (!force && Date.now() < state.nextAt) {
                continue;
            }
            const info = installed.find((provider) => provider.kind === kind);
            if (info === undefined || !info.installed) {
                state.published = { ...blank(kind), checkedAt: Date.now(), unavailable: { reason: 'not-installed', message: null } };
                state.nextAt = Date.now() + PROBE_INTERVAL_MS;
                changed = true;
                continue;
            }
            const result = await this.probe(kind, this.registry.get(kind).command);
            const failed = 'unavailable' in result && result.unavailable?.reason === 'failed';
            state.backoffMs = failed ? Math.min(MAX_BACKOFF_MS, state.backoffMs * 2) : PROBE_INTERVAL_MS;
            state.nextAt = Date.now() + state.backoffMs;
            if (failed && state.published.windows.length > 0) {
                // A pass that could not reach the CLI leaves the last good numbers where they are.
                continue;
            }
            state.published =
                'unavailable' in result
                    ? { ...blank(kind), checkedAt: Date.now(), unavailable: result.unavailable }
                    : { kind, plan: result.plan, checkedAt: Date.now(), source: 'probe', windows: result.windows, cost: result.cost, unavailable: null };
            changed = true;
        }
        if (changed) {
            this.emit();
        }
    }

    private emit(): void {
        const event: SessionEvent = { event: 'usage.limitsChanged', payload: this.snapshot() };
        this.sinks.emit(event);
    }
}

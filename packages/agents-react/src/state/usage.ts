import type { UsageLimitsSnapshot, UsageSummaryPayload, UsageSummaryResult } from '@ruimte/agent-contracts';
import { create } from 'zustand';
import { localTimeZone } from '@ruimte/ui/format/time-zone';
import { useChatScope } from '../scope';
import type { UsageCurrency } from '../usage/format';

export type UsagePeriod = 'today' | '7d' | '30d' | '90d';
export type UsageMetric = 'cost' | 'tokens';

/* Only the id and the length. A store has no words, so the page names a period in its own language. */
export const USAGE_PERIODS: readonly { id: UsagePeriod; days: number }[] = [
    { id: 'today', days: 1 },
    { id: '7d', days: 7 },
    { id: '30d', days: 30 },
    { id: '90d', days: 90 }
];

const STORAGE_KEY = 'ruimte.usage';

interface Preferences {
    period: UsagePeriod;
    metric: UsageMetric;
    /* Dollars until someone asks for euros; it is the viewer's setting, not the project's. */
    currency: UsageCurrency;
}

const DEFAULTS: Preferences = { period: '7d', metric: 'cost', currency: 'USD' };

const readPreferences = (): Preferences => {
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Preferences>;
        return {
            period: USAGE_PERIODS.some((period) => period.id === stored.period) ? stored.period! : DEFAULTS.period,
            metric: stored.metric === 'tokens' || stored.metric === 'cost' ? stored.metric : DEFAULTS.metric,
            currency: stored.currency === 'EUR' ? 'EUR' : DEFAULTS.currency
        };
    } catch {
        return DEFAULTS;
    }
};

const persist = (preferences: Preferences): void => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
        // Storage that refuses keeps the choice for this session only.
    }
};

/* The three stored choices out of the store, so a setter writes the other two back unchanged. */
const chosen = (state: Preferences): Preferences => ({ period: state.period, metric: state.metric, currency: state.currency });

const pad = (value: number): string => String(value).padStart(2, '0');

/* The viewer's own calendar day; the host may stand in another zone and buckets in this one. */
export const dayOf = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/*
 * What a period asks for. Today counts from local midnight in hours, the way the commit log already
 * groups days, so every other period reads as one bar per calendar day.
 */
export const windowFor = (period: UsagePeriod, now = new Date()): UsageSummaryPayload => {
    const days = USAGE_PERIODS.find((entry) => entry.id === period)?.days ?? 7;
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    return {
        from: dayOf(from),
        to: dayOf(now),
        resolution: period === 'today' ? 'hour' : 'day',
        timeZone: localTimeZone() ?? 'UTC'
    };
};

/* A period, and only the usage of one account when one is picked; null is every account. */
export const summaryPayload = (period: UsagePeriod, account: string | null, now = new Date()): UsageSummaryPayload =>
    account === null ? windowFor(period, now) : { ...windowFor(period, now), accounts: [account] };

/* What was asked, so an answer to the question before this one is never drawn over a newer one. */
export const askedKey = (payload: UsageSummaryPayload): string =>
    `${payload.from}\0${payload.to}\0${payload.resolution}\0${payload.timeZone}\0${payload.accounts?.join(',') ?? ''}`;

/* The numbers of one host: its transcripts, priced by it. */
interface UsageRow {
    /* The question the summary on screen answers, or null while nothing has come back yet. */
    asked: string | null;
    summary: UsageSummaryResult | null;
    /* True while the host has not answered the question that is being asked now. */
    loading: boolean;
    /* The last request failed; the summary before it stays on screen under a red line. */
    failed: boolean;
    limits: UsageLimitsSnapshot | null;
}

/* One object for a host nothing was read from yet, so a selector gets a stable snapshot. */
const EMPTY: UsageRow = { asked: null, summary: null, loading: false, failed: false, limits: null };

interface UsageStore extends Preferences {
    byScope: Record<string, UsageRow>;
    /*
     * The host the usage page is showing, by scope id, or null for the one its surroundings are on.
     * Deliberately not in `Preferences`, so it is not written to storage: a remembered host outlives
     * this client's knowledge of it, and the numbers worth opening on are those of the host you work
     * on. It does survive closing the page, which is what makes browsing two hosts bearable.
     */
    chosen: string | null;
    /* Which host's numbers the page shows; null hands it back to the one around it. */
    choose(scopeId: string | null): void;
    setPeriod(period: UsagePeriod): void;
    setMetric(metric: UsageMetric): void;
    setCurrency(currency: UsageCurrency): void;
    setLoading(scopeId: string, loading: boolean): void;
    receive(scopeId: string, asked: string, summary: UsageSummaryResult): void;
    fail(scopeId: string): void;
    setLimits(scopeId: string, limits: UsageLimitsSnapshot): void;
    /* A host that is forgotten takes its numbers with it; the three preferences are the viewer's and stay. */
    forget(scopeId: string): void;
}

export const useUsageStore = create<UsageStore>((set, get) => ({
    ...readPreferences(),
    byScope: {},
    chosen: null,
    choose(scopeId) {
        set({ chosen: scopeId });
    },
    setPeriod(period) {
        persist({ ...chosen(get()), period });
        set({ period });
    },
    setMetric(metric) {
        persist({ ...chosen(get()), metric });
        set({ metric });
    },
    setCurrency(currency) {
        persist({ ...chosen(get()), currency });
        set({ currency });
    },
    setLoading(scopeId, loading) {
        set({ byScope: { ...get().byScope, [scopeId]: { ...(get().byScope[scopeId] ?? EMPTY), loading } } });
    },
    receive(scopeId, asked, summary) {
        set({
            byScope: { ...get().byScope, [scopeId]: { ...(get().byScope[scopeId] ?? EMPTY), asked, summary, loading: false, failed: false } }
        });
    },
    fail(scopeId) {
        set({ byScope: { ...get().byScope, [scopeId]: { ...(get().byScope[scopeId] ?? EMPTY), loading: false, failed: true } } });
    },
    setLimits(scopeId, limits) {
        set({ byScope: { ...get().byScope, [scopeId]: { ...(get().byScope[scopeId] ?? EMPTY), limits } } });
    },
    forget(scopeId) {
        const { [scopeId]: _gone, ...rest } = get().byScope;
        set({ byScope: rest });
    }
}));

/*
 * The preferences of the viewer over the numbers of the host in scope, as one thing to select from.
 * The usage page renders the host its picker is on as a scope of its own; everything outside it (the
 * limit bars beside the work) reads the host around it, so browsing another host's spend never
 * moves the bars that say how much of the plan the agents beside you have left.
 */
export type UsageView = Preferences & UsageRow;

export const useUsage = <T>(select: (view: UsageView) => T): T => {
    const { id } = useChatScope();
    return useUsageStore((s) => select({ period: s.period, metric: s.metric, currency: s.currency, ...(s.byScope[id] ?? EMPTY) }));
};

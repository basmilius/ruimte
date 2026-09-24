import { createContext, useContext } from 'react';
import type { UsageLimitsSnapshot, UsageSummaryPayload, UsageSummaryResult } from '@ruimte/contracts';
import { create } from 'zustand';
import { useEndpointId } from '@/state/keys';
import { localTimeZone } from '@/format/time-zone';
import type { UsageCurrency } from '@/shell/usage/format';

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
    /* Dollars until someone asks for euros; it is the machine's setting, not the project's. */
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

/* The viewer's own calendar day; the daemon may stand in another zone and buckets in this one. */
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

/* What was asked, so an answer to the question before this one is never drawn over a newer one. */
export const askedKey = (payload: UsageSummaryPayload): string => `${payload.from}\0${payload.to}\0${payload.resolution}\0${payload.timeZone}`;

/* The numbers of one machine: its transcripts, priced by its daemon. */
interface UsageRow {
    /* The question the summary on screen answers, or null while nothing has come back yet. */
    asked: string | null;
    summary: UsageSummaryResult | null;
    /* True while the daemon has not answered the question that is being asked now. */
    loading: boolean;
    /* The last request failed; the summary before it stays on screen under a red line. */
    failed: boolean;
    limits: UsageLimitsSnapshot | null;
}

/* One object for a machine nothing was read from yet, so a selector gets a stable snapshot. */
const EMPTY: UsageRow = { asked: null, summary: null, loading: false, failed: false, limits: null };

interface UsageStore extends Preferences {
    byEndpoint: Record<string, UsageRow>;
    /*
     * The machine the usage page is showing, or null for the one its workspace is on. Deliberately
     * not in `Preferences`, so it is not written to storage. A remembered machine outlives this
     * client's knowledge of it, and the numbers worth opening on are the ones of the machine you are
     * working on. It does survive closing the page, which is what makes browsing two machines bearable.
     */
    chosen: string | null;
    /* Which machine's numbers the page shows; null hands it back to the workspace's own. */
    choose(endpointId: string | null): void;
    setPeriod(period: UsagePeriod): void;
    setMetric(metric: UsageMetric): void;
    setCurrency(currency: UsageCurrency): void;
    setLoading(endpointId: string, loading: boolean): void;
    receive(endpointId: string, asked: string, summary: UsageSummaryResult): void;
    fail(endpointId: string): void;
    setLimits(endpointId: string, limits: UsageLimitsSnapshot): void;
    /* A machine that is forgotten takes its numbers with it; the three preferences are the viewer's and stay. */
    forget(endpointId: string): void;
}

export const useUsageStore = create<UsageStore>((set, get) => ({
    ...readPreferences(),
    byEndpoint: {},
    chosen: null,
    choose(endpointId) {
        set({ chosen: endpointId });
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
    setLoading(endpointId, loading) {
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...(get().byEndpoint[endpointId] ?? EMPTY), loading } } });
    },
    receive(endpointId, asked, summary) {
        set({
            byEndpoint: { ...get().byEndpoint, [endpointId]: { ...(get().byEndpoint[endpointId] ?? EMPTY), asked, summary, loading: false, failed: false } }
        });
    },
    fail(endpointId) {
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...(get().byEndpoint[endpointId] ?? EMPTY), loading: false, failed: true } } });
    },
    setLimits(endpointId, limits) {
        set({ byEndpoint: { ...get().byEndpoint, [endpointId]: { ...(get().byEndpoint[endpointId] ?? EMPTY), limits } } });
    },
    forget(endpointId) {
        const { [endpointId]: _gone, ...rest } = get().byEndpoint;
        set({ byEndpoint: rest });
    }
}));

/*
 * Which machine the numbers on screen are about. The usage page fills it with the machine its picker
 * is on; everything outside the page (the limit bars in the sidebar) is about the machine the
 * workspace runs on, and reads that instead. Browsing another machine's spend must not move the bars
 * that say how much of the plan the agents beside you have left.
 */
export const UsageEndpointContext = createContext<string | null>(null);

export const useUsageEndpointId = (): string => {
    const picked = useContext(UsageEndpointContext);
    const workspace = useEndpointId();
    return picked ?? workspace;
};

/* The preferences of the viewer over the numbers of the machine in scope, as one thing to select from. */
export type UsageView = Preferences & UsageRow;

export const useUsage = <T>(select: (view: UsageView) => T): T => {
    const endpointId = useUsageEndpointId();
    return useUsageStore((s) => select({ period: s.period, metric: s.metric, currency: s.currency, ...(s.byEndpoint[endpointId] ?? EMPTY) }));
};

import type { UsageLimitsProvider, UsageProvider, UsageWindow } from '@ruimte/contracts';

/* Everything a full read of a provider says about its plan, ready to be published as it is. */
export interface ProviderReading {
    plan: string | null;
    windows: UsageWindow[];
    cost: { sessionUsd: number } | null;
}

/* What a running turn reports in passing: a few windows, sometimes without their reset or duration. */
export interface LimitsUpdate {
    kind: UsageProvider;
    plan?: string | null;
    windows: Partial<UsageWindow>[];
}

const MINUTE_MS = 60_000;
const FIVE_HOURS_MS = 5 * 60 * MINUTE_MS;
const WEEK_MS = 7 * 24 * 60 * MINUTE_MS;
const MONTH_MS = 30 * 24 * 60 * MINUTE_MS;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const fraction = (value: number): number => Math.min(1, Math.max(0, value));

/* A window is named after how long it lasts, never after the position it came in. */
export const kindOfDuration = (durationMs: number | null): UsageWindow['kind'] => {
    if (durationMs === null) {
        return 'other';
    }
    if (durationMs >= MONTH_MS) {
        return 'monthly';
    }
    if (durationMs >= WEEK_MS) {
        return 'weekly';
    }
    return 'session';
};

const CLAUDE_WINDOWS: { key: string; id: string; label: string; kind: UsageWindow['kind']; durationMs: number }[] = [
    { key: 'five_hour', id: 'five_hour', label: 'Session', kind: 'session', durationMs: FIVE_HOURS_MS },
    { key: 'seven_day', id: 'seven_day', label: 'Weekly', kind: 'weekly', durationMs: WEEK_MS },
    { key: 'seven_day_opus', id: 'seven_day_opus', label: 'Weekly · Opus', kind: 'weekly', durationMs: WEEK_MS },
    { key: 'seven_day_sonnet', id: 'seven_day_sonnet', label: 'Weekly · Sonnet', kind: 'weekly', durationMs: WEEK_MS }
];

const slug = (value: string): string =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');

/*
 * What `get_usage` answers. Claude reports a percent and an ISO moment there, while the event a
 * running turn sends reports a fraction and epoch seconds; both are turned into a fraction and epoch
 * milliseconds here, so nothing past this file has to remember which of the two it is holding.
 */
export const readClaudeUsage = (response: unknown): ProviderReading | { unavailable: UsageLimitsProvider['unavailable'] } => {
    if (!isRecord(response)) {
        return { unavailable: { reason: 'failed', message: 'Claude Code returned no readable usage' } };
    }
    const plan = typeof response.subscription_type === 'string' ? response.subscription_type : null;
    const limits = isRecord(response.rate_limits) ? response.rate_limits : null;
    if (response.rate_limits_available === false || limits === null) {
        // An API key, Bedrock or Vertex account has no plan windows at all, which is not a failure.
        return { unavailable: { reason: 'no-subscription', message: null } };
    }
    const windows: UsageWindow[] = [];
    const push = (id: string, label: string, kind: UsageWindow['kind'], durationMs: number, entry: unknown): void => {
        const window = isRecord(entry) ? entry : null;
        const utilization = window === null ? null : num(window.utilization);
        if (utilization === null) {
            return;
        }
        const resetsAt = typeof window?.resets_at === 'string' ? Date.parse(window.resets_at) : Number.NaN;
        windows.push({ id, label, kind, used: fraction(utilization / 100), resetsAt: Number.isNaN(resetsAt) ? null : resetsAt, durationMs });
    };
    for (const known of CLAUDE_WINDOWS) {
        push(known.id, known.label, known.kind, known.durationMs, limits[known.key]);
    }
    for (const entry of Array.isArray(limits.model_scoped) ? limits.model_scoped : []) {
        const name = isRecord(entry) && typeof entry.display_name === 'string' ? entry.display_name : null;
        if (name !== null) {
            push(`seven_day_${slug(name)}`, `Weekly · ${name}`, 'weekly', WEEK_MS, entry);
        }
    }
    const session = isRecord(response.session) ? response.session : null;
    const sessionUsd = session === null ? null : num(session.total_cost_usd);
    return { plan, windows, cost: sessionUsd === null ? null : { sessionUsd } };
};

/* The `rate_limit_event` a turn streams: one window, a fraction, and seconds where the read had ISO. */
export const readClaudeEvent = (info: unknown): LimitsUpdate | null => {
    const event = isRecord(info) ? info : null;
    const type = event !== null && typeof event.rateLimitType === 'string' ? event.rateLimitType : null;
    const utilization = event === null ? null : num(event.utilization);
    if (type === null || utilization === null) {
        return null;
    }
    const known = CLAUDE_WINDOWS.find((window) => window.key === type);
    const resetsAt = num(event?.resetsAt);
    return {
        kind: 'claude',
        windows: [
            {
                id: known?.id ?? type,
                ...(known ? { label: known.label, kind: known.kind, durationMs: known.durationMs } : {}),
                used: fraction(utilization),
                ...(resetsAt === null ? {} : { resetsAt: Math.round(resetsAt * 1000) })
            }
        ]
    };
};

/*
 * A Codex rate limit snapshot, from a read or from the notification a turn sends. Only the main
 * allowance counts: the other ids are one model's own budget and read as a second plan.
 */
export const readCodexLimits = (snapshot: unknown): ProviderReading | null => {
    const limits = isRecord(snapshot) ? snapshot : null;
    if (limits === null || (typeof limits.limitId === 'string' && limits.limitId !== 'codex')) {
        return null;
    }
    const plan = typeof limits.planType === 'string' ? limits.planType : null;
    const windows: UsageWindow[] = [];
    for (const [position, entry] of [
        ['primary', limits.primary],
        ['secondary', limits.secondary]
    ] as const) {
        const window = isRecord(entry) ? entry : null;
        const usedPercent = window === null ? null : num(window.usedPercent);
        if (usedPercent === null) {
            continue;
        }
        const minutes = num(window?.windowDurationMins);
        const durationMs = minutes === null ? null : Math.round(minutes * MINUTE_MS);
        const kind = kindOfDuration(durationMs);
        const resetsAt = num(window?.resetsAt);
        windows.push({
            id: position,
            kind,
            label: kind === 'session' ? 'Session' : kind === 'weekly' ? 'Weekly' : kind === 'monthly' ? 'Monthly' : 'Usage',
            used: fraction(usedPercent / 100),
            resetsAt: resetsAt === null ? null : Math.round(resetsAt * 1000),
            durationMs
        });
    }
    return { plan, windows, cost: null };
};

/*
 * A sparse update folded onto what a full read drew. The row keeps its label, its reset and its
 * length when the event leaves them out, which is what makes a mid-turn number land on the bar it
 * belongs to instead of drawing a second one beside it.
 */
export const mergeWindows = (known: readonly UsageWindow[], updates: readonly Partial<UsageWindow>[]): UsageWindow[] => {
    const merged = known.map((window) => ({ ...window }));
    for (const update of updates) {
        if (update.id === undefined || update.used === undefined) {
            continue;
        }
        const at = merged.findIndex((window) => window.id === update.id);
        if (at === -1) {
            merged.push({
                id: update.id,
                kind: update.kind ?? 'other',
                label: update.label ?? 'Usage',
                used: update.used,
                resetsAt: update.resetsAt ?? null,
                durationMs: update.durationMs ?? null
            });
            continue;
        }
        merged[at] = { ...merged[at]!, ...update } as UsageWindow;
    }
    return merged;
};

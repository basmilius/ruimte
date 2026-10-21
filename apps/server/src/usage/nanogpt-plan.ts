import type { UsageWindow } from '@ruimte/contracts';
import { fraction, type ProbeResult } from '@adecore/agents/usage';

const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;

/*
 * What the subscription API says about its quota: a counter per window, each with the amount used, a fraction
 * that can pass one, and the moment it resets in epoch milliseconds. A counter that could not be read says
 * so (`degraded`) and is left out, since an unknown amount is not an empty one.
 */
const NANOGPT_WINDOWS: { key: string; id: string; label: string; kind: UsageWindow['kind']; durationMs: number }[] = [
    { key: 'dailyInputTokens', id: 'daily_input', label: 'Daily', kind: 'session', durationMs: DAY_MS },
    { key: 'weeklyInputTokens', id: 'weekly_input', label: 'Weekly', kind: 'weekly', durationMs: WEEK_MS },
    { key: 'dailyImages', id: 'daily_images', label: 'Daily images', kind: 'session', durationMs: DAY_MS }
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/* The answer of `/usage` as the windows of the usage page. */
export function readNanoGptUsage(response: unknown): ProbeResult {
    if (!isRecord(response)) {
        return { unavailable: { reason: 'failed', message: 'NanoGPT returned no readable usage' } };
    }
    if (response.active === false || response.state === 'inactive') {
        return { unavailable: { reason: 'no-subscription', message: 'The NanoGPT subscription is not active.' } };
    }
    const limits = isRecord(response.limits) ? response.limits : {};
    const windows: UsageWindow[] = [];
    for (const known of NANOGPT_WINDOWS) {
        const counter = response[known.key];
        if (!isRecord(counter) || counter.degraded === true) {
            continue;
        }
        const used = num(counter.used);
        const limit = num(limits[known.key]);
        const percent = num(counter.percentUsed) ?? (used !== null && limit !== null && limit > 0 ? used / limit : null);
        if (percent === null) {
            continue;
        }
        const resetsAt = num(counter.resetAt);
        windows.push({
            id: known.id,
            label: known.label,
            kind: known.kind,
            used: fraction(percent),
            resetsAt: resetsAt === null ? null : Math.round(resetsAt),
            durationMs: known.durationMs
        });
    }
    return { plan: response.state === 'grace' ? 'Grace period' : 'Subscription', windows, cost: null };
}

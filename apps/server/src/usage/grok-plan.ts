import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageWindow } from '@ruimte/contracts';
import { isNotFound } from '@adecore/agents';
import { fraction, type ProbeEnv, type ProbeResult } from '@adecore/agents/usage';

/* The billing view Grok's own `/usage` reads, on the proxy its CLI talks to. Undocumented, so any other shape is a failed read. */
const GROK_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';

/* The entries of `auth.json` that are xAI's own sign-in; any other issuer is a deployment whose token never goes to grok.com. */
const XAI_ISSUERS = ['https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828', 'https://accounts.x.ai/sign-in'];

const PERIODS: Record<string, { kind: UsageWindow['kind']; label: string }> = {
    USAGE_PERIOD_TYPE_WEEKLY: { kind: 'weekly', label: 'Weekly' },
    USAGE_PERIOD_TYPE_MONTHLY: { kind: 'monthly', label: 'Monthly' }
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timeOf(value: unknown): number | null {
    const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    return Number.isFinite(time) ? time : null;
}

/* The billing answer as the one window of the subscription. */
export function readGrokBilling(response: unknown): ProbeResult {
    const config = isRecord(response) && isRecord(response.config) ? response.config : null;
    if (config === null) {
        return { unavailable: { reason: 'failed', message: 'Grok returned no readable usage' } };
    }
    const period = isRecord(config.currentPeriod) ? config.currentPeriod : {};
    const known = PERIODS[String(period.type)] ?? { kind: 'other', label: 'Subscription' };
    const start = timeOf(period.start);
    const end = timeOf(period.end);
    // Grok leaves the percentage out of a period nothing was spent in yet.
    const percent = typeof config.creditUsagePercent === 'number' ? config.creditUsagePercent : start !== null && end !== null && start < end ? 0 : null;
    if (percent === null || !Number.isFinite(percent)) {
        return { plan: null, windows: [], cost: null };
    }
    const window: UsageWindow = {
        id: 'subscription',
        kind: known.kind,
        label: known.label,
        used: fraction(percent / 100),
        resetsAt: end,
        durationMs: start !== null && end !== null && start < end ? end - start : null
    };
    return { plan: null, windows: [window], cost: null };
}

/*
 * What is left of a Grok subscription. Its CLI shows this only in its own interface, so this reads the
 * token `grok login` left in the account's home and sends it to the endpoint the CLI asks, nowhere else.
 * The token is only read: renewing it is the CLI's, so one that ran out waits until Grok runs again.
 */
export async function readGrokPlan(env: ProbeEnv, request: typeof fetch = fetch, now: () => number = Date.now): Promise<ProbeResult> {
    if (env.XAI_API_KEY?.trim()) {
        return { unavailable: { reason: 'no-subscription', message: null } };
    }
    const home = env.GROK_HOME?.trim() || join(env.HOME ?? homedir(), '.grok');
    let auth: unknown;
    try {
        auth = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8'));
    } catch (e) {
        if (isNotFound(e)) {
            return { unavailable: { reason: 'failed', message: 'Sign in to Grok first.' } };
        }
        throw e;
    }
    const entry = isRecord(auth) ? XAI_ISSUERS.map((issuer) => auth[issuer]).find(isRecord) : undefined;
    if (entry === undefined || entry.auth_mode === 'api_key') {
        return { unavailable: { reason: 'no-subscription', message: null } };
    }
    const token = typeof entry.key === 'string' ? entry.key.trim() : '';
    const expiresAt = timeOf(entry.expires_at);
    if (token === '' || (expiresAt !== null && expiresAt <= now())) {
        return { unavailable: { reason: 'failed', message: 'Open Grok to renew its sign-in.' } };
    }
    const response = await request(GROK_BILLING_URL, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000)
    });
    if (response.status === 401 || response.status === 403) {
        return { unavailable: { reason: 'failed', message: 'Open Grok to renew its sign-in.' } };
    }
    if (!response.ok) {
        throw new Error(`Grok answered ${response.status}`);
    }
    return readGrokBilling(await response.json());
}

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGrokBilling, readGrokPlan } from './grok-plan.ts';

const NOW = Date.parse('2026-10-23T08:00:00Z');
const ISSUER = 'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828';

// As Grok 1.0.62's proxy answered for a weekly plan.
const WEEKLY = {
    config: {
        currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-10-21T07:37:42.360+00:00', end: '2026-10-28T07:37:42.360+00:00' },
        creditUsagePercent: 17.0,
        isUnifiedBillingUser: true
    }
};

let home: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-grok-plan-'));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

async function signIn(entry: Record<string, unknown>): Promise<void> {
    await writeFile(join(home, 'auth.json'), JSON.stringify({ [ISSUER]: entry }));
}

function answering(status: number, body: unknown, asked: { url: string; authorization: string | null }[] = []): typeof fetch {
    return (async (url: string, init?: RequestInit) => {
        asked.push({ url, authorization: new Headers(init?.headers).get('authorization') });
        return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
}

describe('the billing of a Grok subscription', () => {
    test('is one window with its reset and length', () => {
        expect(readGrokBilling(WEEKLY)).toEqual({
            plan: null,
            windows: [
                {
                    id: 'subscription',
                    kind: 'weekly',
                    label: 'Weekly',
                    used: 0.17,
                    resetsAt: Date.parse('2026-10-28T07:37:42.360Z'),
                    durationMs: 7 * 24 * 60 * 60_000
                }
            ],
            cost: null
        });
    });

    test('reads a period nothing was spent in yet as empty, not unknown', () => {
        const { creditUsagePercent: _left, ...config } = WEEKLY.config;
        expect(readGrokBilling({ config })).toMatchObject({ windows: [{ used: 0 }] });
    });

    test('has no window when it names no share at all', () => {
        expect(readGrokBilling({ config: {} })).toEqual({ plan: null, windows: [], cost: null });
    });
});

describe('reading a Grok plan', () => {
    test('sends the token of the account only to the proxy the CLI asks', async () => {
        await signIn({ auth_mode: 'oidc', key: 'token-1', expires_at: '2026-10-23T09:00:00Z' });
        const asked: { url: string; authorization: string | null }[] = [];

        const result = await readGrokPlan({ GROK_HOME: home }, answering(200, WEEKLY, asked), () => NOW);

        expect(asked).toEqual([{ url: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits', authorization: 'Bearer token-1' }]);
        expect(result).toMatchObject({ windows: [{ used: 0.17 }] });
    });

    test('asks nothing for an API key, which has no plan', async () => {
        await signIn({ auth_mode: 'api_key', key: 'xai-key' });
        const asked: { url: string; authorization: string | null }[] = [];

        expect(await readGrokPlan({ GROK_HOME: home }, answering(200, WEEKLY, asked), () => NOW)).toEqual({
            unavailable: { reason: 'no-subscription', message: null }
        });
        expect(await readGrokPlan({ GROK_HOME: home, XAI_API_KEY: 'xai-key' }, answering(200, WEEKLY, asked), () => NOW)).toEqual({
            unavailable: { reason: 'no-subscription', message: null }
        });
        expect(asked).toEqual([]);
    });

    test('leaves a token that ran out to the CLI, which renews it', async () => {
        await signIn({ auth_mode: 'oidc', key: 'token-1', expires_at: '2026-10-23T07:59:00Z' });
        const asked: { url: string; authorization: string | null }[] = [];

        expect(await readGrokPlan({ GROK_HOME: home }, answering(200, WEEKLY, asked), () => NOW)).toEqual({
            unavailable: { reason: 'failed', message: 'Open Grok to renew its sign-in.' }
        });
        expect(asked).toEqual([]);
    });

    test('says so when the proxy turns the token down', async () => {
        await signIn({ auth_mode: 'oidc', key: 'token-1' });

        expect(await readGrokPlan({ GROK_HOME: home }, answering(401, {}), () => NOW)).toEqual({
            unavailable: { reason: 'failed', message: 'Open Grok to renew its sign-in.' }
        });
    });

    test('asks to sign in when Grok has no login here', async () => {
        expect(await readGrokPlan({ GROK_HOME: home }, answering(200, WEEKLY), () => NOW)).toEqual({
            unavailable: { reason: 'failed', message: 'Sign in to Grok first.' }
        });
    });
});

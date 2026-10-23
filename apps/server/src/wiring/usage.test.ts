import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderAccountsService, ProviderRegistry } from '@adecore/agents/providers';
import { UsageService, usageRootsOf, type LimitAccounts } from '@adecore/agents/usage';
import { grokProvider } from '../providers/acp-providers.ts';
import { withoutNanoGptUntilKeyed } from './usage.ts';

let root: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-usage-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('usage of Grok', () => {
    test('a session Grok counted under GROK_HOME shows on the usage page with its cost', async () => {
        const grokHome = join(root, 'grok');
        const session = join(grokHome, 'sessions', encodeURIComponent('/work/site'), 'session-1');
        await mkdir(session, { recursive: true });
        const endedAt = '2026-10-01T11:00:00.000Z';
        await writeFile(
            join(session, 'usage.json'),
            JSON.stringify({
                sessionId: 'session-1',
                turns: [
                    {
                        turnNumber: 1,
                        endedAt,
                        modelUsage: {
                            'grok-code-fast-1': { modelCalls: 2, inputTokens: 1500, cachedReadTokens: 500, outputTokens: 200, costUsdTicks: 25_000_000 }
                        }
                    }
                ]
            })
        );
        const accounts = new ProviderAccountsService({
            home: join(root, 'ruimte'),
            providers: new ProviderRegistry({ providers: [grokProvider], detect: async () => ({ installed: true, version: null }) }),
            env: { HOME: root, GROK_HOME: grokHome },
            secrets: null,
            folderExists: () => true
        });
        await accounts.load();
        const usage = new UsageService({
            home: join(root, 'ruimte'),
            allowPriceFetch: false,
            knownProjects: async () => [],
            roots: () => usageRootsOf(accounts)
        });
        const day = endedAt.slice(0, 10);

        const summary = await usage.summary({ from: day, to: day, resolution: 'day', timeZone: 'UTC' });

        expect(summary.models).toEqual([
            expect.objectContaining({
                provider: 'grok',
                model: 'grok-code-fast-1',
                totals: expect.objectContaining({ input: 1000, cacheRead: 500, output: 200 }),
                costUsd: 0.0025
            })
        ]);
        expect(summary.sessions).toBe(1);
    });
});

describe('plan limits of NanoGPT', () => {
    const accounts: LimitAccounts = {
        list: () => [
            { id: 'claude', kind: 'claude', label: 'Claude', isDefault: true },
            { id: 'nanogpt', kind: 'nanogpt', label: 'NanoGPT', isDefault: true }
        ],
        envFor: () => ({}),
        lastUsedAt: () => null
    };

    test('are left out while no key is set, and come back once one is', () => {
        let keyed = false;
        const limited = withoutNanoGptUntilKeyed(accounts, () => keyed);

        expect(limited.list().map((account) => account.kind)).toEqual(['claude']);
        keyed = true;
        expect(limited.list().map((account) => account.kind)).toEqual(['claude', 'nanogpt']);
    });
});

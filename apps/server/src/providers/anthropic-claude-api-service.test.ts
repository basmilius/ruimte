import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageService } from '@adecore/agents/usage';
import {
    ANTHROPIC_URL,
    ANTHROPIC_VERSION,
    AnthropicClaudeApiService,
    anthropicHttpError,
    defaultModelOf,
    type AnthropicFetch
} from './anthropic-claude-api-service.ts';

const homes: string[] = [];
afterEach(async () => {
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function home(): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), 'ruimte-claude-api-'));
    homes.push(folder);
    return folder;
}

const MODELS = [
    {
        id: 'claude-opus-5-5',
        display_name: 'Claude Opus 5.5',
        created_at: '2026-09-21T00:00:00Z',
        lifecycle: 'active',
        line: 'opus',
        max_input_tokens: 1_000_000,
        max_tokens: 64_000
    },
    {
        id: 'claude-sonnet-5-5',
        display_name: 'Claude Sonnet 5.5',
        created_at: '2026-09-20T00:00:00Z',
        lifecycle: 'active',
        line: 'sonnet',
        max_input_tokens: 500_000,
        max_tokens: 32_000
    },
    {
        id: 'claude-sonnet-4-6',
        display_name: 'Claude Sonnet 4.6',
        created_at: '2026-02-01T00:00:00Z',
        lifecycle: 'deprecated',
        line: 'sonnet',
        max_input_tokens: 200_000,
        max_tokens: 16_000
    },
    { id: 'claude-2-old', display_name: 'Claude 2', created_at: '2023-07-01T00:00:00Z', lifecycle: 'retired', line: null }
];

function api(options: { status?: number; pages?: Array<{ data: unknown[]; has_more: boolean; last_id: string | null }> } = {}): {
    request: AnthropicFetch;
    calls: Array<{ url: string; init?: RequestInit }>;
} {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const pages = options.pages ?? [{ data: MODELS, has_more: false, last_id: null }];
    return {
        calls,
        request: async (url, init) => {
            calls.push({ url, init });
            if (options.status !== undefined && options.status !== 200) {
                return new Response('{"error":{"message":"the body is never read"}}', { status: options.status });
            }
            return new Response(JSON.stringify(pages[Math.min(calls.length - 1, pages.length - 1)]));
        }
    };
}

describe('Claude API key and models', () => {
    test('a saved key is checked with the model list, sent only to Anthropic and never redirected', async () => {
        const folder = await home();
        const { request, calls } = api();
        const service = new AnthropicClaudeApiService(request);
        await service.load(folder);

        expect(await service.configure('  sk-ant-key  ')).toMatchObject({ configured: true, models: 3 });
        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe(`${ANTHROPIC_URL}/v1/models?limit=1000`);
        expect(calls[0]!.init?.redirect).toBe('error');
        const headers = new Headers(calls[0]!.init?.headers);
        expect(headers.get('x-api-key')).toBe('sk-ant-key');
        expect(headers.get('anthropic-version')).toBe(ANTHROPIC_VERSION);
    });

    test('the models are the ones that are not retired, the deprecated ones are legacy, and the default is the newest Sonnet', async () => {
        const folder = await home();
        const service = new AnthropicClaudeApiService(api().request);
        await service.load(folder);
        await service.configure('sk-ant-key');

        expect(service.catalog.list().map((model) => [model.slug, model.name, model.legacy])).toEqual([
            ['claude-opus-5-5', 'Claude Opus 5.5', false],
            ['claude-sonnet-5-5', 'Claude Sonnet 5.5', false],
            ['claude-sonnet-4-6', 'Claude Sonnet 4.6', true]
        ]);
        expect(service.catalog.defaultModel).toBe('claude-sonnet-5-5');
        expect(service.catalog.contextWindowFor({ model: 'claude-opus-5-5', options: {} })).toBe(1_000_000);
    });

    test('follows the pages of a long list by their cursor and stops when there is no more', async () => {
        const folder = await home();
        const { request, calls } = api({
            pages: [
                { data: [MODELS[0]], has_more: true, last_id: 'claude-opus-5-5' },
                { data: [MODELS[1]], has_more: false, last_id: 'claude-sonnet-5-5' }
            ]
        });
        const service = new AnthropicClaudeApiService(request);
        await service.load(folder);

        expect((await service.configure('sk-ant-key')).models).toBe(2);
        expect(calls.map((call) => call.url)).toEqual([
            `${ANTHROPIC_URL}/v1/models?limit=1000`,
            `${ANTHROPIC_URL}/v1/models?limit=1000&after_id=claude-opus-5-5`
        ]);
    });

    test('the key survives a restart in a file only the owner reads', async () => {
        const folder = await home();
        const first = new AnthropicClaudeApiService(api().request);
        await first.load(folder);
        await first.configure('sk-ant-key');

        const again = new AnthropicClaudeApiService(api().request);
        await again.load(folder);
        expect(again.apiKey).toBe('sk-ant-key');
        expect(again.status()).toMatchObject({ configured: true, models: 3 });
        expect(await readFile(join(folder, 'anthropic-claude-api', 'credential'), 'utf8')).toBe('sk-ant-key');
        if (process.platform !== 'win32') {
            expect((await stat(join(folder, 'anthropic-claude-api', 'credential'))).mode & 0o777).toBe(0o600);
        }
    });

    test('a rejected key is not saved and says so without the body', async () => {
        const folder = await home();
        const service = new AnthropicClaudeApiService(api({ status: 401 }).request);
        await service.load(folder);

        await expect(service.configure('wrong-key')).rejects.toThrow('Anthropic rejected the API key.');
        expect(service.status()).toMatchObject({ configured: false, models: 0 });
        await expect(stat(join(folder, 'anthropic-claude-api', 'credential'))).rejects.toThrow();
    });

    test('a key with no models, and a key with a space in it, are refused', async () => {
        const folder = await home();
        const empty = new AnthropicClaudeApiService(api({ pages: [{ data: [], has_more: false, last_id: null }] }).request);
        await empty.load(folder);
        await expect(empty.configure('sk-ant-key')).rejects.toThrow('Anthropic returned no models for this key.');
        await expect(empty.configure('two words')).rejects.toThrow('Enter an Anthropic API key.');
    });

    test('disconnecting removes the key and the models, and a refresh asks again with the saved key', async () => {
        const folder = await home();
        const { request, calls } = api();
        const service = new AnthropicClaudeApiService(request);
        await service.load(folder);
        await expect(service.configure()).rejects.toThrow('Enter an Anthropic API key.');
        await service.configure('sk-ant-key');
        await service.configure();
        expect(new Headers(calls[1]!.init?.headers).get('x-api-key')).toBe('sk-ant-key');

        expect(await service.configure('')).toMatchObject({ configured: false, models: 0 });
        expect(service.catalog.list()).toEqual([]);
        await expect(stat(join(folder, 'anthropic-claude-api', 'credential'))).rejects.toThrow();
    });
});

describe('what an HTTP status says', () => {
    test('is a fixed sentence, except a 400, which carries Anthropic words clipped', () => {
        expect(anthropicHttpError(401).message).toBe('Anthropic rejected the API key.');
        expect(anthropicHttpError(429).message).toContain('rate limit');
        expect(anthropicHttpError(529).message).toContain('overloaded');
        expect(anthropicHttpError(500).message).toBe('Anthropic request failed (HTTP 500).');
        expect(anthropicHttpError(400, 'Your credit balance is too low').message).toBe('Anthropic refused the request: Your credit balance is too low');
        expect(anthropicHttpError(400, 'x'.repeat(1000)).message.length).toBeLessThan(400);
        // Another status never reads a body, so nothing of it can leak.
        expect(anthropicHttpError(403, 'secret').message).not.toContain('secret');
    });

    test('picks the newest Sonnet, else the newest active model, else the first', () => {
        expect(defaultModelOf([])).toBe('');
        expect(
            defaultModelOf([
                { id: 'a', created_at: '2026-01-01', lifecycle: 'active', line: 'opus' },
                { id: 'b', created_at: '2026-02-01', lifecycle: 'active', line: 'haiku' }
            ])
        ).toBe('b');
        expect(defaultModelOf([{ id: 'only', lifecycle: 'deprecated' }])).toBe('only');
    });
});

describe('Claude API settings', () => {
    test('start with continuing off, since every call is paid for, and come back after a restart', async () => {
        const folder = await home();
        const first = new AnthropicClaudeApiService(api().request);
        await first.load(folder);
        expect(first.status().settings).toEqual({ autoContinue: false, roundsPerRun: 40, runs: 3, maxOutputTokens: 8192 });
        expect(first.runLimits()).toEqual({ roundsPerRun: 40, runs: 1 });

        await first.setSettings({ autoContinue: true, runs: 2 });
        expect(first.runLimits()).toEqual({ roundsPerRun: 40, runs: 2 });
        const again = new AnthropicClaudeApiService(api().request);
        await again.load(folder);
        expect(again.status().settings).toEqual({ autoContinue: true, roundsPerRun: 40, runs: 2, maxOutputTokens: 8192 });
    });

    test('stay inside what the wire allows, and a refused change changes nothing', async () => {
        const folder = await home();
        const service = new AnthropicClaudeApiService(api().request);
        await service.load(folder);
        await expect(service.setSettings({ roundsPerRun: 4 })).rejects.toThrow();
        await expect(service.setSettings({ runs: 21 })).rejects.toThrow();
        await expect(service.setSettings({ maxOutputTokens: 100 })).rejects.toThrow();
        await expect(service.setSettings({ maxOutputTokens: 12.5 })).rejects.toThrow();
        expect(service.status().settings).toEqual({ autoContinue: false, roundsPerRun: 40, runs: 3, maxOutputTokens: 8192 });
    });

    test('a file that cannot be read leaves the defaults', async () => {
        const folder = await home();
        const first = new AnthropicClaudeApiService(api().request);
        await first.load(folder);
        await first.setSettings({ runs: 2 });
        await Bun.write(join(folder, 'anthropic-claude-api', 'settings.json'), '{"autoContinue":"yes"}');

        const again = new AnthropicClaudeApiService(api().request);
        await again.load(folder);
        expect(again.status().settings?.runs).toBe(3);
    });

    test('a model that takes adaptive thinking says so, since that is how it is asked to think', async () => {
        const folder = await home();
        const withThinking = {
            id: 'claude-opus-4-6',
            display_name: 'Claude Opus 4.6',
            lifecycle: 'active',
            capabilities: { thinking: { supported: true, types: { adaptive: { supported: true } } } }
        };
        const without = {
            id: 'claude-haiku-4-5',
            display_name: 'Claude Haiku 4.5',
            lifecycle: 'active',
            capabilities: { thinking: { supported: false, types: { adaptive: { supported: false } } } }
        };
        const service = new AnthropicClaudeApiService(api({ pages: [{ data: [withThinking, without], has_more: false, last_id: null }] }).request);
        await service.load(folder);
        await service.configure('sk-ant-key');
        expect(service.supportsAdaptiveThinking('claude-opus-4-6')).toBe(true);
        expect(service.supportsAdaptiveThinking('claude-haiku-4-5')).toBe(false);
        expect(service.supportsAdaptiveThinking('unknown')).toBe(false);
    });

    test('the tokens of a reply are what a person set, never more than the model allows', async () => {
        const folder = await home();
        const service = new AnthropicClaudeApiService(api().request);
        await service.load(folder);
        await service.configure('sk-ant-key');
        await service.setSettings({ maxOutputTokens: 50_000 });
        expect(service.maxOutputTokensFor('claude-opus-5-5')).toBe(50_000);
        expect(service.maxOutputTokensFor('claude-sonnet-5-5')).toBe(32_000);
        expect(service.maxOutputTokensFor('unknown-model')).toBe(50_000);
    });
});

describe('Claude API usage', () => {
    test('a call is added to the log of its month with the cache kinds apart, and a write has its own count', async () => {
        const folder = await home();
        const service = new AnthropicClaudeApiService(api().request);
        await service.load(folder);
        await service.logUsage({ model: 'claude-sonnet-5-5', session: 's-1', cwd: '/work', input: 120, cacheRead: 9000, cacheWrite: 400, output: 250 });

        const [file] = await readdir(service.usageDirectory);
        expect(file).toMatch(/^\d{4}-\d{2}\.jsonl$/);
        const lines = (await readFile(join(service.usageDirectory, file!), 'utf8')).trim().split('\n');
        expect(lines.map((line) => JSON.parse(line))).toEqual([
            expect.objectContaining({
                model: 'claude-sonnet-5-5',
                session: 's-1',
                cwd: '/work',
                input: 120,
                cacheRead: 9000,
                cacheWrite: 400,
                output: 250,
                reasoning: 0
            })
        ]);
        expect(typeof JSON.parse(lines[0]!).at).toBe('number');
    });

    test('a logged call shows on the usage page under its provider, with its tokens, cache writes and a price', async () => {
        const folder = await home();
        const service = new AnthropicClaudeApiService(api().request);
        await service.load(folder);
        await service.logUsage({ model: 'claude-sonnet-5-5', session: 's-1', cwd: '/work', input: 120, cacheRead: 9000, cacheWrite: 400, output: 250 });

        const usage = new UsageService({
            home: folder,
            allowPriceFetch: false,
            knownProjects: async () => [],
            roots: () => [{ provider: 'anthropic-claude-api', path: service.usageDirectory }]
        });
        const today = new Date().toISOString().slice(0, 10);
        const summary = await usage.summary({ from: today, to: today, resolution: 'day', timeZone: 'UTC' });
        usage.stop();

        expect(summary.roots).toEqual([expect.objectContaining({ provider: 'anthropic-claude-api', status: 'ok' })]);
        expect(summary.models).toEqual([expect.objectContaining({ provider: 'anthropic-claude-api', model: 'claude-sonnet-5-5' })]);
        expect(summary.models[0]!.totals).toMatchObject({ calls: 1, input: 120, cacheRead: 9000, cacheWrite: 400, output: 250 });
    });

    test('a log that cannot be written never fails the call', async () => {
        const service = new AnthropicClaudeApiService(api().request);
        // Not loaded, so there is no folder to write in.
        await expect(service.logUsage({ model: 'm', session: 's', cwd: '/', input: 1, cacheRead: 0, cacheWrite: 0, output: 1 })).resolves.toBeUndefined();
    });
});

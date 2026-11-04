import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ModelCatalog } from '@adecore/agents/providers';
import claudeManifest from '@adecore/agents/providers/claude-models.json' with { type: 'json' };
import { ModelCatalogDataSchema } from '@ruimte/contracts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { ANTHROPIC_URL, ANTHROPIC_VERSION, AnthropicClaudeApiService, anthropicHttpError, defaultModelOf } from './anthropic-claude-api-service.ts';
import type { ApiFetch } from './keyed-api-service.ts';

const home = tempHomes('ruimte-claude-api-');
beforeEach(() => setSystemTime(new Date('2026-10-24T12:00:00Z')));
afterEach(() => setSystemTime());

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
    request: ApiFetch;
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

describe('the options of a Claude API model', () => {
    const claude = new ModelCatalog();
    const optionsOf = (service: AnthropicClaudeApiService, slug: string) => service.catalog.list().find((model) => model.slug === slug)?.options ?? [];

    test("are those of the same model in Claude Code's catalog, with its windows", async () => {
        const service = new AnthropicClaudeApiService(api().request, claude);
        await service.load(await home());
        await service.configure('sk-ant-key');

        const known = claude.list().find((model) => model.slug === 'claude-sonnet-5-5')!;
        expect(optionsOf(service, 'claude-sonnet-5-5')).toEqual(known.options);
        expect(optionsOf(service, 'claude-sonnet-5-5').find((option) => option.id === 'effort')).toMatchObject({ type: 'select', defaultChoice: 'high' });
        expect(service.catalog.contextWindowFor({ model: 'claude-sonnet-5-5', options: { contextWindow: '200k' } })).toBe(200_000);
        expect(service.catalog.contextWindowFor({ model: 'claude-sonnet-5-5', options: { contextWindow: '1m' } })).toBe(1_000_000);
    });

    test('a model Claude Code does not know thinks on request only when the API says so, and keeps its own window', async () => {
        const thinking = {
            id: 'claude-new-thinker',
            lifecycle: 'active',
            max_input_tokens: 300_000,
            capabilities: { thinking: { types: { adaptive: { supported: true } } } }
        };
        const plain = { id: 'claude-new-plain', lifecycle: 'active', capabilities: { thinking: { types: { adaptive: { supported: false } } } } };
        const service = new AnthropicClaudeApiService(api({ pages: [{ data: [thinking, plain], has_more: false, last_id: null }] }).request, claude);
        await service.load(await home());
        await service.configure('sk-ant-key');

        expect(optionsOf(service, 'claude-new-thinker').map((option) => option.id)).toEqual(['effort']);
        expect(optionsOf(service, 'claude-new-plain')).toEqual([]);
        expect(service.catalog.contextWindowFor({ model: 'claude-new-thinker', options: {} })).toBe(300_000);
    });

    test('start a new chat on the window a person chose, 200k unless they chose otherwise', async () => {
        const service = new AnthropicClaudeApiService(api().request, claude);
        await service.load(await home());
        await service.configure('sk-ant-key');
        const changes: number[] = [];
        service.onChange(() => changes.push(1));
        const windowOf = () => service.catalog.normalize({ model: 'claude-sonnet-5-5' }).options.contextWindow;

        expect(windowOf()).toBe('200k');
        await service.setSettings({ contextWindow: '1m' });
        expect(windowOf()).toBe('1m');
        expect(changes).toHaveLength(1);
        // A chat that picked a window keeps it.
        expect(service.catalog.normalize({ model: 'claude-sonnet-5-5', options: { contextWindow: '200k' } }).options.contextWindow).toBe('200k');

        await service.setSettings({ maxOutputTokens: 16_000 });
        expect(changes).toHaveLength(1);
    });

    test("follow Claude Code's catalog when it learns a model later", async () => {
        const later = new ModelCatalog({
            updatedAt: '2026-01-01T00:00:00Z',
            defaultModel: 'other',
            profiles: {},
            models: [{ slug: 'other', name: 'Other', profile: 'none' }]
        });
        const service = new AnthropicClaudeApiService(api().request, later);
        await service.load(await home());
        await service.configure('sk-ant-key');
        expect(optionsOf(service, 'claude-sonnet-5-5')).toEqual([]);

        const changes: number[] = [];
        service.onChange(() => changes.push(1));
        later.replace({ ...ModelCatalogDataSchema.parse(claudeManifest), updatedAt: '2026-11-01T00:00:00Z' });
        service.rebuildCatalog();

        expect(optionsOf(service, 'claude-sonnet-5-5').map((option) => option.id)).toContain('effort');
        expect(changes).toHaveLength(1);
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
        expect(first.status().settings).toEqual({ autoContinue: false, roundsPerRun: 40, runs: 3, maxOutputTokens: 32_000, contextWindow: '200k' });
        expect(first.runLimits()).toEqual({ roundsPerRun: 40, runs: 1 });

        await first.setSettings({ autoContinue: true, runs: 2 });
        expect(first.runLimits()).toEqual({ roundsPerRun: 40, runs: 2 });
        const again = new AnthropicClaudeApiService(api().request);
        await again.load(folder);
        expect(again.status().settings).toEqual({ autoContinue: true, roundsPerRun: 40, runs: 2, maxOutputTokens: 32_000, contextWindow: '200k' });
    });

    test('stay inside what the wire allows, and a refused change changes nothing', async () => {
        const folder = await home();
        const service = new AnthropicClaudeApiService(api().request);
        await service.load(folder);
        await expect(service.setSettings({ roundsPerRun: 4 })).rejects.toThrow();
        await expect(service.setSettings({ runs: 21 })).rejects.toThrow();
        await expect(service.setSettings({ maxOutputTokens: 100 })).rejects.toThrow();
        await expect(service.setSettings({ maxOutputTokens: 12.5 })).rejects.toThrow();
        await expect(service.setSettings({ contextWindow: '2m' as never })).rejects.toThrow();
        expect(service.status().settings).toEqual({ autoContinue: false, roundsPerRun: 40, runs: 3, maxOutputTokens: 32_000, contextWindow: '200k' });
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

    test('settings sent along with a key Anthropic rejects are not kept', async () => {
        const folder = await home();
        const service = new AnthropicClaudeApiService(api({ status: 401 }).request);
        await service.load(folder);

        await expect(service.apply({ apiKey: 'sk-ant-wrong', settings: { autoContinue: true } })).rejects.toThrow('Anthropic rejected the API key.');
        expect(service.status()).toMatchObject({ configured: false, settings: { autoContinue: false } });

        const again = new AnthropicClaudeApiService(api().request);
        await again.load(folder);
        expect(again.status().settings?.autoContinue).toBe(false);
    });

    test('settings alone are kept without asking Anthropic, and with an accepted key both are', async () => {
        const folder = await home();
        const { request, calls } = api();
        const service = new AnthropicClaudeApiService(request);
        await service.load(folder);

        expect(await service.apply({ settings: { runs: 5 } })).toMatchObject({ configured: false, settings: { runs: 5 } });
        expect(calls).toHaveLength(0);
        expect(await service.apply({ apiKey: 'sk-ant-key', settings: { autoContinue: true } })).toMatchObject({
            configured: true,
            settings: { autoContinue: true, runs: 5 }
        });
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

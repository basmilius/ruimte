import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageService } from '@adecore/agents/usage';
import { NANOGPT_URL, NanoGptService, type NanoFetch } from './nanogpt-service.ts';

const homes: string[] = [];
afterEach(async () => {
    setSystemTime();
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function home(): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), 'ruimte-nanogpt-'));
    homes.push(folder);
    return folder;
}

const MODELS = {
    data: [
        { id: 'plain-chat', name: 'Plain chat' },
        { id: 'tool-model', name: 'Tool model', context_length: 128_000, capabilities: { tool_calling: true } },
        { id: 'tool-model:online', name: 'Tool model online', capabilities: { tool_calling: true } }
    ]
};

function api(status = 200): { request: NanoFetch; calls: Array<{ url: string; init?: RequestInit }> } {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    return {
        calls,
        request: async (url, init) => {
            calls.push({ url, init });
            // Like NanoGPT, the model list answers any key; only the usage checks it.
            if (url === `${NANOGPT_URL}/usage`) {
                return new Response('{}', { status });
            }
            return new Response(JSON.stringify(MODELS));
        }
    };
}

describe('NanoGPT subscription', () => {
    test('a saved key is checked against the subscription API and offers only the plain included models', async () => {
        const folder = await home();
        const { request, calls } = api();
        const service = new NanoGptService(request);
        await service.load(folder);

        expect(await service.configure('  nano-key  ')).toMatchObject({ configured: true, models: 2 });
        expect(calls.map((call) => call.url)).toEqual([`${NANOGPT_URL}/usage`, `${NANOGPT_URL}/models?detailed=true`]);
        for (const call of calls) {
            expect(call.init?.redirect).toBe('error');
            expect(new Headers(call.init?.headers).get('authorization')).toBe('Bearer nano-key');
        }
        expect(service.catalog.list().map((model) => model.slug)).toEqual(['plain-chat', 'tool-model']);
        // The default is a model that can use the project tools.
        expect(service.catalog.defaultModel).toBe('tool-model');
        expect(service.catalog.contextWindowFor({ model: 'tool-model', options: {} })).toBe(128_000);
        expect(service.supportsTools('tool-model')).toBe(true);
        expect(service.supportsTools('plain-chat')).toBe(false);
        // The picker marks the models that can use tools; every model here is the subscription's, so none carries a badge.
        expect(service.catalog.list().map((model) => [model.tools, model.badge])).toEqual([
            [false, undefined],
            [true, undefined]
        ]);
    });

    test('the key survives a restart and only the owner of the file reads it', async () => {
        const folder = await home();
        const first = new NanoGptService(api().request);
        await first.load(folder);
        await first.configure('nano-key');

        const again = new NanoGptService(api().request);
        await again.load(folder);
        expect(again.apiKey).toBe('nano-key');
        expect(again.status()).toMatchObject({ configured: true, models: 2 });
        expect(await readFile(join(folder, 'nanogpt', 'credential'), 'utf8')).toBe('nano-key');
        if (process.platform !== 'win32') {
            expect((await stat(join(folder, 'nanogpt', 'credential'))).mode & 0o777).toBe(0o600);
        }
    });

    test('a rejected key is not saved and says why without the response body', async () => {
        const folder = await home();
        const service = new NanoGptService(api(401).request);
        await service.load(folder);

        await expect(service.configure('wrong-key')).rejects.toThrow('NanoGPT rejected the API key.');
        expect(service.status()).toMatchObject({ configured: false, models: 0 });
        await expect(stat(join(folder, 'nanogpt', 'credential'))).rejects.toThrow();
    });

    test('a subscription without included models is refused', async () => {
        const folder = await home();
        const service = new NanoGptService(async (url) =>
            url.endsWith('/usage') ? new Response('{}') : new Response(JSON.stringify({ data: [{ id: 'paid:route' }] }))
        );
        await service.load(folder);

        await expect(service.configure('nano-key')).rejects.toThrow('NanoGPT returned no models included in the subscription.');
        expect(service.status().configured).toBe(false);
    });

    test('disconnecting removes the key and the models', async () => {
        const folder = await home();
        const service = new NanoGptService(api().request);
        await service.load(folder);
        await service.configure('nano-key');

        expect(await service.configure('')).toMatchObject({ configured: false, models: 0 });
        expect(service.catalog.list()).toEqual([]);
        await expect(stat(join(folder, 'nanogpt', 'credential'))).rejects.toThrow();

        const again = new NanoGptService(api().request);
        await again.load(folder);
        expect(again.status()).toMatchObject({ configured: false, models: 0 });
    });

    test('a refresh keeps the saved key and needs one', async () => {
        const folder = await home();
        const { request, calls } = api();
        const service = new NanoGptService(request);
        await service.load(folder);
        await expect(service.configure()).rejects.toThrow('Enter a NanoGPT API key.');

        await service.configure('nano-key');
        await service.configure();
        expect(calls).toHaveLength(4);
        expect(new Headers(calls[2]!.init?.headers).get('authorization')).toBe('Bearer nano-key');
        expect(service.apiKey).toBe('nano-key');
    });

    test('a saved or removed key tells the provider list, a refused one does not', async () => {
        const folder = await home();
        const service = new NanoGptService(api().request);
        await service.load(folder);
        let changes = 0;
        service.onChange(() => {
            changes += 1;
        });

        await service.configure('nano-key');
        await service.configure('');
        expect(changes).toBe(2);

        const refused = new NanoGptService(api(401).request);
        await refused.load(folder);
        refused.onChange(() => {
            changes += 1;
        });
        await expect(refused.configure('wrong-key')).rejects.toThrow();
        expect(changes).toBe(2);
    });
});

describe('NanoGPT settings', () => {
    test('start as the defaults and come back after a restart', async () => {
        const folder = await home();
        const first = new NanoGptService(api().request);
        await first.load(folder);
        expect(first.status().settings).toEqual({ autoContinue: true, roundsPerRun: 40, runs: 5 });

        expect((await first.setSettings({ roundsPerRun: 25, runs: 3 })).settings).toEqual({ autoContinue: true, roundsPerRun: 25, runs: 3 });
        const again = new NanoGptService(api().request);
        await again.load(folder);
        expect(again.status().settings).toEqual({ autoContinue: true, roundsPerRun: 25, runs: 3 });
    });

    test('stay inside what the wire allows, and a refused change changes nothing', async () => {
        const folder = await home();
        const service = new NanoGptService(api().request);
        await service.load(folder);

        await expect(service.setSettings({ roundsPerRun: 4 })).rejects.toThrow();
        await expect(service.setSettings({ runs: 21 })).rejects.toThrow();
        await expect(service.setSettings({ roundsPerRun: 12.5 })).rejects.toThrow();
        expect(service.status().settings).toEqual({ autoContinue: true, roundsPerRun: 40, runs: 5 });
    });

    test('give a chat one run when it may not go on by itself', async () => {
        const folder = await home();
        const service = new NanoGptService(api().request);
        await service.load(folder);
        expect(service.runLimits()).toEqual({ roundsPerRun: 40, runs: 5 });
        await service.setSettings({ autoContinue: false, roundsPerRun: 10 });
        expect(service.runLimits()).toEqual({ roundsPerRun: 10, runs: 1 });
    });

    test('a file that cannot be read leaves the defaults', async () => {
        const folder = await home();
        const first = new NanoGptService(api().request);
        await first.load(folder);
        await first.setSettings({ runs: 2 });
        await Bun.write(join(folder, 'nanogpt', 'settings.json'), '{"autoContinue":"yes"}');

        const again = new NanoGptService(api().request);
        await again.load(folder);
        expect(again.status().settings).toEqual({ autoContinue: true, roundsPerRun: 40, runs: 5 });
    });

    test('the models carry who made them', async () => {
        const folder = await home();
        const service = new NanoGptService(async (url) =>
            url.endsWith('/usage')
                ? new Response('{}')
                : new Response(JSON.stringify({ data: [{ id: 'z-ai/glm-5.3', name: 'GLM 5.3' }, { id: 'deepseek-chat' }] }))
        );
        await service.load(folder);
        await service.configure('nano-key');
        expect(service.catalog.list().map((model) => [model.slug, model.vendor])).toEqual([
            ['z-ai/glm-5.3', 'Z.ai'],
            ['deepseek-chat', 'DeepSeek']
        ]);
    });
});

describe('NanoGPT usage', () => {
    const quota = {
        active: true,
        state: 'active',
        limits: { dailyInputTokens: 10_000_000, weeklyInputTokens: 60_000_000, dailyImages: null },
        dailyInputTokens: { used: 2_500_000, remaining: 7_500_000, percentUsed: 0.25, resetAt: 1_792_000_000_000, degraded: false },
        weeklyInputTokens: { used: 12_000_000, remaining: 48_000_000, percentUsed: 0.2, resetAt: 1_792_300_000_000, degraded: false },
        dailyImages: null
    };

    test('the plan is read with the saved key and drawn as a daily and a weekly window', async () => {
        const folder = await home();
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const service = new NanoGptService(async (url, init) => {
            calls.push({ url, init });
            if (url === `${NANOGPT_URL}/models?detailed=true`) {
                return new Response(JSON.stringify(MODELS));
            }
            return new Response(JSON.stringify(quota));
        });
        await service.load(folder);
        await service.configure('nano-key');
        calls.length = 0;

        const plan = await service.readPlan();
        expect(calls.map((call) => call.url)).toEqual([`${NANOGPT_URL}/usage`]);
        expect(new Headers(calls[0]!.init?.headers).get('authorization')).toBe('Bearer nano-key');
        expect(plan).toMatchObject({ plan: 'Subscription' });
        expect('windows' in plan ? plan.windows.map((window) => [window.id, window.used]) : []).toEqual([
            ['daily_input', 0.25],
            ['weekly_input', 0.2]
        ]);
    });

    test('without a key it says so and never asks NanoGPT', async () => {
        const folder = await home();
        const { request, calls } = api();
        const service = new NanoGptService(request);
        await service.load(folder);

        expect(await service.readPlan()).toEqual({ unavailable: { reason: 'no-subscription', message: 'Add a NanoGPT API key in Settings.' } });
        expect(calls).toHaveLength(0);
    });

    test('a refused read throws, so the monitor keeps the last numbers', async () => {
        const folder = await home();
        let status = 200;
        const service = new NanoGptService(async (url) =>
            url.endsWith('/models?detailed=true') ? new Response(JSON.stringify(MODELS)) : new Response('{}', { status })
        );
        await service.load(folder);
        await service.configure('nano-key');
        status = 429;
        await expect(service.readPlan()).rejects.toThrow('NanoGPT reached a limit');
    });

    test('a call that was logged shows on the usage page under NanoGPT, with its tokens and no price', async () => {
        setSystemTime(Date.UTC(2026, 9, 1, 12));
        const folder = await home();
        const service = new NanoGptService(api().request);
        await service.load(folder);
        await service.logUsage({ model: 'z-ai/glm-5.3', session: 's-1', cwd: '/work', prompt: 1000, cached: 200, completion: 300, reasoning: 100 });

        const usage = new UsageService({
            home: folder,
            allowPriceFetch: false,
            knownProjects: async () => [],
            roots: () => [{ provider: 'nanogpt', path: service.usageDirectory }]
        });
        const summary = await usage.summary({ from: '2026-10-01', to: '2026-10-01', resolution: 'day', timeZone: 'UTC' });
        usage.stop();

        expect(summary.roots).toEqual([expect.objectContaining({ provider: 'nanogpt', status: 'ok' })]);
        expect(summary.models).toEqual([expect.objectContaining({ provider: 'nanogpt', model: 'z-ai/glm-5.3', costUsd: null })]);
        expect(summary.models[0]!.totals).toMatchObject({ calls: 1, input: 800, cacheRead: 200, output: 300, reasoning: 100 });
        expect(summary.sessions).toBe(1);
    });

    test('every call is announced once it is logged, to whoever follows the quota', async () => {
        const folder = await home();
        const service = new NanoGptService(api().request);
        await service.load(folder);
        const heard: string[] = [];
        const stop = service.onCall(() => heard.push('call'));
        await service.logUsage({ model: 'tool-model', session: 's-1', cwd: '/work', prompt: 10, cached: 0, completion: 2, reasoning: 0 });
        stop();
        await service.logUsage({ model: 'tool-model', session: 's-1', cwd: '/work', prompt: 10, cached: 0, completion: 2, reasoning: 0 });
        expect(heard).toEqual(['call']);
    });

    test('a call is added to the log of its month, one line each', async () => {
        const folder = await home();
        const service = new NanoGptService(api().request);
        await service.load(folder);
        await service.logUsage({ model: 'tool-model', session: 's-1', cwd: '/work', prompt: 100, cached: 0, completion: 20, reasoning: 0 });
        await service.logUsage({ model: 'tool-model', session: 's-1', cwd: '/work', prompt: 150, cached: 100, completion: 30, reasoning: 4 });

        const [file] = await readdir(service.usageDirectory);
        const lines = (await readFile(join(service.usageDirectory, file!), 'utf8')).trim().split('\n');
        // The cached part of a prompt is not input as well: the second call read 100 of its 150 from the cache.
        expect(lines.map((line) => JSON.parse(line))).toEqual([
            expect.objectContaining({ model: 'tool-model', session: 's-1', cwd: '/work', input: 100, cacheRead: 0, cacheWrite: 0, output: 20, reasoning: 0 }),
            expect.objectContaining({ input: 50, cacheRead: 100, cacheWrite: 0, output: 30, reasoning: 4 })
        ]);
        expect(typeof JSON.parse(lines[0]!).at).toBe('number');
    });
});

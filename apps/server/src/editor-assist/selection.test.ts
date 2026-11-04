import { describe, expect, test } from 'bun:test';
import prices from '@adecore/agents/usage/prices-snapshot.json' with { type: 'json' };
import { cheapestEditorModel } from '@ruimte/contracts';
import { ProviderRegistry } from '../providers/registry.ts';
import { selectAssistAgent, type AssistProviders } from './selection.ts';

function providers(...installed: string[]): AssistProviders {
    const registry = new ProviderRegistry({ detect: async (command) => ({ installed: installed.includes(command), version: null }) });

    return {
        registry,
        accounts: {
            snapshot: () => ({
                accounts: Object.fromEntries(['claude', 'codex', 'grok', 'antigravity'].map((kind) => [kind, { kind }])),
                statuses: [],
                secretsAvailable: false,
                loginCommands: {}
            }),
            envFor: (_kind, _account, env) => env
        }
    };
}

describe('the default editor model', () => {
    test.each([
        [['claude', 'codex', 'grok', 'agy'], 'claude', 'claude-haiku-5-5'],
        [['codex', 'grok', 'agy'], 'codex', 'gpt-6-luna'],
        [['grok', 'agy'], 'grok', 'grok-4.7-build-fast'],
        [['agy'], 'antigravity', 'gemini-3.8-flash']
    ] as const)('uses the cheapest model of the first installed provider in %j', async (installed, kind, model) => {
        const result = await selectAssistAgent(providers(...installed));
        expect(result.provider.kind).toBe(kind);
        expect(result.model).toBe(model);
    });

    test('honors an explicit model and never silently substitutes another provider', async () => {
        const deps = providers('claude', 'codex');
        const result = await selectAssistAgent(deps, { provider: 'codex', model: 'gpt-6.1-sol' });
        expect(result.provider.kind).toBe('codex');
        expect(result.model).toBe('gpt-6.1-sol');
        await expect(selectAssistAgent(providers('claude'), { provider: 'codex', model: 'gpt-6-luna' })).rejects.toMatchObject({ code: 'unavailable' });
        await expect(selectAssistAgent(deps, { provider: 'claude', model: 'missing-model' })).rejects.toMatchObject({ code: 'unavailable' });
    });

    test('skips disabled and signed-out accounts and uses an enabled additional account', async () => {
        const deps = providers('claude', 'codex', 'grok');
        deps.accounts.snapshot = () => ({
            accounts: { claude: { kind: 'claude', enabled: false }, codex: { kind: 'codex' }, work: { kind: 'grok' } },
            statuses: [{ id: 'codex', kind: 'codex', state: 'signed-out', email: null, plan: null, organization: null, home: '', message: null, checkedAt: 0 }],
            secretsAvailable: false,
            loginCommands: {}
        });
        const result = await selectAssistAgent(deps);
        expect(result.provider.kind).toBe('grok');
        expect(result.account).toBe('work');
        await expect(selectAssistAgent(deps, { provider: 'grok', model: null })).rejects.toMatchObject({ code: 'unavailable' });
        await expect(selectAssistAgent(deps, { provider: 'grok', model: null, account: 'missing' })).rejects.toMatchObject({ code: 'unavailable' });
    });

    test('does not turn an unpriced or legacy model into a cheaper choice', () => {
        const models = new ProviderRegistry().get('claude').catalog.list();
        expect(cheapestEditorModel([{ ...models[0]!, slug: 'unknown-price' }, ...models], prices)).toBe('claude-haiku-5-5');
        expect(cheapestEditorModel([], prices)).toBeNull();
    });
});

import { describe, expect, test } from 'bun:test';
import { ProviderRegistry } from './registry.ts';

describe('ProviderRegistry', () => {
    test('lists CLIs and the disabled local model with their capabilities', async () => {
        const registry = new ProviderRegistry({ detect: async () => ({ installed: true, version: '1.2.3' }) });
        const providers = await registry.list();
        expect(providers.map((provider) => provider.kind)).toEqual(['claude', 'codex', 'gemini', 'copilot', 'apple']);
        expect(providers.map((provider) => provider.name)).toEqual(['Claude Code', 'Codex', 'Gemini', 'GitHub Copilot', 'Apple Foundation Models']);
        expect(providers.map((provider) => provider.capabilities.chat)).toEqual([true, true, false, false, true]);
        expect(providers.map((provider) => provider.capabilities.terminal)).toEqual([true, true, true, true, false]);
        expect(providers.map((provider) => provider.capabilities.hooks)).toEqual([true, true, false, false, false]);
    });

    test('a terminal-only CLI reports no models and detection still answers for it', async () => {
        const registry = new ProviderRegistry({ detect: async (command) => ({ installed: command === 'gemini', version: null }) });
        const providers = await registry.list();
        const gemini = providers.find((provider) => provider.kind === 'gemini');
        expect(gemini).toMatchObject({ installed: true, models: [], defaultModel: null, resumeCommand: 'gemini {flags} --resume {id}' });
        expect(providers.find((provider) => provider.kind === 'copilot')?.installed).toBe(false);
    });
});

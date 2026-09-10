import { describe, expect, test } from 'bun:test';
import { codexPromptPrefix, codexThreadOptions } from './codex.ts';
import { ProviderRegistry } from './registry.ts';

describe('codex catalog', () => {
    test('lists the app-server models with a reasoning option and one default', () => {
        const registry = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.153.4' }) });
        const codex = registry.catalogFor('codex');
        const models = codex.list();
        expect(models.filter((model) => model.isDefault).map((model) => model.slug)).toEqual(['gpt-6-astra']);
        expect(models.find((model) => model.slug === 'gpt-5.6-sol')?.options[0]).toMatchObject({ id: 'effort', type: 'select', defaultChoice: 'low' });
        expect(codex.normalize({ model: 'astra', options: { effort: 'ultra', contextWindow: '1m' } })).toEqual({
            model: 'gpt-6-astra',
            options: { effort: 'ultra' }
        });
        expect(codex.normalize({ model: 'gpt-5.5', options: { effort: 'ultra' } }).options.effort).toBe('medium');
        expect(codex.contextWindowFor(codex.normalize({ model: 'spark' }))).toBe(121600);
        expect(registry.catalogFor('claude')).not.toBe(codex);
    });
});

describe('codexThreadOptions', () => {
    test('maps the runtime modes to an approval policy and a sandbox', () => {
        expect(codexThreadOptions('supervised', 'default')).toEqual({ approvalPolicy: 'untrusted', sandbox: 'read-only' });
        expect(codexThreadOptions('auto-accept-edits', 'default')).toEqual({ approvalPolicy: 'untrusted', sandbox: 'workspace-write' });
        expect(codexThreadOptions('auto', 'default')).toEqual({ approvalPolicy: 'on-request', sandbox: 'workspace-write' });
        expect(codexThreadOptions('full-access', 'default')).toEqual({ approvalPolicy: 'never', sandbox: 'danger-full-access' });
    });

    test('plan mode makes the sandbox read-only and asks for a plan in the prompt', () => {
        expect(codexThreadOptions('full-access', 'plan')).toEqual({ approvalPolicy: 'never', sandbox: 'read-only' });
        expect(codexPromptPrefix('plan').startsWith('Plan mode:')).toBe(true);
        expect(codexPromptPrefix('default')).toBe('');
    });
});

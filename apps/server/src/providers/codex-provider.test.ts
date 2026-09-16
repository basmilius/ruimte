import { describe, expect, test } from 'bun:test';
import { CODEX_CAPABILITIES, codexServiceTier, codexThreadOptions } from './codex.ts';
import { ProviderRegistry } from './registry.ts';

describe('codex catalog', () => {
    test('allows the composer to accept attachments', () => {
        expect(CODEX_CAPABILITIES.attachments).toBe(true);
    });
    test('lists the app-server models with a reasoning option and one default', () => {
        const registry = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.153.4' }) });
        const codex = registry.catalogFor('codex');
        const models = codex.list();
        expect(models.filter((model) => model.isDefault).map((model) => model.slug)).toEqual(['gpt-6-astra']);
        expect(models.find((model) => model.slug === 'gpt-5.6-sol')?.options[0]).toMatchObject({ id: 'effort', type: 'select', defaultChoice: 'low' });
        expect(codex.normalize({ model: 'astra', options: { effort: 'ultra', contextWindow: '1m' } })).toEqual({
            model: 'gpt-6-astra',
            options: { effort: 'ultra', serviceTier: false }
        });
        expect(codex.normalize({ model: 'gpt-5.5', options: { effort: 'ultra' } }).options.effort).toBe('medium');
        expect(codex.contextWindowFor(codex.normalize({ model: 'spark' }))).toBe(121600);
        expect(registry.catalogFor('claude')).not.toBe(codex);
    });
});

describe('codexServiceTier', () => {
    test('is the priority tier when the option is on, and nothing when it is off', () => {
        expect(codexServiceTier({ model: 'gpt-6-astra', options: { serviceTier: true } })).toBe('priority');
        expect(codexServiceTier({ model: 'gpt-6-astra', options: { serviceTier: false } })).toBeNull();
        expect(codexServiceTier({ model: 'gpt-5.3-codex-spark', options: {} })).toBeNull();
    });

    test('the models the app-server gives a tier carry the option; spark does not', () => {
        const codex = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.153.4' }) }).catalogFor('codex');
        const options = (slug: string) => codex.list().find((model) => model.slug === slug)?.options ?? [];
        expect(options('gpt-6-astra').find((option) => option.id === 'serviceTier')).toMatchObject({ type: 'boolean', defaultValue: false });
        expect(options('gpt-5.3-codex-spark').some((option) => option.id === 'serviceTier')).toBe(false);
    });
});

describe('codexThreadOptions', () => {
    test('maps the runtime modes to an approval policy and a sandbox', () => {
        expect(codexThreadOptions('supervised')).toEqual({ approvalPolicy: 'untrusted', sandbox: 'read-only' });
        expect(codexThreadOptions('auto-accept-edits')).toEqual({ approvalPolicy: 'untrusted', sandbox: 'workspace-write' });
        expect(codexThreadOptions('auto')).toEqual({ approvalPolicy: 'on-request', sandbox: 'workspace-write' });
        expect(codexThreadOptions('full-access')).toEqual({ approvalPolicy: 'never', sandbox: 'danger-full-access' });
    });
});

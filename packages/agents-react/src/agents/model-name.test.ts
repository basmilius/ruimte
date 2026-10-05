import { describe, expect, test } from 'bun:test';
import type { ModelInfo, ProviderInfo } from '@ruimte/agent-contracts';
import { agentChipOf, modelName, modelNameFromSlug, sharedModelPrefix, shortModelName } from './model-name.ts';

function model(slug: string, name: string): ModelInfo {
    return { slug, name, legacy: false, isDefault: false, options: [] };
}

describe('a model with no catalog behind it', () => {
    test('drops the vendor and the date and puts the version back together', () => {
        expect(modelNameFromSlug('claude-opus-4-5')).toBe('Claude Opus 4.5');
        expect(modelNameFromSlug('anthropic/claude-fable-5-1')).toBe('Claude Fable 5.1');
        expect(modelNameFromSlug('claude-haiku-4-5-20251001')).toBe('Claude Haiku 4.5');
        expect(modelNameFromSlug('gpt-5.6-sol')).toBe('GPT 5.6 Sol');
        expect(modelNameFromSlug('claude-opus-5')).toBe('Claude Opus 5');
    });
});

describe('a model the CLI offers', () => {
    const models = [model('gpt-5.6-sol', 'GPT-5.6 Sol'), model('claude-opus-5', 'Claude Opus 5')];

    test('is named the way its own catalog writes it', () => {
        expect(modelName('gpt-5.6-sol', models)).toBe('GPT-5.6 Sol');
    });

    test('falls back to the slug when the catalog has dropped it or has not arrived', () => {
        expect(modelName('gpt-5.5', models)).toBe('GPT 5.5');
        expect(modelName('claude-opus-5', undefined)).toBe('Claude Opus 5');
    });
});

function catalog(...names: string[]): ModelInfo[] {
    return names.map((name) => model(name.toLowerCase(), name));
}

describe('shortModelName', () => {
    test('drops the words every model shares', () => {
        const models = catalog('Claude Opus 5.5', 'Claude Sonnet 5', 'Claude Haiku 4.5');
        expect(sharedModelPrefix(models)).toBe('Claude ');
        expect(shortModelName('Claude Opus 5.5', models)).toBe('Opus 5.5');
    });

    test('keeps a prefix that is only part of a word', () => {
        const models = catalog('GPT-6 Astra', 'GPT-6 Sol', 'GPT-5.5');
        expect(sharedModelPrefix(models)).toBe('');
        expect(shortModelName('GPT-6 Sol', models)).toBe('GPT-6 Sol');
    });

    test('never takes a whole name', () => {
        const models = catalog('Claude Opus', 'Claude Opus 5');
        expect(shortModelName('Claude Opus', models)).toBe('Opus');
        expect(shortModelName('Claude Opus 5', models)).toBe('Opus 5');
    });

    test('leaves a catalog of one alone', () => {
        expect(shortModelName('Claude Opus 5.5', catalog('Claude Opus 5.5'))).toBe('Claude Opus 5.5');
    });
});

describe('the chip of an agent picker', () => {
    const providers = [
        { kind: 'claude', name: 'Claude Code', models: [model('opus', 'Opus 4.1')] },
        { kind: 'codex', name: 'Codex', models: [model('gpt-5-codex', 'GPT-5 Codex')] },
        { kind: 'gemini', name: 'Gemini CLI', models: [] }
    ] as unknown as ProviderInfo[];

    test('names the provider beside the model, with the logo for the CLIs that have one', () => {
        expect(agentChipOf(providers, 'claude', 'opus')).toEqual({ mark: 'logo', name: 'Claude Code', model: 'Opus 4.1' });
        expect(agentChipOf(providers, 'codex', 'gpt-5-codex')).toEqual({ mark: 'logo', name: 'Codex', model: 'GPT-5 Codex' });
    });

    test('draws the generic icon for another CLI and reads a model its catalog dropped from the slug', () => {
        expect(agentChipOf(providers, 'gemini', 'gemini-2-5-pro')).toEqual({ mark: 'icon', name: 'Gemini CLI', model: 'Gemini 2.5 Pro' });
    });

    test('goes by the CLI id while the machine has not listed it', () => {
        expect(agentChipOf([], 'claude', 'opus')).toEqual({ mark: 'logo', name: 'claude', model: 'Opus' });
    });
});

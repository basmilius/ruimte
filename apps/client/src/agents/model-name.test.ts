import { describe, expect, test } from 'bun:test';
import type { ModelInfo } from '@ruimte/contracts';
import { modelName, modelNameFromSlug } from './model-name.ts';

const model = (slug: string, name: string): ModelInfo => ({ slug, name, legacy: false, isDefault: false, options: [] });

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

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BENCHMARK_MODELS, type BenchmarkProvider } from './benchmark-models.ts';

interface ManifestOption {
    id: string;
    type: 'select' | 'boolean';
    choices?: { id: string }[];
}

interface Manifest {
    profiles: Record<string, { options: ManifestOption[] }>;
    models: { slug: string; name: string; profile: string; legacy?: boolean }[];
}

const PROVIDERS = join(import.meta.dir, '../../../packages/agents/src/providers');

// Asked for in the prompt itself, so Artificial Analysis has nothing that measures them.
const PROMPT_ONLY = ['ultrathink', 'ultra'];

const effortsOf = (options: ManifestOption[]): string[] => {
    const effort = options.find((option) => option.id === 'effort');
    if (effort) {
        return (effort.choices ?? []).map((choice) => choice.id).filter((id) => !PROMPT_ONLY.includes(id));
    }
    const thinking = options.find((option) => option.id === 'thinking' && option.type === 'boolean');
    return thinking ? ['off', thinking.id] : [];
};

const manifestModels = (provider: BenchmarkProvider) => {
    const manifest = JSON.parse(readFileSync(join(PROVIDERS, `${provider}-models.json`), 'utf8')) as Manifest;
    return manifest.models.map((model) => ({
        slug: model.slug,
        name: model.name,
        provider,
        legacy: model.legacy === true,
        efforts: effortsOf(manifest.profiles[model.profile]?.options ?? [])
    }));
};

describe('the benchmark table', () => {
    test('knows every model the app offers, with its efforts, and nothing else', () => {
        const table = BENCHMARK_MODELS.map((model) => ({ ...model, efforts: model.efforts.map((entry) => entry.effort) }));
        expect(table).toEqual([...manifestModels('claude'), ...manifestModels('codex')]);
    });

    test('looks every measured effort up by an id of its own', () => {
        const ids = BENCHMARK_MODELS.flatMap((model) => model.efforts.flatMap((entry) => (entry.id === null ? [] : [entry.id])));
        expect(new Set(ids).size).toBe(ids.length);
    });
});

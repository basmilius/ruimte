/*
 * Refreshes `src/usage/prices-snapshot.json`, the price table the app falls back to when it has
 * never reached LiteLLM. Only the Anthropic and OpenAI chat and responses entries are kept, and
 * only the five fields the pricing code reads, which is what holds the file to a few dozen KB.
 * Run it by hand now and then: `bun run --cwd apps/server snapshot-prices`.
 */
import { join } from 'node:path';
import { LITELLM_URL } from '../src/usage/pricing.ts';

const PROVIDERS = new Set(['anthropic', 'openai']);
const MODES = new Set(['chat', 'responses']);
const FIELDS = ['input_cost_per_token', 'output_cost_per_token', 'cache_read_input_token_cost', 'cache_creation_input_token_cost'] as const;

const response = await fetch(LITELLM_URL);
if (!response.ok) {
    throw new Error(`LiteLLM answered ${response.status}`);
}
const document = (await response.json()) as Record<string, Record<string, unknown>>;

const kept: Record<string, Record<string, unknown>> = {};
for (const [name, entry] of Object.entries(document)) {
    if (typeof entry !== 'object' || entry === null) {
        continue;
    }
    if (typeof entry.litellm_provider !== 'string' || !PROVIDERS.has(entry.litellm_provider)) {
        continue;
    }
    if (typeof entry.mode !== 'string' || !MODES.has(entry.mode)) {
        continue;
    }
    if (typeof entry.input_cost_per_token !== 'number' || typeof entry.output_cost_per_token !== 'number') {
        continue;
    }
    const trimmed: Record<string, unknown> = { litellm_provider: entry.litellm_provider, mode: entry.mode };
    for (const field of FIELDS) {
        if (typeof entry[field] === 'number') {
            trimmed[field] = entry[field];
        }
    }
    kept[name] = trimmed;
}

const target = join(import.meta.dir, '..', 'src', 'usage', 'prices-snapshot.json');
await Bun.write(target, `${JSON.stringify(kept, null, 2)}\n`);
console.log(`Wrote ${Object.keys(kept).length} models to ${target}`);

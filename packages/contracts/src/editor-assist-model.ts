import type { ModelInfo } from '@adecore/agent-contracts/model';

export interface EditorModelPrice {
    input_cost_per_token?: number;
    output_cost_per_token?: number;
}

/* The catalog has no prices for Grok or Gemini; their economy variants are the fallback there. */
const ECONOMY_MODELS = /(?:^|[-.])(?:haiku|luna|mini|flash)(?:[-.]|$)|build-fast/i;

function priceOf(model: ModelInfo, table: Readonly<Record<string, EditorModelPrice>>): number {
    const price = table[model.slug];

    if (price?.input_cost_per_token !== undefined && price.output_cost_per_token !== undefined) {
        return price.input_cost_per_token + price.output_cost_per_token;
    }

    return Number.POSITIVE_INFINITY;
}

export function cheapestEditorModel(models: readonly ModelInfo[], prices: Readonly<Record<string, EditorModelPrice>>): string | null {
    const current = models.filter((model) => !model.legacy && model.slug !== 'default');
    const offered = current.length > 0 ? current : models.filter((model) => model.slug !== 'default');
    const priced = offered.filter((model) => Number.isFinite(priceOf(model, prices)));

    if (priced.length > 0) {
        return [...priced].sort((first, second) => priceOf(first, prices) - priceOf(second, prices))[0]!.slug;
    }

    return offered.find((model) => ECONOMY_MODELS.test(model.slug))?.slug ?? offered[0]?.slug ?? null;
}

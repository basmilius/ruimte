import claude from '@ruimte/agents/providers/claude-models.json' with { type: 'json' };
import codex from '@ruimte/agents/providers/codex-models.json' with { type: 'json' };
import type { ModelCatalogsResult } from '@ruimte/pulsar';
import { json } from './http.ts';

/*
 * The very manifests the app ships with, so a new model is an edit there and a deploy of this Worker.
 * A machine checks every catalog against the schema itself and keeps the one it had when it refuses.
 */
export const MODEL_CATALOGS = { catalogs: { claude, codex } } as unknown as ModelCatalogsResult;

// Short enough that a fix to a catalog reaches every machine within the hour it asks.
const CACHE_CONTROL = 'public, max-age=300';

export function readCatalogs(): Response {
    return json(MODEL_CATALOGS, 200, { 'cache-control': CACHE_CONTROL });
}

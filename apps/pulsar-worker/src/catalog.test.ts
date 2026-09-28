import { describe, expect, test } from 'bun:test';
import { ModelCatalogsResultSchema } from '@ruimte/pulsar';
import { MODEL_CATALOGS, readCatalogs } from './catalog.ts';

describe('the model catalogs', () => {
    test('hand out every manifest in the shape a machine accepts', () => {
        expect(Object.keys(MODEL_CATALOGS.catalogs)).toEqual(['claude', 'codex']);
        expect(ModelCatalogsResultSchema.safeParse(MODEL_CATALOGS).success).toBe(true);
    });

    test('may be cached for a few minutes', async () => {
        const response = readCatalogs();
        expect(response.headers.get('cache-control')).toBe('public, max-age=300');
        expect(ModelCatalogsResultSchema.parse(await response.json())).toEqual(ModelCatalogsResultSchema.parse(MODEL_CATALOGS));
    });
});

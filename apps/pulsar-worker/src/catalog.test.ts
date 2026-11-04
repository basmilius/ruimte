import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { ModelCatalogsResultSchema } from '@ruimte/pulsar';
import { ROUTE_SCHEMAS, routesOf } from './catalog-schemas.ts';
import { seedRefusalOf, seedStatementsOf } from './catalog-seed.ts';
import { BUNDLED_CATALOGS, catalogsFor, readCatalogs } from './catalog.ts';
import { d1, migratedDatabase } from './test/sqlite-d1.ts';

const CATALOG = {
    updatedAt: '2026-10-27T12:00:00Z',
    defaultModel: 'model-a',
    profiles: {
        plain: { options: [], contextWindowTokens: {} },
        wide: { options: [{ id: 'fast', label: 'Fast', type: 'boolean', defaultValue: false }], contextWindowTokens: { '*': 256000 } }
    },
    models: [
        { slug: 'model-a', name: "Bas's Model", profile: 'plain' },
        { slug: 'model-b', name: 'Model B', profile: 'wide', badge: 'New', aliases: ['b'], legacy: true, minCliVersion: '1.2', tools: false }
    ]
};

let database: Database;
let db: D1Database;

function seed(kind: string, catalog: unknown = CATALOG): void {
    database.transaction(() => {
        for (const statement of seedStatementsOf(kind, catalog as never)) {
            database.exec(statement);
        }
    })();
}

function updatedAtOf(kind: string): string {
    return (database.query('SELECT updated_at FROM model_catalogs WHERE kind = ?').get(kind) as { updated_at: string }).updated_at;
}

function backdate(kind: string): void {
    database.query("UPDATE model_catalogs SET updated_at = '2000-01-01T00:00:00.000Z' WHERE kind = ?").run(kind);
}

beforeEach(() => {
    database = migratedDatabase();
    db = d1(database);
});

describe('the model catalogs', () => {
    test('an empty table answers the bundled manifests in the shape a machine of today accepts', async () => {
        const catalogs = await catalogsFor(db, 'v1');

        expect(Object.keys(catalogs)).toEqual(['claude', 'codex']);
        expect(ModelCatalogsResultSchema.safeParse({ catalogs }).success).toBe(true);
        expect(Object.keys(await catalogsFor(db, 'v2'))).toEqual(['claude', 'codex', 'grok', 'copilot', 'antigravity']);
    });

    test('a seeded kind reads back as the catalog it came from, dated when it landed', async () => {
        seed('grok');
        const { updatedAt, ...rest } = (await catalogsFor(db, 'v2')).grok as typeof CATALOG;
        const { updatedAt: _source, ...expected } = CATALOG;

        expect(rest).toEqual(expected);
        expect(Date.parse(updatedAt)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00Z'));
    });

    test('D1 wins over the bundled manifest, also when the manifest is newer', async () => {
        seed('claude');
        backdate('claude');

        expect(((await catalogsFor(db, 'v1')).claude as typeof CATALOG).defaultModel).toBe('model-a');
    });

    test('v1 never answers an ACP kind', async () => {
        seed('grok');

        expect('grok' in (await catalogsFor(db, 'v1'))).toBe(false);
    });

    test('an edit by hand dates the catalog again, so a machine takes it', () => {
        seed('grok');

        for (const edit of [
            "UPDATE model_catalog_models SET legacy = 1 WHERE kind = 'grok' AND slug = 'model-a'",
            "DELETE FROM model_catalog_models WHERE kind = 'grok' AND slug = 'model-b'",
            "UPDATE model_catalog_profiles SET options = '[]' WHERE kind = 'grok' AND name = 'wide'",
            "UPDATE model_catalogs SET default_model = 'model-a' WHERE kind = 'grok'"
        ]) {
            backdate('grok');
            database.exec(edit);

            expect(updatedAtOf('grok')).not.toBe('2000-01-01T00:00:00.000Z');
        }
    });

    test('a model deleted in D1 leaves the catalog', async () => {
        seed('grok');
        database.exec("DELETE FROM model_catalog_models WHERE kind = 'grok' AND slug = 'model-b'");

        expect(((await catalogsFor(db, 'v2')).grok as typeof CATALOG).models.map((model) => model.slug)).toEqual(['model-a']);
    });

    test('a kind edited into a catalog the route cannot read answers the bundled manifest', async () => {
        seed('claude');
        seed('codex');
        database.exec("UPDATE model_catalogs SET default_model = 'gone' WHERE kind = 'claude'");
        database.exec("UPDATE model_catalog_profiles SET options = 'not json' WHERE kind = 'codex' AND name = 'plain'");
        const catalogs = await catalogsFor(db, 'v1');

        expect(catalogs.claude).toEqual(BUNDLED_CATALOGS.claude);
        expect(catalogs.codex).toEqual(BUNDLED_CATALOGS.codex);
    });

    test('a database that does not answer leaves the bundled manifests', async () => {
        const broken = { prepare: () => ({}), batch: () => Promise.reject(new Error('down')) } as unknown as D1Database;

        expect(await catalogsFor(broken, 'v2')).toEqual(BUNDLED_CATALOGS);
    });

    test('every bundled manifest passes the frozen schema of each route that serves it', () => {
        for (const [kind, catalog] of Object.entries(BUNDLED_CATALOGS)) {
            for (const route of routesOf(kind)) {
                expect(ROUTE_SCHEMAS[route].safeParse(catalog).success).toBe(true);
            }
        }
    });

    test('may be cached for a few minutes', async () => {
        const response = await readCatalogs(db, 'v2');

        expect(response.headers.get('cache-control')).toBe('public, max-age=300');
        expect(await response.json()).toEqual({ catalogs: await catalogsFor(db, 'v2') });
    });
});

describe('seeding a kind', () => {
    test('refuses a kind D1 already manages unless forced', () => {
        expect(seedRefusalOf('grok', CATALOG, true, false)).toContain('--force');
        expect(seedRefusalOf('grok', CATALOG, true, true)).toBeNull();
    });

    test('refuses an invalid catalog and a kind no route serves', () => {
        expect(seedRefusalOf('claude', { ...CATALOG, defaultModel: 'missing' }, false, false)).toContain('v1 route');
        expect(seedRefusalOf('opencode', CATALOG, false, false)).toContain('No route');
    });

    test('a field the daemons on v1 cannot read keeps a Claude catalog out, and an ACP catalog may carry it', () => {
        const option = { id: 'speed', label: 'Speed', type: 'range', min: 1, max: 3 };
        const withNewOption = { ...CATALOG, profiles: { ...CATALOG.profiles, plain: { options: [option], contextWindowTokens: {} } } };

        expect(seedRefusalOf('claude', withNewOption, false, false)).toContain('v1 route');
        expect(seedRefusalOf('grok', CATALOG, false, false)).toBeNull();
    });
});

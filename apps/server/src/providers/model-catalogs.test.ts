import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ModelCatalog } from '@adecore/agents/providers';
import type { ModelCatalogData } from '@ruimte/contracts';
import type { ModelCatalogsV2Result } from '@ruimte/pulsar';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { ModelCatalogFeed } from './model-catalogs.ts';

const MINUTE = 60 * 1000;

function catalogOf(updatedAt: string, slugs: string[]): ModelCatalogData {
    return {
        updatedAt,
        defaultModel: slugs[0]!,
        profiles: { plain: { options: [], contextWindowTokens: { '*': 200000 } } },
        models: slugs.map((slug) => ({ slug, name: slug, profile: 'plain' }))
    };
}

const SHIPPED = catalogOf('2026-09-01T00:00:00Z', ['model-a']);
const NEWER = catalogOf('2026-09-28T00:00:00Z', ['model-a', 'model-b']);

const newHome = tempHomes('ruimte-catalogs-');
let home: string;
let clock: number;
let asked: number;
let answer: () => Promise<ModelCatalogsV2Result>;

function slugsOf(catalog: ModelCatalog): string[] {
    return catalog.list().map((model) => model.slug);
}

function feedOf(catalogs: { claude: ModelCatalog; codex?: ModelCatalog; grok?: ModelCatalog }, allowFetch = true): ModelCatalogFeed {
    return new ModelCatalogFeed({
        home,
        allowFetch,
        catalogs,
        now: () => clock,
        fetchCatalogs: () => {
            asked += 1;
            return answer();
        }
    });
}

beforeEach(async () => {
    home = await newHome();
    clock = Date.parse('2026-09-28T12:00:00Z');
    asked = 0;
    answer = async () => ({ catalogs: { claude: NEWER } });
});

describe('ModelCatalogFeed', () => {
    test('takes a newer catalog from the address book and keeps it on disk', async () => {
        const claude = new ModelCatalog(SHIPPED);
        await feedOf({ claude }).refresh();
        expect(slugsOf(claude)).toEqual(['model-a', 'model-b']);
        const stored = JSON.parse(await readFile(join(home, 'models', 'catalogs-v2.json'), 'utf8'));
        expect(stored).toEqual({ fetchedAt: clock, catalogs: { claude: NEWER } });

        const restarted = new ModelCatalog(SHIPPED);
        answer = () => Promise.reject(new Error('offline'));
        await feedOf({ claude: restarted }).load();
        expect(slugsOf(restarted)).toEqual(['model-a', 'model-b']);
    });

    test('says when a catalog took a newer copy, and only then', async () => {
        const claude = new ModelCatalog(SHIPPED);
        let told = 0;
        const feed = new ModelCatalogFeed({
            home,
            allowFetch: true,
            catalogs: { claude },
            now: () => clock,
            fetchCatalogs: () => answer(),
            changed: () => (told += 1)
        });
        await feed.refresh();
        clock += 16 * 60_000;
        await feed.refresh();
        expect(told).toBe(1);
    });

    test('asks again only once the answer is fifteen minutes old', async () => {
        const feed = feedOf({ claude: new ModelCatalog(SHIPPED) });
        await feed.refresh();
        clock += 14 * MINUTE;
        await feed.refresh();
        expect(asked).toBe(1);
        clock += 2 * MINUTE;
        await feed.refresh();
        expect(asked).toBe(2);
    });

    test('an ACP catalog keeps the models the agent reported and names them the way the catalog does', async () => {
        const grok = new ModelCatalog(SHIPPED);
        grok.adopt(
            [
                { slug: 'model-b', name: 'model-b' },
                { slug: 'reported', name: 'Reported' }
            ],
            'reported'
        );
        answer = async () => ({ catalogs: { grok: { ...NEWER, models: NEWER.models.map((model) => ({ ...model, name: model.slug.toUpperCase() })) } } });
        await feedOf({ claude: new ModelCatalog(SHIPPED), grok }).refresh();
        expect(grok.list().map((model) => [model.slug, model.name])).toEqual([
            ['model-b', 'MODEL-B'],
            ['reported', 'Reported']
        ]);
    });

    test('keeps the answer apart from the v1 file, and reads that file until the first answer', async () => {
        await mkdir(join(home, 'models'), { recursive: true });
        await writeFile(join(home, 'models', 'catalogs.json'), JSON.stringify({ fetchedAt: clock, catalogs: { claude: NEWER } }));
        const claude = new ModelCatalog(SHIPPED);
        await feedOf({ claude }).load();
        expect(slugsOf(claude)).toEqual(['model-a', 'model-b']);

        clock += 20 * MINUTE;
        await feedOf({ claude }).refresh();
        expect(JSON.parse(await readFile(join(home, 'models', 'catalogs.json'), 'utf8'))).toEqual({
            fetchedAt: clock - 20 * MINUTE,
            catalogs: { claude: NEWER }
        });
        expect(JSON.parse(await readFile(join(home, 'models', 'catalogs-v2.json'), 'utf8')).fetchedAt).toBe(clock);
    });

    test('a failed fetch keeps what it had and waits ten minutes before knocking again', async () => {
        const claude = new ModelCatalog(SHIPPED);
        const feed = feedOf({ claude });
        answer = () => Promise.reject(new Error('down'));
        await feed.refresh();
        await feed.refresh();
        expect(asked).toBe(1);
        expect(slugsOf(claude)).toEqual(['model-a']);
        clock += 11 * 60 * 1000;
        answer = async () => ({ catalogs: { claude: NEWER } });
        await feed.refresh();
        expect(asked).toBe(2);
        expect(slugsOf(claude)).toEqual(['model-a', 'model-b']);
    });

    test('never asks with the fetch turned off', async () => {
        const claude = new ModelCatalog(SHIPPED);
        await feedOf({ claude }, false).refresh();
        expect(asked).toBe(0);
        expect(slugsOf(claude)).toEqual(['model-a']);
    });

    test('a stored catalog this version cannot read leaves the others standing', async () => {
        await mkdir(join(home, 'models'), { recursive: true });
        await writeFile(
            join(home, 'models', 'catalogs.json'),
            JSON.stringify({ fetchedAt: clock, catalogs: { claude: { ...NEWER, models: 'not a list' }, codex: NEWER } })
        );
        const claude = new ModelCatalog(SHIPPED);
        const codex = new ModelCatalog(SHIPPED);
        await feedOf({ claude, codex }).load();
        expect(slugsOf(claude)).toEqual(['model-a']);
        expect(slugsOf(codex)).toEqual(['model-a', 'model-b']);
    });
});

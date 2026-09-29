import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelCatalogData } from '@ruimte/contracts';
import { ModelCatalog } from '@ruimte/agents/providers/catalog';
import type { ModelCatalogsResult } from '@ruimte/pulsar';
import { ModelCatalogFeed } from './model-catalogs.ts';

const HOUR = 60 * 60 * 1000;

const catalogOf = (updatedAt: string, slugs: string[]): ModelCatalogData => ({
    updatedAt,
    defaultModel: slugs[0]!,
    profiles: { plain: { options: [], contextWindowTokens: { '*': 200000 } } },
    models: slugs.map((slug) => ({ slug, name: slug, profile: 'plain' }))
});

const SHIPPED = catalogOf('2026-09-01T00:00:00Z', ['model-a']);
const NEWER = catalogOf('2026-09-28T00:00:00Z', ['model-a', 'model-b']);

let home: string;
let clock: number;
let asked: number;
let answer: () => Promise<ModelCatalogsResult>;

const slugsOf = (catalog: ModelCatalog): string[] => catalog.list().map((model) => model.slug);

const feedOf = (catalogs: { claude: ModelCatalog; codex?: ModelCatalog }, allowFetch = true): ModelCatalogFeed =>
    new ModelCatalogFeed({
        home,
        allowFetch,
        catalogs,
        now: () => clock,
        fetchCatalogs: () => {
            asked += 1;
            return answer();
        }
    });

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-catalogs-'));
    clock = Date.parse('2026-09-28T12:00:00Z');
    asked = 0;
    answer = async () => ({ catalogs: { claude: NEWER } });
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('ModelCatalogFeed', () => {
    test('takes a newer catalog from the address book and keeps it on disk', async () => {
        const claude = new ModelCatalog(SHIPPED);
        await feedOf({ claude }).refresh();
        expect(slugsOf(claude)).toEqual(['model-a', 'model-b']);
        const stored = JSON.parse(await readFile(join(home, 'models', 'catalogs.json'), 'utf8'));
        expect(stored).toEqual({ fetchedAt: clock, catalogs: { claude: NEWER } });

        const restarted = new ModelCatalog(SHIPPED);
        answer = () => Promise.reject(new Error('offline'));
        await feedOf({ claude: restarted }).load();
        expect(slugsOf(restarted)).toEqual(['model-a', 'model-b']);
    });

    test('asks again only once the answer is six hours old', async () => {
        const feed = feedOf({ claude: new ModelCatalog(SHIPPED) });
        await feed.refresh();
        clock += 5 * HOUR;
        await feed.refresh();
        expect(asked).toBe(1);
        clock += 2 * HOUR;
        await feed.refresh();
        expect(asked).toBe(2);
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

import { describe, expect, test } from 'bun:test';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { acpCatalogPath, acpCatalogStore } from './acp-catalog-store.ts';

const home = tempHomes('ruimte-acp-catalog-');

describe('acpCatalogStore', () => {
    test('reads nothing before anything was saved', async () => {
        expect(acpCatalogStore(await home(), 'grok').load()).toBeNull();
    });

    test('keeps a value per kind in the machine folder', async () => {
        const folder = await home();
        acpCatalogStore(folder, 'grok').save({ commands: ['compact'] });
        expect(acpCatalogStore(folder, 'grok').load()).toEqual({ commands: ['compact'] });
        expect(acpCatalogStore(folder, 'copilot').load()).toBeNull();
        const path = acpCatalogPath(folder, 'grok');
        expect(path).toBe(join(folder, 'models', 'agents', 'grok.json'));
        expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ commands: ['compact'] });
    });

    test.skipIf(process.platform === 'win32')('a value it keeps is readable only by its owner', async () => {
        const folder = await home();
        acpCatalogStore(folder, 'grok').save({});
        expect((await stat(acpCatalogPath(folder, 'grok'))).mode & 0o777).toBe(0o600);
    });

    test('a file that does not read as JSON counts as none', async () => {
        const folder = await home();
        acpCatalogStore(folder, 'grok').save({});
        await writeFile(acpCatalogPath(folder, 'grok'), '{ not json');
        expect(acpCatalogStore(folder, 'grok').load()).toBeNull();
    });
});

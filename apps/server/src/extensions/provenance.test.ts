import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { EXTENSION_API_VERSION } from '@ruimte/contracts';
import { ExtensionHost } from './extension-host.ts';
import { DEVELOPMENT_EXTENSION_FOLDERS, developmentExtensionRoots, extensionProvenance } from './provenance.ts';
import { ExtensionStore } from './store.ts';

const SOURCE = join(import.meta.dir, '..');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'ruimte-extension-provenance-')));

afterAll(() => rmSync(root, { recursive: true, force: true }));

function built(folder: string, id: string): string {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ id, name: id, version: '0.1.0', api: EXTENSION_API_VERSION }));

    return folder;
}

describe('where an extension came from', () => {
    const roots = [join(sep, 'work', 'ruimte', 'extensions', 'dev')];

    test('is a pack a person installed without a linked folder, whatever its manifest says', () => {
        expect(extensionProvenance({}, roots)).toBe('installed');
    });

    test('is a development extension only for a folder inside the development folders', () => {
        expect(extensionProvenance({ devFolder: join(roots[0] as string, 'trackline', 'dist') }, roots)).toBe('development');
        expect(extensionProvenance({ devFolder: join(sep, 'work', 'ruimte', 'extensions', 'dev-other', 'dist') }, roots)).toBe('dev-link');
        expect(extensionProvenance({ devFolder: join(sep, 'work', 'mine', 'dist') }, roots)).toBe('dev-link');
    });

    test('is never a development extension to a compiled daemon', () => {
        expect(developmentExtensionRoots(true, SOURCE)).toEqual([]);
        expect(extensionProvenance({ devFolder: join(roots[0] as string, 'trackline', 'dist') }, [])).toBe('dev-link');
    });

    test('reads the development folders of the checkout a daemon runs from', () => {
        const found = developmentExtensionRoots(false, SOURCE);

        expect(found).toHaveLength(DEVELOPMENT_EXTENSION_FOLDERS.length);
        expect(found.every((folder, i) => folder.endsWith(join(...(DEVELOPMENT_EXTENSION_FOLDERS[i] as string).split('/'))))).toBe(true);
    });

    test('is what the machine lists for each link, by the folder it was linked from', async () => {
        const developmentRoots = [join(root, 'checkout', 'extensions', 'dev')];
        const host = new ExtensionHost({ store: new ExtensionStore(join(root, 'home')), developmentRoots });

        await host.linked(built(join(developmentRoots[0] as string, 'trackline', 'dist'), 'ruimte.trackline'));
        await host.linked(built(join(root, 'mine', 'dist'), 'acme.mine'));

        const listed = Object.fromEntries((await host.list()).map((info) => [info.manifest.id, info.provenance]));

        expect(listed).toEqual({ 'ruimte.trackline': 'development', 'acme.mine': 'dev-link' });
    });
});

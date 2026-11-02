import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { syncExtensions } from '@/extensions/loader';
import { useContributions } from '@/extensions/registry';
import { installDesktop, removeDesktop } from '../../testing/dom-helpers';

let folder: string;
let installed: InstalledClientExtension;

beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'ruimte-loader-'));
    mkdirSync(join(folder, 'client'));
    // What a pack writes: the API comes from the page, and the module registers when it runs.
    writeFileSync(
        join(folder, 'client', 'index.js'),
        "globalThis.__ruimteExtension.for('acme.again').client.defineCommand({ id: 'hello', title: 'Hello', run: () => undefined });\n"
    );
    installed = {
        manifest: { id: 'acme.again', name: 'Again', version: '0.1.0', api: 1, permissions: {} },
        base: `${folder}/`,
        enabled: true,
        hasClient: true,
        dev: false
    };
    installDesktop({ extensions: { list: async () => [installed] } as never });
});

afterAll(async () => {
    installed = { ...installed, enabled: false };
    await syncExtensions();
    removeDesktop();
    rmSync(folder, { recursive: true, force: true });
});

function hasCommand(): boolean {
    return useContributions.getState().commands.some((command) => command.id === 'extension:acme.again/hello');
}

describe('loading extensions', () => {
    test('runs what an extension registers again when it is turned back on', async () => {
        await syncExtensions();

        expect(hasCommand()).toBe(true);

        installed = { ...installed, enabled: false };
        await syncExtensions();

        expect(hasCommand()).toBe(false);

        installed = { ...installed, enabled: true };
        await syncExtensions();

        expect(hasCommand()).toBe(true);

        installed = { ...installed, enabled: false };
        await syncExtensions();

        expect(hasCommand()).toBe(false);
    });
});

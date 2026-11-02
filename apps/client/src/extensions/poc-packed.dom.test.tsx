import { afterAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentType } from 'react';
import type { ExtensionManifest } from '@ruimte/contracts';
import { forgetExtension, registerExtension } from '@/extensions/host/runtime';
import { useContributions } from '@/extensions/registry';
import { mount, until } from '../../testing/dom';

const FOLDER = join(import.meta.dir, '../../../../extensions/poc-surfaces');
const OUTPUT = join(FOLDER, 'dist');
// By a path the types do not follow: the client's project never reaches into the daemon's, only this test does.
const PACK = '../../../server/src/extensions/pack.ts';

afterAll(() => {
    // The stores outlive this file, and a surface left behind would draw over another file's window.
    forgetExtension('poc.surfaces');
    rmSync(OUTPUT, { recursive: true, force: true });
});

describe('a built extension', () => {
    test('loads from its own files, with its imports answered by the page', async () => {
        const { buildExtension } = (await import(PACK)) as { buildExtension(folder: string): Promise<{ manifest: ExtensionManifest }> };
        const { manifest } = await buildExtension(FOLDER);

        registerExtension({ manifest, base: '/', disposers: [], settings: null });
        await import(join(OUTPUT, 'client/index.js'));

        const panel = useContributions.getState().panels.find((entry) => entry.kind === 'extension:poc.surfaces/panel');
        const Surface = panel?.component as ComponentType;
        const mounted = mount();

        await mounted.render(<Surface />);
        await until(() => mounted.host.textContent?.includes('"nodes"') ?? false);

        expect(mounted.host.textContent).toContain('"selection"');
        await mounted.unmount();

        expect(await Bun.file(join(OUTPUT, 'client/index.js')).text()).toContain('__ruimteExtension.for("poc.surfaces", import.meta.url).console');
    });
});

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import { syncExtensions, useInstalledExtensions } from '@/extensions/loader';
import { useContributions } from '@/extensions/registry';
import { until } from '../../testing/dom';
import { installDesktop, removeDesktop } from '../../testing/dom-helpers';

let folder: string;
let installed: InstalledClientExtension[] = [];

/* What a pack writes: the API comes from the page, and the module registers when it runs, or later through `later`. */
function writeExtension(id: string, module: string): InstalledClientExtension {
    const base = join(folder, id);

    mkdirSync(join(base, 'client'), { recursive: true });
    writeFileSync(join(base, 'client', 'index.js'), module);

    return {
        manifest: { id, name: id, version: '0.1.0', api: 1, permissions: {} },
        base: `${base}/`,
        enabled: true,
        hasClient: true,
        dev: false
    };
}

function turn(id: string, enabled: boolean): void {
    installed = installed.map((entry) => (entry.manifest.id === id ? { ...entry, enabled } : entry));
}

beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'ruimte-loader-'));
    installDesktop({ extensions: { list: async () => installed } as never });
});

afterEach(async () => {
    installed = installed.map((entry) => ({ ...entry, enabled: false }));
    await syncExtensions();
    installed = [];
});

afterAll(() => {
    removeDesktop();
    rmSync(folder, { recursive: true, force: true });
});

function hasCommand(id: string): boolean {
    return useContributions.getState().commands.some((command) => command.id === `extension:${id}/hello`);
}

describe('loading extensions', () => {
    test('runs what an extension registers again when it is turned back on', async () => {
        installed = [
            writeExtension(
                'acme.again',
                "globalThis.__ruimteExtension.for('acme.again').client.defineCommand({ id: 'hello', title: 'Hello', run: () => undefined });\n"
            )
        ];
        await syncExtensions();

        expect(hasCommand('acme.again')).toBe(true);

        turn('acme.again', false);
        await syncExtensions();

        expect(hasCommand('acme.again')).toBe(false);

        turn('acme.again', true);
        await syncExtensions();

        expect(hasCommand('acme.again')).toBe(true);
    });

    test('adds nothing an extension registers after it was turned off', async () => {
        installed = [
            writeExtension(
                'acme.later',
                [
                    "const { client } = globalThis.__ruimteExtension.for('acme.later');",
                    "globalThis.__registerLater = () => client.defineCommand({ id: 'hello', title: 'Hello', run: () => undefined });",
                    "globalThis.__listenLater = () => client.onEvent('view.changed', () => undefined);",
                    ''
                ].join('\n')
            )
        ];
        await syncExtensions();
        turn('acme.later', false);
        await syncExtensions();

        const scope = globalThis as { __registerLater?: () => void; __listenLater?: () => () => void };

        scope.__registerLater?.();
        scope.__listenLater?.();

        expect(hasCommand('acme.later')).toBe(false);

        delete scope.__registerLater;
        delete scope.__listenLater;
    });

    test('registers again when turned back on, also when the API came in through a chunk the page ran before', async () => {
        const entry = writeExtension(
            'acme.chunked',
            "import { client } from './shared.js';\nclient.defineCommand({ id: 'hello', title: 'Hello', run: () => undefined });\n"
        );

        writeFileSync(join(folder, 'acme.chunked', 'client', 'shared.js'), "export const { client } = globalThis.__ruimteExtension.for('acme.chunked');\n");
        installed = [entry];
        await syncExtensions();
        turn('acme.chunked', false);
        await syncExtensions();
        turn('acme.chunked', true);
        await syncExtensions();

        expect(hasCommand('acme.chunked')).toBe(true);
    });

    test('applies no list that came in after a newer one, so a slow answer does not load what was turned off', async () => {
        const answers: ((entries: InstalledClientExtension[]) => void)[] = [];
        const entry = writeExtension(
            'acme.stale',
            "globalThis.__ruimteExtension.for('acme.stale').client.defineCommand({ id: 'hello', title: 'Hello', run: () => undefined });\n"
        );

        installDesktop({ extensions: { list: () => new Promise((resolve) => answers.push(resolve)) } as never });

        try {
            const older = syncExtensions();
            const newer = syncExtensions();

            answers[1]?.([{ ...entry, enabled: false }]);
            await newer;
            answers[0]?.([entry]);
            await older;

            expect(hasCommand('acme.stale')).toBe(false);
            expect(useInstalledExtensions.getState().installed).toEqual([{ ...entry, enabled: false }]);
        } finally {
            installDesktop({ extensions: { list: async () => installed } as never });
        }
    });

    test('loads the others while one waits on a top-level await that never ends', async () => {
        installed = [
            writeExtension('acme.stuck', 'await new Promise(() => undefined);\n'),
            writeExtension(
                'acme.free',
                "globalThis.__ruimteExtension.for('acme.free').client.defineCommand({ id: 'hello', title: 'Hello', run: () => undefined });\n"
            )
        ];

        void syncExtensions();
        await until(() => hasCommand('acme.free'));
    });

    test('runs the code only once its stylesheet loaded', async () => {
        installed = [
            writeExtension(
                'acme.styled',
                "globalThis.__ruimteExtension.for('acme.styled').client.defineCommand({ id: 'hello', title: 'Hello', run: () => undefined });\n"
            )
        ];

        // The page keeps the sheet loading until the test says it loaded.
        let sheet: Node | null = null;
        const fetched = spyOn(globalThis, 'fetch').mockImplementationOnce((async () => new Response(null, { status: 200 })) as unknown as typeof fetch);
        const appended = spyOn(document.head, 'append').mockImplementationOnce((node) => {
            sheet = node as Node;
        });

        try {
            const synced = syncExtensions();

            await until(() => sheet !== null);

            const before = hasCommand('acme.styled');

            (sheet as Node | null)?.dispatchEvent(new Event('load'));
            await synced;

            expect(before).toBe(false);
            expect(hasCommand('acme.styled')).toBe(true);
        } finally {
            fetched.mockRestore();
            appended.mockRestore();
        }
    });

    test('shows no failure and adds nothing for a load that was taken down while its files came in', async () => {
        installed = [
            writeExtension(
                'acme.slow',
                "globalThis.__ruimteExtension.for('acme.slow').client.defineCommand({ id: 'hello', title: 'Hello', run: () => undefined });\n"
            )
        ];

        let arrive = (): void => undefined;
        const fetched = spyOn(globalThis, 'fetch').mockImplementationOnce(
            (() =>
                new Promise<Response>((resolve) => {
                    arrive = () => resolve(new Response(null, { status: 404 }));
                })) as unknown as typeof fetch
        );

        try {
            const first = syncExtensions();

            await until(() => fetched.mock.calls.length > 0);

            turn('acme.slow', false);
            await syncExtensions();
            arrive();
            await first;

            expect(useInstalledExtensions.getState().failures['acme.slow']).toBeUndefined();
            expect(hasCommand('acme.slow')).toBe(false);
        } finally {
            fetched.mockRestore();
        }
    });
});

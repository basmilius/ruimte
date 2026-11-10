import { afterAll, afterEach, beforeAll, describe, expect, jest, spyOn, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ExtensionInfo, ExtensionManifest } from '@ruimte/contracts';
import type { InstalledClientExtension } from '@ruimte/desktop-bridge';
import type { ComponentType } from 'react';
import { followDevLinks, syncExtensions, useInstalledExtensions } from '@/extensions/loader';
import { startExtensions } from '@/extensions/watch';
import { useContributions } from '@/state/extension-registry';
import { useToasts } from '@/state/toasts';
import { mount, until } from '../../testing/dom';
import { installDesktop, removeDesktop } from '../../testing/dom-helpers';
import { serveExtensionLoads, writeExtension as writeFolderExtension } from '../../testing/extension-loads';

// By a path the types do not follow: the client's project never reaches into the daemon's, only this test does.
const PACK = '../../../server/src/extensions/pack.ts';
let folder: string;
let installed: InstalledClientExtension[] = [];

serveExtensionLoads();

function writeExtension(id: string, module: string): InstalledClientExtension {
    return writeFolderExtension(folder, id, module);
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

async function untilUnderFakeClock(condition: () => boolean): Promise<void> {
    for (let turn = 0; turn < 200 && !condition(); turn++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    expect(condition()).toBe(true);
}

function hasCommand(id: string, command = 'hello'): boolean {
    return useContributions.getState().commands.some((each) => each.id === `extension:${id}/${command}`);
}

/* An entry and a lazy panel that share a chunk, where the bundler puts the API and the top-level registration. */
async function buildSplit(): Promise<InstalledClientExtension> {
    const project = join(folder, 'acme.split');
    const manifest: ExtensionManifest = { id: 'acme.split', name: 'Split', version: '0.1.0', api: 1, permissions: {} };
    const files: Record<string, string> = {
        'manifest.json': JSON.stringify(manifest),
        'client/index.ts': [
            "import { definePanel } from '@ruimte/extension/client';",
            "import { name } from './shared';",
            "definePanel({ id: 'side', title: name, component: () => import('./Side') });",
            'const scope = globalThis as { __splitLate?: (() => Promise<unknown>)[] };',
            "(scope.__splitLate ??= []).push(() => import('./Late'));"
        ].join('\n'),
        'client/Late.ts': "import { host } from '@ruimte/extension/client';\nhost.notify('Late chunk');\n",
        'client/shared.ts': [
            "import { defineCommand, host } from '@ruimte/extension/client';",
            "defineCommand({ id: 'hello', title: 'Hello', run: () => undefined });",
            'const scope = globalThis as { __splitKept?: (() => void)[] };',
            "(scope.__splitKept ??= []).push(() => { defineCommand({ id: 'late', title: 'Late', run: () => undefined }); host.notify('Late'); });",
            "export const name = 'Split';"
        ].join('\n'),
        'client/Side.tsx': [
            "import { host } from '@ruimte/extension/client';",
            "import { name } from './shared';",
            'const scope = globalThis as { __splitSides?: number };',
            'scope.__splitSides = (scope.__splitSides ?? 0) + 1;',
            "export default function Side() { return <p onClick={() => host.notify('Side')}>{name}</p>; }"
        ].join('\n')
    };

    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(project, path)), { recursive: true });
        writeFileSync(join(project, path), text);
    }

    const { buildExtension } = (await import(PACK)) as { buildExtension(folder: string): Promise<{ outdir: string }> };
    const { outdir } = await buildExtension(project);

    return { manifest, base: `${outdir}/`, enabled: true, hasClient: true, dev: false };
}

/* Draws the side panel, which imports its lazy chunk under the load in place. */
async function drawSide(): Promise<void> {
    const Side = useContributions.getState().panels.find((panel) => panel.kind === 'extension:acme.split/side')?.component as ComponentType;
    const mounted = mount();

    await mounted.render(<Side />);
    await until(() => mounted.host.textContent === 'Split');
    await mounted.unmount();
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

    test('runs a built bundle anew when turned back on, chunks too, and refuses what the load before it kept', async () => {
        const scope = globalThis as { __splitKept?: (() => void)[]; __splitLate?: (() => Promise<unknown>)[]; __splitSides?: number };

        installed = [await buildSplit()];

        try {
            await syncExtensions();
            await drawSide();

            expect(hasCommand('acme.split')).toBe(true);
            expect(scope.__splitSides).toBe(1);

            turn('acme.split', false);
            await syncExtensions();

            expect(hasCommand('acme.split')).toBe(false);

            turn('acme.split', true);
            await syncExtensions();
            await drawSide();

            expect(hasCommand('acme.split')).toBe(true);
            expect(scope.__splitSides).toBe(2);

            const toasts = useToasts.getState().toasts.length;
            const [before, now] = scope.__splitKept ?? [];
            const [importBefore, importNow] = scope.__splitLate ?? [];

            before?.();

            await expect(importBefore?.()).rejects.toThrow('turned off or replaced');
            expect(hasCommand('acme.split', 'late')).toBe(false);
            expect(useToasts.getState().toasts).toHaveLength(toasts);

            now?.();
            await importNow?.();

            expect(hasCommand('acme.split', 'late')).toBe(true);
            expect(useToasts.getState().toasts.map((toast) => toast.title)).toContain('Late chunk');
        } finally {
            delete scope.__splitKept;
            delete scope.__splitLate;
            delete scope.__splitSides;
        }
    });

    test('takes down what another window turned off in the shell, without a machine to say so', async () => {
        let changed = (): void => undefined;

        installed = [
            writeExtension(
                'acme.shared',
                "globalThis.__ruimteExtension.for('acme.shared').client.defineCommand({ id: 'hello', title: 'Hello', run: () => undefined });\n"
            )
        ];
        installDesktop({
            extensions: {
                list: async () => installed,
                onChanged: (listener: () => void) => {
                    changed = listener;

                    return () => undefined;
                }
            } as never
        });

        const stop = startExtensions();

        try {
            await until(() => hasCommand('acme.shared'));
            turn('acme.shared', false);
            changed();
            await until(() => !hasCommand('acme.shared'));
        } finally {
            stop();
            installDesktop({ extensions: { list: async () => installed } as never });
        }
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

    test('links a dev folder the machine keeps off as off, so another window never sees it on', async () => {
        const entry = writeExtension(
            'acme.devoff',
            "globalThis.__ruimteExtension.for('acme.devoff').client.defineCommand({ id: 'hello', title: 'Hello', run: () => undefined });\n"
        );
        let links: InstalledClientExtension[] = [];
        // What another window lists once the shell tells it of each change, in the order the calls reach the shell.
        const otherWindow: boolean[][] = [];
        const told = (): void => void otherWindow.push(links.map((each) => each.enabled));

        installDesktop({
            extensions: {
                list: async () => links,
                link: async (_folder: string, _revision: number, enabled?: boolean) => {
                    links = [{ ...entry, dev: true, enabled: enabled ?? links[0]?.enabled ?? true }];
                    told();
                },
                unlink: async () => undefined,
                setEnabled: async (_id: string, enabled: boolean) => {
                    links = links.map((each) => ({ ...each, enabled }));
                    told();
                }
            } as never
        });

        try {
            await followDevLinks([{ manifest: entry.manifest, enabled: false, hash: 'dev-1', devFolder: folder, revision: 1 } as ExtensionInfo]);

            expect(otherWindow).toEqual([[false]]);
            expect(hasCommand('acme.devoff')).toBe(false);
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

    for (const hung of ['its HEAD request', 'its load event'] as const) {
        test(`runs the code unstyled once the stylesheet deadline passed when ${hung} never comes`, async () => {
            const id = hung === 'its HEAD request' ? 'acme.headless' : 'acme.sheetless';
            installed = [
                writeExtension(id, `globalThis.__ruimteExtension.for('${id}').client.defineCommand({ id: 'hello', title: 'Hello', run: () => undefined });\n`)
            ];

            let sheet: Node | null = null;
            const fetched = spyOn(globalThis, 'fetch').mockImplementationOnce((async () =>
                hung === 'its HEAD request' ? new Promise<Response>(() => undefined) : new Response(null, { status: 200 })) as unknown as typeof fetch);
            const appended = spyOn(document.head, 'append').mockImplementationOnce((node) => {
                sheet = node as Node;
            });
            // Only the stylesheet's deadline runs on the fake clock; the files still come over the real route.
            jest.useFakeTimers();

            try {
                const synced = syncExtensions();

                await untilUnderFakeClock(() => fetched.mock.calls.length > 0 && (hung === 'its HEAD request' || sheet !== null));
                jest.advanceTimersByTime(14_999);
                for (let turn = 0; turn < 20; turn++) {
                    await new Promise((resolve) => setImmediate(resolve));
                }

                const early = hasCommand(id);

                jest.advanceTimersByTime(1);
                jest.useRealTimers();
                await synced;

                expect(early).toBe(false);
                expect(hasCommand(id)).toBe(true);
                expect(useInstalledExtensions.getState().failures[id]).toBeUndefined();
            } finally {
                jest.useRealTimers();
                fetched.mockRestore();
                appended.mockRestore();
            }
        });
    }

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

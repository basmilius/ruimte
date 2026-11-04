import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncExtensions, useInstalledExtensions } from '@/extensions/loader';
import { useContributions } from '@/extensions/registry';
import type { MachineExtensions } from '@/extensions/station-files';
import { useEndpoints } from '@/state/endpoints';
import { until } from '../../testing/dom';
import { serveExtensionLoads, writeExtension } from '../../testing/extension-loads';

// By machine, what its list request answers; a machine whose answer the test holds back sits here until it answers.
const answers = new Map<string, Promise<MachineExtensions>>();

let folder: string;

serveExtensionLoads();

// Copies, since a mock changes a module's exports in place, and the files after this one get the real ones back.
const station = { ...(await import('@/station')) };
const stationFiles = { ...(await import('@/extensions/station-files')) };
const transport = { ...(await import('@/transport')) };

beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'ruimte-loader-station-'));
    await mock.module('@/station', () => ({ ...station, IS_STATION: true }));
    await mock.module('@/extensions/station-files', () => ({
        ...stationFiles,
        machineExtensions: (_link: unknown, endpointId: string) => answers.get(endpointId) ?? Promise.resolve({ installed: [], failures: {} })
    }));
    await mock.module('@/transport', () => ({ ...transport, machineTransport: () => ({}) }));
});

afterAll(async () => {
    await mock.module('@/station', () => station);
    await mock.module('@/extensions/station-files', () => stationFiles);
    await mock.module('@/transport', () => transport);
    rmSync(folder, { recursive: true, force: true });
});

function hasCommand(id: string): boolean {
    return useContributions.getState().commands.some((each) => each.id === `extension:${id}/hello`);
}

describe('loading the extensions of the machine in front, on Station', () => {
    test('takes down what the machine before had once another is in front, also while its list fails', async () => {
        const entry = writeExtension(
            folder,
            'acme.before',
            "globalThis.__ruimteExtension.for('acme.before').client.defineCommand({ id: 'hello', title: 'Hello', run: () => undefined });\n"
        );
        let fail = (_reason: Error): void => undefined;

        answers.set('machine-a', Promise.resolve({ installed: [entry], failures: {} }));
        answers.set(
            'machine-b',
            new Promise((_resolve, reject) => {
                fail = reject;
            })
        );
        useEndpoints.setState({ activeId: 'machine-a' });
        await syncExtensions();

        expect(hasCommand('acme.before')).toBe(true);

        useEndpoints.setState({ activeId: 'machine-b' });

        const switching = syncExtensions();

        await until(() => !hasCommand('acme.before'));
        fail(new Error('machine-b cannot be reached'));
        await switching;

        expect(hasCommand('acme.before')).toBe(false);
        expect(useInstalledExtensions.getState().installed).toEqual([]);
    });
});

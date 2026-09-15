import { beforeEach, describe, expect, test } from 'bun:test';
import { useEndpoints, type Endpoint } from '../state/endpoints';
import { openFolderOn, restoreLastEndpoint, type FolderDeps } from './open';

const endpoint = (id: string): Endpoint => ({
    id,
    label: id,
    httpBaseUrl: `http://${id}`,
    wsBaseUrl: `ws://${id}`,
    reachability: 'lan',
    token: null,
    daemonId: id,
    daemonPublicKey: null
});

const fakeStorage = (storage: Map<string, string>) => ({
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key)
});

const stored = (value: unknown): Map<string, string> => new Map([['ruimte.lastProject', JSON.stringify(value)]]);

beforeEach(() => {
    useEndpoints.setState({ endpoints: [endpoint('local'), endpoint('daemon-b')], activeId: 'local' });
});

describe('the machine a cold boot lands on', () => {
    test('the machine the last project was opened on becomes the active one', () => {
        restoreLastEndpoint(fakeStorage(stored({ last: { endpointId: 'daemon-b', projectId: 'q1' }, byEndpoint: { 'daemon-b': 'q1' } })));
        expect(useEndpoints.getState().activeId).toBe('daemon-b');
    });

    test('a machine that is no longer known leaves the active one where it is', () => {
        restoreLastEndpoint(fakeStorage(stored({ last: { endpointId: 'daemon-gone', projectId: 'q1' }, byEndpoint: {} })));
        expect(useEndpoints.getState().activeId).toBe('local');
    });

    test('a record from before there was a last says nothing about where the work was', () => {
        restoreLastEndpoint(fakeStorage(stored({ 'daemon-b': 'q1' })));
        expect(useEndpoints.getState().activeId).toBe('local');
    });
});

const spyDeps = (over: Partial<FolderDeps> = {}): { deps: FolderDeps; steps: string[] } => {
    const steps: string[] = [];
    const deps: FolderDeps = {
        ensure: async (endpointId) => {
            steps.push(`ensure:${endpointId}`);
            return endpointId;
        },
        activate: async (endpointId) => void steps.push(`activate:${endpointId}`),
        settle: async () => void steps.push('settle'),
        openFolder: async (folder, createFolder) => void steps.push(`open:${folder}:${createFolder}`),
        ...over
    };
    return { deps, steps };
};

describe('opening a folder on the machine it is on', () => {
    test('the machine that is already active opens the folder and moves nothing', async () => {
        const { deps, steps } = spyDeps();
        await openFolderOn('local', '/work/atlas', false, deps);
        expect(steps).toEqual(['open:/work/atlas:false']);
    });

    test('another machine is reached first, then takes over, and only then is the folder opened', async () => {
        const { deps, steps } = spyDeps();
        await openFolderOn('daemon-b', '/work/atlas', true, deps);
        expect(steps).toEqual(['ensure:daemon-b', 'activate:daemon-b', 'settle', 'open:/work/atlas:true']);
    });

    test('a machine only the account knows is opened under the row the connect made for it', async () => {
        const { deps, steps } = spyDeps({
            ensure: async (endpointId) => {
                steps.push(`ensure:${endpointId}`);
                return 'attic-row';
            }
        });
        await openFolderOn('attic', '/work/atlas', false, deps);
        expect(steps).toEqual(['ensure:attic', 'activate:attic-row', 'settle', 'open:/work/atlas:false']);
    });

    test('a machine that cannot be reached fails with its reason and leaves the client where it is', async () => {
        const { deps, steps } = spyDeps({
            ensure: () => Promise.reject(new Error('No network path to the machine'))
        });
        await expect(openFolderOn('daemon-b', '/work/atlas', false, deps)).rejects.toThrow('No network path to the machine');
        expect(steps).toEqual([]);
    });
});

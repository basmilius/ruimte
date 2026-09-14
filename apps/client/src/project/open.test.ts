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
        activate: async (endpointId) => void steps.push(`activate:${endpointId}`),
        reach: async (endpointId) => void steps.push(`reach:${endpointId}`),
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

    test('another machine takes over first, and only then is the folder opened', async () => {
        const { deps, steps } = spyDeps();
        await openFolderOn('daemon-b', '/work/atlas', true, deps);
        expect(steps).toEqual(['activate:daemon-b', 'reach:daemon-b', 'open:/work/atlas:true']);
    });

    test('a machine that never answers fails with what the wait says, and opens nothing', async () => {
        const { deps, steps } = spyDeps({
            reach: () => Promise.reject(new Error('That machine is not answering'))
        });
        await expect(openFolderOn('daemon-b', '/work/atlas', false, deps)).rejects.toThrow('That machine is not answering');
        expect(steps).toEqual(['activate:daemon-b']);
    });

    test('a machine this client has forgotten is not dialed at all', async () => {
        const { deps, steps } = spyDeps();
        await expect(openFolderOn('daemon-gone', '/work/atlas', false, deps)).rejects.toThrow('no longer in the list');
        expect(steps).toEqual([]);
    });
});

import { beforeEach, describe, expect, test } from 'bun:test';
import { useEndpoints, type Endpoint } from '../state/endpoints';
import { restoreLastEndpoint } from './open';

const endpoint = (id: string): Endpoint => ({
    id,
    label: id,
    httpBaseUrl: `http://${id}`,
    wsBaseUrl: `ws://${id}`,
    reachability: 'lan',
    token: null,
    daemonId: id
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

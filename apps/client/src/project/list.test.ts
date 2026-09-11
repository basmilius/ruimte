import { beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import { useEndpoints, type Endpoint } from '../state/endpoints';
import { useProject } from '../state/project';
import { groupProjects, primeCachedLists, readCachedList, writeCachedList } from './list';

const summary = (projectId: string, lastOpenedAt = 0): ProjectSummary => ({
    projectId,
    name: projectId,
    color: '#000',
    folder: `/repo/${projectId}`,
    lastOpenedAt,
    available: true,
    icon: { kind: 'initial', value: projectId[0]!.toUpperCase() },
    nameSource: 'chosen'
});

const endpoint = (id: string, label: string): Endpoint => ({
    id,
    label,
    httpBaseUrl: `http://${id}`,
    wsBaseUrl: `ws://${id}`,
    reachability: 'lan',
    token: null,
    daemonId: id
});

/* The three calls the list makes on the storage it is given, over a map a test can read. */
const fakeStorage = (storage: Map<string, string>) => ({
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key)
});

beforeEach(() => {
    useProject.setState({ projects: [] });
});

describe('the union of the machines that are known', () => {
    test('one machine answering leaves the other machines listed', () => {
        const state = useProject.getState();
        state.setProjects('daemon-a', [summary('p1'), summary('p2')]);
        state.setProjects('daemon-b', [summary('q1')]);
        state.setProjects('daemon-a', [summary('p1')]);
        expect(useProject.getState().projects).toEqual([
            { endpointId: 'daemon-b', summary: summary('q1') },
            { endpointId: 'daemon-a', summary: summary('p1') }
        ]);
    });

    test('a renamed project only changes the row of its own machine', () => {
        const state = useProject.getState();
        state.setProjects('daemon-a', [summary('p1')]);
        state.setProjects('daemon-b', [summary('p1')]);
        state.patchProject('daemon-b', { ...summary('p1'), name: 'Renamed' });
        expect(useProject.getState().projects.map((row) => `${row.endpointId}:${row.summary.name}`)).toEqual(['daemon-a:p1', 'daemon-b:Renamed']);
    });

    test('a machine that is forgotten takes its rows with it', () => {
        const state = useProject.getState();
        state.setProjects('daemon-a', [summary('p1')]);
        state.setProjects('daemon-b', [summary('q1')]);
        state.forgetProjects('daemon-b');
        expect(useProject.getState().projects.map((row) => row.endpointId)).toEqual(['daemon-a']);
    });

    test('the machine being worked on comes first, and one without projects is left out', () => {
        const endpoints = [endpoint('local', 'This machine'), endpoint('daemon-b', 'Work laptop'), endpoint('daemon-c', 'Studio')];
        const rows = [
            { endpointId: 'daemon-b', summary: summary('q1') },
            { endpointId: 'local', summary: summary('p1') }
        ];
        const groups = groupProjects(rows, endpoints, 'daemon-b', ['daemon-b']);
        expect(groups.map((group) => group.label)).toEqual(['Work laptop', 'This machine']);
        expect(groups.map((group) => group.connected)).toEqual([true, false]);
        expect(groups[0]!.rows).toHaveLength(1);
    });
});

describe('the list a machine is remembered by', () => {
    test('what a machine answered comes back after it stops answering', () => {
        const storage = new Map<string, string>();
        writeCachedList('daemon-b', [summary('q1'), summary('q2')], fakeStorage(storage));
        expect(readCachedList('daemon-b', fakeStorage(storage)).map((project) => project.projectId)).toEqual(['q1', 'q2']);
        expect(readCachedList('daemon-c', fakeStorage(storage))).toEqual([]);
    });

    test('a long list is cut down to the projects that were opened most recently', () => {
        const storage = new Map<string, string>();
        const many = Array.from({ length: 60 }, (_unused, i) => summary(`p${i}`, i));
        writeCachedList('daemon-b', many, fakeStorage(storage));
        const cached = readCachedList('daemon-b', fakeStorage(storage));
        expect(cached).toHaveLength(50);
        expect(cached[0]!.projectId).toBe('p59');
    });

    test('the remembered lists fill the union, and leave a machine that already answered alone', () => {
        const storage = new Map<string, string>();
        writeCachedList('daemon-a', [summary('p1')], fakeStorage(storage));
        writeCachedList('daemon-b', [summary('q1')], fakeStorage(storage));
        useEndpoints.setState({ endpoints: [endpoint('daemon-a', 'A'), endpoint('daemon-b', 'B')], activeId: 'daemon-a' });
        useProject.getState().setProjects('daemon-a', [summary('p2')]);

        primeCachedLists(fakeStorage(storage));
        expect(useProject.getState().projects.map((row) => `${row.endpointId}:${row.summary.projectId}`)).toEqual(['daemon-a:p2', 'daemon-b:q1']);
    });
});

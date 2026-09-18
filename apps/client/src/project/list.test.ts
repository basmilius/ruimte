import { beforeEach, describe, expect, test } from 'bun:test';
import type { ConnectionState, TransportStatus } from '../transport/transport';
import type { ProjectSummary } from '@ruimte/contracts';
import { useEndpoints, type Endpoint } from '../state/endpoints';
import { useProjectList } from '../state/project-list';
import { pool } from '../transport';
import {
    listProjects,
    menuProjects,
    openableRows,
    primeCachedLists,
    recentProjects,
    readCachedList,
    watchOpenLists,
    writeCachedList,
    type OpenListSource
} from './list';

const summary = (projectId: string, lastOpenedAt = 0, closedAt: number | null = null): ProjectSummary => ({
    projectId,
    name: projectId,
    color: '#000',
    folder: `/repo/${projectId}`,
    lastOpenedAt,
    closedAt,
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
    daemonId: id,
    daemonPublicKey: null
});

/* The three calls the list makes on the storage it is given, over a map a test can read. */
const fakeStorage = (storage: Map<string, string>) => ({
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key)
});

beforeEach(() => {
    useProjectList.setState({ projects: [] });
});

describe('the union of the machines that are known', () => {
    test('one machine answering leaves the other machines listed', () => {
        const state = useProjectList.getState();
        state.setProjects('daemon-a', [summary('p1'), summary('p2')]);
        state.setProjects('daemon-b', [summary('q1')]);
        state.setProjects('daemon-a', [summary('p1')]);
        expect(useProjectList.getState().projects).toEqual([
            { endpointId: 'daemon-b', summary: summary('q1') },
            { endpointId: 'daemon-a', summary: summary('p1') }
        ]);
    });

    test('a renamed project only changes the row of its own machine', () => {
        const state = useProjectList.getState();
        state.setProjects('daemon-a', [summary('p1')]);
        state.setProjects('daemon-b', [summary('p1')]);
        state.patchProject('daemon-b', { ...summary('p1'), name: 'Renamed' });
        expect(useProjectList.getState().projects.map((row) => `${row.endpointId}:${row.summary.name}`)).toEqual(['daemon-a:p1', 'daemon-b:Renamed']);
    });

    test('a machine that is forgotten takes its rows with it', () => {
        const state = useProjectList.getState();
        state.setProjects('daemon-a', [summary('p1')]);
        state.setProjects('daemon-b', [summary('q1')]);
        state.forgetProjects('daemon-b');
        expect(useProjectList.getState().projects.map((row) => row.endpointId)).toEqual(['daemon-a']);
    });
});

describe('the recent list of the start screen', () => {
    const endpoints = [endpoint('local', 'This machine'), endpoint('daemon-b', 'Work laptop')];

    test('open and closed projects in one list, on whichever came last: opening or closing', () => {
        const rows = [
            { endpointId: 'local', summary: summary('p1', 30) },
            { endpointId: 'daemon-b', summary: summary('q1', 10, 300) },
            { endpointId: 'local', summary: summary('p2', 200, 50) },
            { endpointId: 'daemon-c', summary: summary('r1', 900) }
        ];
        expect(recentProjects(rows, endpoints, []).map((row) => row.summary.projectId)).toEqual(['q1', 'p2', 'p1']);
    });

    test('a project closed a moment ago is on top, one click from coming back', () => {
        const rows = [
            { endpointId: 'local', summary: summary('p1', 500) },
            { endpointId: 'local', summary: summary('p2', 100, 600) }
        ];
        expect(recentProjects(rows, endpoints, ['local'])[0]).toMatchObject({ summary: { projectId: 'p2' }, connected: true });
    });
});

describe('the switcher as one list', () => {
    const endpoints = [endpoint('local', 'This machine'), endpoint('daemon-b', 'Work laptop')];

    test('every machine in one list, most recently opened first', () => {
        const rows = [
            { endpointId: 'daemon-b', summary: summary('q1', 10) },
            { endpointId: 'local', summary: summary('p1', 30) },
            { endpointId: 'daemon-b', summary: summary('q2', 20) }
        ];
        const { open } = menuProjects(rows, endpoints, ['daemon-b']);
        expect(open.map((row) => row.summary.projectId)).toEqual(['p1', 'q2', 'q1']);
        expect(open.map((row) => row.machineLabel)).toEqual(['This machine', 'Work laptop', 'Work laptop']);
        expect(open.map((row) => row.connected)).toEqual([false, true, true]);
    });

    test('a project that was closed leaves the list for Recent, most recently closed first', () => {
        const rows = [
            { endpointId: 'local', summary: summary('p1', 30, 100) },
            { endpointId: 'local', summary: summary('p2', 20) },
            { endpointId: 'daemon-b', summary: summary('q1', 10, 300) }
        ];
        const { open, recent } = menuProjects(rows, endpoints, []);
        expect(open.map((row) => row.summary.projectId)).toEqual(['p2']);
        expect(recent.map((row) => row.summary.projectId)).toEqual(['q1', 'p1']);
    });

    test('a daemon that answers without closedAt leaves every project in use', () => {
        const rows = [{ endpointId: 'local', summary: { ...summary('p1', 30), closedAt: undefined } }];
        const { open, recent } = menuProjects(rows, endpoints, []);
        expect(open).toHaveLength(1);
        expect(recent).toHaveLength(0);
    });

    test('a machine this client no longer knows takes its rows with it', () => {
        const rows = [
            { endpointId: 'daemon-c', summary: summary('r1', 40) },
            { endpointId: 'local', summary: summary('p1', 10) }
        ];
        expect(menuProjects(rows, endpoints, []).open.map((row) => row.summary.projectId)).toEqual(['p1']);
    });
});

describe('the rows worth offering', () => {
    const endpoints = [endpoint('local', 'This machine')];
    const gone = (projectId: string): ProjectSummary => ({ ...summary(projectId, 10), available: false });

    test('a project whose file its machine no longer finds is left out', () => {
        const rows = [
            { endpointId: 'local', summary: gone('p1') },
            { endpointId: 'local', summary: summary('p2', 20) }
        ];
        const { open } = menuProjects(rows, endpoints, ['local']);
        expect(openableRows(open).map((row) => row.summary.projectId)).toEqual(['p2']);
    });

    test('the project that is open keeps its row, so it can still be closed', () => {
        const rows = [{ endpointId: 'local', summary: gone('p1') }];
        const { open } = menuProjects(rows, endpoints, ['local']);
        expect(openableRows(open, 'local:p1').map((row) => row.summary.projectId)).toEqual(['p1']);
        expect(openableRows(open, 'other:p1')).toEqual([]);
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
        useProjectList.getState().setProjects('daemon-a', [summary('p2')]);

        primeCachedLists(fakeStorage(storage));
        expect(useProjectList.getState().projects.map((row) => `${row.endpointId}:${row.summary.projectId}`)).toEqual(['daemon-a:p2', 'daemon-b:q1']);
    });
});

/* The part of the pool the list reads, with links a test opens and closes by hand. */
const fakeLinks = () => {
    const states = new Map<string, TransportStatus>();
    const listeners = new Set<() => void>();
    const source: OpenListSource = {
        ids: () => [...states.keys()],
        statusOf: (endpointId): ConnectionState => ({
            status: states.get(endpointId) ?? 'closed',
            attempts: 0,
            retryAt: null,
            noLink: !states.has(endpointId)
        }),
        subscribe: (handler) => {
            listeners.add(handler);
            return () => {
                listeners.delete(handler);
            };
        }
    };
    const set = (endpointId: string, status: TransportStatus): void => {
        states.set(endpointId, status);
        for (const listener of [...listeners]) {
            listener();
        }
    };
    return { source, set };
};

describe('the list and the links', () => {
    test('listing a machine without a link asks nothing and opens no link', async () => {
        useEndpoints.setState({ endpoints: [endpoint('daemon-idle', 'Idle')], activeId: 'daemon-idle' });
        expect(await listProjects('daemon-idle')).toEqual([]);
        expect(pool.peek('daemon-idle')).toBeNull();
        expect(pool.ids()).not.toContain('daemon-idle');
    });

    test('a link that opens for any reason is asked for its list, and one that only connects is not', () => {
        const { source, set } = fakeLinks();
        let refreshed = 0;
        watchOpenLists(source, () => {
            refreshed += 1;
        });
        expect(refreshed).toBe(1);

        set('daemon-a', 'connecting');
        expect(refreshed).toBe(1);
        set('daemon-a', 'open');
        expect(refreshed).toBe(2);
        set('daemon-a', 'open');
        expect(refreshed).toBe(2);
    });
});

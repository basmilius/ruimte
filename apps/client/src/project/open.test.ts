import { beforeEach, describe, expect, test } from 'bun:test';
import { useEndpoints, type Endpoint } from '../state/endpoints';
import { restoreLastEndpoint, switchRun, type SwitchDeps, type SwitchPlan, type Whereabouts } from './open';

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

const spyDeps = (over: Partial<SwitchDeps> = {}): { deps: SwitchDeps; steps: string[] } => {
    const steps: string[] = [];
    let current: { projectId: string | null; endpointId: string | null } = { projectId: 'p0', endpointId: 'local' };
    const deps: SwitchDeps = {
        ensure: async (endpointId) => {
            steps.push(`ensure:${endpointId}`);
            return endpointId;
        },
        activeId: () => useEndpoints.getState().activeId,
        current: () => current,
        activate: async (endpointId) => {
            steps.push(`activate:${endpointId}`);
            useEndpoints.getState().setActive(endpointId);
            current = { projectId: null, endpointId: null };
        },
        settle: async () => void steps.push('settle'),
        openProject: async (projectId) => {
            steps.push(`project:${projectId}`);
            current = { projectId, endpointId: useEndpoints.getState().activeId };
        },
        openFolder: async (folder, createFolder) => void steps.push(`open:${folder}:${createFolder}`),
        remembered: (endpointId) => (endpointId === 'daemon-b' ? 'q-before' : null),
        remember: (endpointId, projectId) => void steps.push(`remember:${endpointId}:${projectId}`),
        ...over
    };
    return { deps, steps };
};

const HERE: Whereabouts = { endpointId: 'local', projectId: 'p0' };

/* Runs the steps of a plan the way the switch does, with a signal nobody aborts unless the test passes one. */
const run = (plan: SwitchPlan, deps: SwitchDeps, controller = new AbortController(), opening: () => void = () => undefined) => {
    const handle = switchRun(plan, HERE, deps);
    return { handle, done: handle.steps({ signal: controller.signal, opening }) };
};

const folder = (endpointId: string, createFolder = false): SwitchPlan => ({ kind: 'folder', endpointId, folder: '/work/atlas', createFolder });

describe('opening a folder on the machine it is on', () => {
    test('the machine that is already active is reached, opens the folder and moves nothing', async () => {
        const { deps, steps } = spyDeps();
        await run(folder('local'), deps).done;
        // No machine keeps a link while nothing is open on it, the active one included.
        expect(steps).toEqual(['ensure:local', 'open:/work/atlas:false']);
    });

    test('the active machine that cannot be reached opens nothing', async () => {
        const { deps, steps } = spyDeps({
            ensure: () => Promise.reject(new Error('That machine is not answering'))
        });
        await expect(run(folder('local'), deps).done).rejects.toThrow('That machine is not answering');
        expect(steps).toEqual([]);
    });

    test('another machine is reached first, then takes over, and only then is the folder opened', async () => {
        const { deps, steps } = spyDeps();
        await run(folder('daemon-b', true), deps).done;
        expect(steps).toEqual(['ensure:daemon-b', 'activate:daemon-b', 'settle', 'open:/work/atlas:true']);
    });

    test('a machine only the account knows is opened under the row the connect made for it', async () => {
        const { deps, steps } = spyDeps({
            ensure: async (endpointId) => {
                steps.push(`ensure:${endpointId}`);
                return 'attic-row';
            }
        });
        await run(folder('attic'), deps).done;
        expect(steps).toEqual(['ensure:attic', 'activate:attic-row', 'settle', 'open:/work/atlas:false']);
    });

    test('a machine that cannot be reached fails with its reason and leaves the client where it is', async () => {
        const { deps, steps } = spyDeps({
            ensure: () => Promise.reject(new Error('No network path to the machine'))
        });
        await expect(run(folder('daemon-b'), deps).done).rejects.toThrow('No network path to the machine');
        expect(steps).toEqual([]);
    });
});

describe('opening a project on the machine it is on', () => {
    test('the project step starts only once the machine answered', async () => {
        let resolveEnsure!: (id: string) => void;
        const { deps } = spyDeps({ ensure: () => new Promise((resolve) => (resolveEnsure = resolve)) });
        const phases: string[] = [];
        const { done } = run({ kind: 'project', endpointId: 'daemon-b', projectId: 'q1' }, deps, undefined, () => phases.push('opening'));
        await Promise.resolve();
        expect(phases).toEqual([]);
        resolveEnsure('daemon-b');
        await done;
        expect(phases).toEqual(['opening']);
    });

    test('another machine remembers the project before it takes over, so its boot opens that one', async () => {
        const { deps, steps } = spyDeps();
        await run({ kind: 'project', endpointId: 'daemon-b', projectId: 'q1' }, deps).done;
        expect(steps).toEqual(['ensure:daemon-b', 'remember:daemon-b:q1', 'activate:daemon-b', 'settle', 'project:q1']);
    });

    test('a project on the active machine is opened without moving anything', async () => {
        const { deps, steps } = spyDeps();
        await run({ kind: 'project', endpointId: 'local', projectId: 'p1' }, deps).done;
        expect(steps).toEqual(['ensure:local', 'settle', 'project:p1']);
    });

    test('a run cancelled while connecting stops before anything moves, and going back undoes nothing', async () => {
        const controller = new AbortController();
        const { deps, steps } = spyDeps({
            ensure: (_endpointId, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped'))))
        });
        const { handle, done } = run({ kind: 'project', endpointId: 'daemon-b', projectId: 'q1' }, deps, controller);
        controller.abort('back');
        await expect(done).rejects.toThrow('stopped');
        await handle.back();
        expect(steps).toEqual([]);
    });

    test('going back from another machine restores what both machines remembered and returns to the one before', async () => {
        const { deps, steps } = spyDeps();
        const { handle, done } = run({ kind: 'project', endpointId: 'daemon-b', projectId: 'q1' }, deps);
        await done;
        steps.length = 0;
        await handle.back();
        expect(steps).toEqual(['remember:daemon-b:q-before', 'remember:local:p0', 'activate:local', 'settle']);
    });

    test('going back on the same machine reopens the project that was open', async () => {
        const { deps, steps } = spyDeps();
        const { handle, done } = run({ kind: 'project', endpointId: 'local', projectId: 'p1' }, deps);
        await done;
        steps.length = 0;
        await handle.back();
        expect(steps).toEqual(['project:p0']);
    });
});

describe('opening a machine with nothing picked on it', () => {
    test('the machine takes over and its boot is waited for', async () => {
        const { deps, steps } = spyDeps();
        await run({ kind: 'machine', endpointId: 'daemon-b' }, deps).done;
        expect(steps).toEqual(['ensure:daemon-b', 'activate:daemon-b', 'settle']);
    });
});

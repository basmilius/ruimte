import { beforeEach, describe, expect, test } from 'bun:test';
import { useEndpoints, type Endpoint } from '../state/endpoints';
import { useWindow } from '../state/window';
import type { OpenRequest } from '../transport/connections';
import { bootWindow, switchRun, type SwitchDeps, type SwitchPlan, type Whereabouts } from './open';

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

const describeRequest = (request: OpenRequest): string => {
    if ('projectId' in request) {
        return `project:${request.projectId}`;
    }
    if ('folder' in request) {
        return `folder:${request.folder}:${request.createFolder}`;
    }
    return `new:${request.name}`;
};

/* A window with a project on screen (or none), and every step the switch takes written down. */
const spyDeps = (start: Whereabouts | null, over: Partial<SwitchDeps> = {}): { deps: SwitchDeps; steps: string[]; here: () => Whereabouts | null } => {
    const steps: string[] = [];
    let current = start;
    const deps: SwitchDeps = {
        ensure: async (endpointId) => {
            steps.push(`ensure:${endpointId}`);
            return endpointId;
        },
        current: () => current,
        leave: async () => {
            steps.push('leave');
        },
        enter: async (endpointId, request) => {
            steps.push(`enter:${endpointId}:${describeRequest(request)}`);
            current = { endpointId, projectId: 'projectId' in request ? request.projectId : 'opened' };
        },
        toStart: () => {
            steps.push('start');
            current = null;
        },
        ...over
    };
    return { deps, steps, here: () => current };
};

const HERE: Whereabouts = { endpointId: 'local', projectId: 'p0' };

/* Runs the steps of a plan the way the switch does, with a signal nobody aborts unless the test passes one. */
const run = (plan: SwitchPlan, deps: SwitchDeps, controller = new AbortController(), opening: () => void = () => undefined) => {
    const handle = switchRun(plan, deps);
    return { handle, done: handle.steps({ signal: controller.signal, opening }) };
};

const folder = (endpointId: string, createFolder = false): SwitchPlan => ({ kind: 'folder', endpointId, folder: '/work/atlas', createFolder });

describe('opening a folder on the machine it is on', () => {
    test('from the start screen the machine is reached and the folder opens in a workspace', async () => {
        const { deps, steps } = spyDeps(null);
        await run(folder('local'), deps).done;
        expect(steps).toEqual(['ensure:local', 'enter:local:folder:/work/atlas:false']);
    });

    test('with a project open, that project is left before the next one is built', async () => {
        const { deps, steps } = spyDeps(HERE);
        await run(folder('daemon-b', true), deps).done;
        expect(steps).toEqual(['ensure:daemon-b', 'leave', 'enter:daemon-b:folder:/work/atlas:true']);
    });

    test('a machine only the account knows is opened under the row the connect made for it', async () => {
        const { deps, steps } = spyDeps(null, {
            ensure: async (endpointId) => {
                steps.push(`ensure:${endpointId}`);
                return 'attic-row';
            }
        });
        await run(folder('attic'), deps).done;
        expect(steps).toEqual(['ensure:attic', 'enter:attic-row:folder:/work/atlas:false']);
    });

    test('a machine that cannot be reached fails with its reason and leaves the open project alone', async () => {
        const { deps, steps } = spyDeps(HERE, {
            ensure: () => Promise.reject(new Error('No network path to the machine'))
        });
        await expect(run(folder('daemon-b'), deps).done).rejects.toThrow('No network path to the machine');
        expect(steps).toEqual([]);
    });
});

describe('opening a project', () => {
    test('the project step starts only once the machine answered', async () => {
        let resolveEnsure!: (id: string) => void;
        const { deps } = spyDeps(null, { ensure: () => new Promise((resolve) => (resolveEnsure = resolve)) });
        const phases: string[] = [];
        const { done } = run({ kind: 'project', endpointId: 'daemon-b', projectId: 'q1' }, deps, undefined, () => phases.push('opening'));
        await Promise.resolve();
        expect(phases).toEqual([]);
        resolveEnsure('daemon-b');
        await done;
        expect(phases).toEqual(['opening']);
    });

    test('the project that is already open moves nothing', async () => {
        const { deps, steps } = spyDeps(HERE);
        await run({ kind: 'project', endpointId: 'local', projectId: 'p0' }, deps).done;
        expect(steps).toEqual(['ensure:local']);
    });

    test('a new project is created in a workspace of its own', async () => {
        const { deps, steps } = spyDeps(HERE);
        await run({ kind: 'new', endpointId: 'local', name: 'Atlas' }, deps).done;
        expect(steps).toEqual(['ensure:local', 'leave', 'enter:local:new:Atlas']);
    });

    test('a run cancelled while connecting stops before anything moves, and going back undoes nothing', async () => {
        const controller = new AbortController();
        const { deps, steps } = spyDeps(HERE, {
            ensure: (_endpointId, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped'))))
        });
        const { handle, done } = run({ kind: 'project', endpointId: 'daemon-b', projectId: 'q1' }, deps, controller);
        controller.abort('back');
        await expect(done).rejects.toThrow('stopped');
        await handle.back();
        expect(steps).toEqual([]);
    });

    test('going back after the next project opened leaves it and builds the one before again', async () => {
        const { deps, steps, here } = spyDeps(HERE);
        const { handle, done } = run({ kind: 'project', endpointId: 'daemon-b', projectId: 'q1' }, deps);
        await done;
        steps.length = 0;
        await handle.back();
        expect(steps).toEqual(['leave', 'ensure:local', 'enter:local:project:p0']);
        expect(here()).toEqual(HERE);
    });

    test('a project that does not open after the old one was left comes back on the way back', async () => {
        const { deps, steps } = spyDeps(HERE, {
            enter: async (endpointId, request) => {
                steps.push(`enter:${endpointId}:${describeRequest(request)}`);
                if (endpointId === 'daemon-b') {
                    throw new Error('That project is gone');
                }
            }
        });
        const { handle, done } = run({ kind: 'project', endpointId: 'daemon-b', projectId: 'q1' }, deps);
        await expect(done).rejects.toThrow('That project is gone');
        steps.length = 0;
        await handle.back();
        expect(steps).toEqual(['ensure:local', 'enter:local:project:p0']);
    });

    test('a project that cannot come back leaves the start screen rather than a workspace without one', async () => {
        const { deps, steps } = spyDeps(HERE, {
            enter: () => Promise.reject(new Error('That machine is not answering'))
        });
        const { handle, done } = run({ kind: 'project', endpointId: 'daemon-b', projectId: 'q1' }, deps);
        await expect(done).rejects.toThrow('That machine is not answering');
        steps.length = 0;
        await handle.back();
        expect(steps).toEqual(['ensure:local', 'start']);
    });

    test('going back from a project opened on the start screen returns to the start screen', async () => {
        const { deps, steps } = spyDeps(null);
        const { handle, done } = run({ kind: 'project', endpointId: 'local', projectId: 'p1' }, deps);
        await done;
        steps.length = 0;
        await handle.back();
        expect(steps).toEqual(['leave', 'start']);
    });
});

describe('the cold start', () => {
    beforeEach(() => {
        useEndpoints.setState({ endpoints: [endpoint('local'), endpoint('daemon-b')], activeId: 'local' });
        useWindow.setState({ content: { kind: 'start' }, booting: true, bootFailure: null });
    });

    test('nothing remembered goes to the start screen at once', async () => {
        expect(await bootWindow(fakeStorage(new Map()))).toBeNull();
        expect(useWindow.getState().booting).toBe(false);
    });

    test('a machine that is no longer known goes to the start screen at once', async () => {
        expect(await bootWindow(fakeStorage(stored({ last: { endpointId: 'daemon-gone', projectId: 'q1' } })))).toBeNull();
        expect(useWindow.getState().booting).toBe(false);
    });

    test('a record from before there was a last says nothing about where the work was', async () => {
        expect(await bootWindow(fakeStorage(stored({ 'daemon-b': 'q1' })))).toBeNull();
        expect(useWindow.getState().booting).toBe(false);
    });

    test('the last project is opened, and the start screen waits until that settled', async () => {
        let finish!: (outcome: 'failed') => void;
        const opened: string[] = [];
        const booted = bootWindow(
            fakeStorage(stored({ last: { endpointId: 'daemon-b', projectId: 'q1' }, byEndpoint: { 'daemon-b': 'q1' } })),
            (endpointId, projectId) => {
                opened.push(`${endpointId}:${projectId}`);
                return new Promise((resolve) => (finish = resolve));
            }
        );
        expect(opened).toEqual(['daemon-b:q1']);
        expect(useWindow.getState().booting).toBe(true);
        finish('failed');
        expect(await booted).toBe('failed');
        expect(useWindow.getState().booting).toBe(false);
        // Kept for the start screen, which puts it on top of Recent with a way to try again.
        expect(useWindow.getState().bootFailure).toMatchObject({ endpointId: 'daemon-b', projectId: 'q1' });
    });

    test("the bare project id of the first versions was this machine's", async () => {
        const opened: string[] = [];
        await bootWindow(
            fakeStorage(new Map([['ruimte.lastProject', 'p7']])),
            async (endpointId, projectId) => {
                opened.push(`${endpointId}:${projectId}`);
                return 'done';
            },
            true
        );
        expect(opened).toEqual(['local:p7']);
    });
});

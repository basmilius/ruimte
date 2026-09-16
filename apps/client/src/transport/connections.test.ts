import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test';
import type { ProjectSummary, RequestMap, RequestType } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { useWindow, windowWorkspace } from '@/state/window';
import { defaultWorkspaceStores } from '@/state/workspace';
import { machineTransport, pool } from '@/transport';
import { dropMachine, enterWorkspace, leaveWorkspace, machineFor, showStart } from './connections';

// Past the pool's idle countdown, which is what closes a socket nobody holds.
const PAST_IDLE_MS = 31_000;

const other: Endpoint = {
    id: 'workspace-machine',
    label: 'Another machine',
    // Nothing listens on port 1, so every attempt fails at once and nothing leaves this process.
    httpBaseUrl: 'http://127.0.0.1:1',
    wsBaseUrl: 'ws://127.0.0.1:1',
    reachability: 'lan',
    token: null,
    daemonId: null,
    daemonPublicKey: null
};

const project: ProjectSummary = {
    projectId: 'project-1',
    name: 'Atlas',
    color: '#000',
    folder: '/work/atlas',
    lastOpenedAt: 0,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'A' },
    nameSource: 'chosen'
};

/* What a daemon answers a workspace with, so a project opens without a socket; `refuse` makes the open fail. */
const answer =
    (refuse: { open: boolean }) =>
    (type: RequestType): Promise<RequestMap[RequestType]['result']> => {
        if (type === 'project.open') {
            return refuse.open
                ? Promise.reject(new Error('That project is gone'))
                : Promise.resolve({
                      summary: project,
                      document: { version: 2, rev: 1, name: project.name, color: project.color, views: [] },
                      local: { activeViewId: null, views: {} }
                  } as unknown as RequestMap[RequestType]['result']);
        }
        if (type === 'project.list') {
            return Promise.resolve({ projects: [project] } as RequestMap[RequestType]['result']);
        }
        return Promise.resolve({} as RequestMap[RequestType]['result']);
    };

/* Counts what is subscribed and not yet let go of, by wrapping the method that hands out the unsubscribe. */
const countLive = <T extends object, K extends keyof T>(target: T, method: K): { live: () => number; restore: () => void } => {
    let live = 0;
    const original = (target[method] as (...args: unknown[]) => () => void).bind(target);
    const spy = spyOn(target, method).mockImplementation(((...args: unknown[]) => {
        const off = original(...args);
        live += 1;
        let released = false;
        return () => {
            if (!released) {
                released = true;
                live -= 1;
            }
            off();
        };
    }) as never);
    return { live: () => live, restore: () => spy.mockRestore() };
};

describe('a workspace and the link of its machine', () => {
    const refuse = { open: false };

    beforeEach(() => {
        jest.useFakeTimers();
        refuse.open = false;
        useEndpoints.getState().add(other);
        spyOn(machineTransport(other.id), 'request').mockImplementation(answer(refuse) as never);
    });

    afterEach(() => {
        showStart();
        (machineTransport(other.id).request as unknown as { mockRestore(): void }).mockRestore();
        // The session and chat clients the workspace built stay registered until the machine is dropped, and would outlive this file.
        dropMachine(other.id);
        pool.drop(other.id);
        useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
        useEndpoints.getState().remove(other.id);
        jest.useRealTimers();
    });

    test('a project that opens is on screen, and its machine stays connected while it is', async () => {
        await enterWorkspace(other.id, { projectId: project.projectId });
        expect(windowWorkspace()?.connection.endpointId).toBe(other.id);
        expect(useProject.getState().current?.projectId).toBe(project.projectId);
        expect(useEndpoints.getState().activeId).toBe(other.id);
        const link = pool.peek(other.id);
        expect(link).not.toBeNull();

        jest.advanceTimersByTime(PAST_IDLE_MS);
        expect(pool.peek(other.id)).toBe(link);
    });

    test('the start screen lets go of the machine after the grace period and empties the stores', async () => {
        await enterWorkspace(other.id, { projectId: project.projectId });
        showStart();
        expect(useWindow.getState().content.kind).toBe('start');
        expect(useProject.getState().current).toBeNull();
        expect(pool.peek(other.id)).not.toBeNull();
        jest.advanceTimersByTime(PAST_IDLE_MS);
        expect(pool.peek(other.id)).toBeNull();
    });

    test('a project that does not open leaves the window as it was and holds nothing', async () => {
        refuse.open = true;
        await expect(enterWorkspace(other.id, { projectId: project.projectId })).rejects.toThrow('That project is gone');
        expect(useWindow.getState().content.kind).toBe('start');
        jest.advanceTimersByTime(PAST_IDLE_MS);
        expect(pool.peek(other.id)).toBeNull();
    });

    test('a workspace that is left keeps the window until the next one is in, but no longer listens', async () => {
        // The sessions and the threads of the machine listen for as long as the machine is known, which is not the workspace's business.
        machineFor(other.id);
        const events = countLive(machineTransport(other.id), 'on');
        try {
            await enterWorkspace(other.id, { projectId: project.projectId });
            const shown = windowWorkspace();
            expect(events.live()).toBeGreaterThan(0);

            await leaveWorkspace();
            expect(windowWorkspace()).toBe(shown);
            expect(events.live()).toBe(0);
            expect(useProject.getState().switching).toBe(true);
        } finally {
            events.restore();
        }
    });

    test('opening and closing twenty times leaves no listener and no hold behind', async () => {
        machineFor(other.id);
        const target = machineTransport(other.id);
        const events = countLive(target, 'on');
        const statuses = countLive(target, 'subscribeStatus');
        const holds = countLive(pool, 'hold');
        const documents = countLive(defaultWorkspaceStores.document, 'subscribe');
        const projects = countLive(defaultWorkspaceStores.project, 'subscribe');
        const canvases = countLive(defaultWorkspaceStores.canvases, 'subscribe');
        const counts = (): number[] => [events.live(), statuses.live(), holds.live(), documents.live(), projects.live(), canvases.live()];
        try {
            const before = counts();
            await enterWorkspace(other.id, { projectId: project.projectId });
            const open = counts();
            expect(open.every((count, at) => count > before[at]!)).toBe(true);
            for (let i = 0; i < 20; i += 1) {
                showStart();
                await enterWorkspace(other.id, { projectId: project.projectId });
            }
            expect(counts()).toEqual(open);
            showStart();
            expect(counts()).toEqual(before);
        } finally {
            for (const counter of [events, statuses, holds, documents, projects, canvases]) {
                counter.restore();
            }
        }
    });
});

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { defaultWorkspaceStores } from '@/state/workspace';
import { pool } from '@/transport';
import { dropMachine, openWorkspace } from './connections';

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

/* The first workspace in a process is built on the module's own stores, which other test files write to as well. */
const resetDefaultProject = (): void => {
    defaultWorkspaceStores.project.getState().setSwitching(false);
    defaultWorkspaceStores.project.getState().setCurrent(null, 0, null);
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

describe('a workspace and the link of its machine', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        resetDefaultProject();
        useEndpoints.getState().add(other);
    });

    afterEach(() => {
        // The session and chat clients the workspace built stay registered until the machine is dropped, and would outlive this file.
        dropMachine(other.id);
        pool.drop(other.id);
        useEndpoints.getState().remove(other.id);
        resetDefaultProject();
        jest.useRealTimers();
    });

    test('a workspace with nothing open connects to nothing', () => {
        const workspace = openWorkspace('empty', other);
        expect(pool.peek(other.id)).toBeNull();
        workspace.dispose();
    });

    test('keeps its machine connected while a project is open, and lets go after the grace period once it closes', () => {
        const workspace = openWorkspace('side', other);
        workspace.stores.project.getState().setCurrent(project, 1, other.id);
        const link = pool.peek(other.id);
        expect(link).not.toBeNull();

        jest.advanceTimersByTime(PAST_IDLE_MS);
        expect(pool.peek(other.id)).toBe(link);

        workspace.stores.project.getState().setCurrent(null, 0, null);
        expect(pool.peek(other.id)).toBe(link);
        jest.advanceTimersByTime(PAST_IDLE_MS);
        expect(pool.peek(other.id)).toBeNull();
        workspace.dispose();
    });

    test('a project on its way in holds the link as well, and closing the workspace lets it go', () => {
        const workspace = openWorkspace('opening', other);
        workspace.stores.project.getState().setSwitching(true);
        expect(pool.peek(other.id)).not.toBeNull();

        workspace.dispose();
        jest.advanceTimersByTime(PAST_IDLE_MS);
        expect(pool.peek(other.id)).toBeNull();
    });

    test('the clients of a workspace stay on the same transport while the link comes and goes', () => {
        const workspace = openWorkspace('steady', other);
        const transport = workspace.connection.transport;
        workspace.stores.project.getState().setSwitching(true);
        workspace.stores.project.getState().setSwitching(false);
        jest.advanceTimersByTime(PAST_IDLE_MS);
        expect(pool.peek(other.id)).toBeNull();
        expect(workspace.connection.transport).toBe(transport);
        expect(transport.status).toBe('closed');
        workspace.dispose();
    });
});

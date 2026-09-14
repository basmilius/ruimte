import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
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

describe('a workspace on a machine that is not the active one', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        useEndpoints.getState().add(other);
    });

    afterEach(() => {
        // The session and chat clients the workspace built stay registered until the machine is dropped, and would outlive this file.
        dropMachine(other.id);
        pool.drop(other.id);
        useEndpoints.getState().remove(other.id);
        jest.useRealTimers();
    });

    test('keeps the socket it was built on for as long as it is open, and lets go of it when it goes', () => {
        const workspace = openWorkspace('side', other);
        const socket = workspace.connection.transport;

        jest.advanceTimersByTime(PAST_IDLE_MS);
        // A socket the pool closed under a workspace is never replaced there, so its project client would be talking to nothing.
        expect(pool.peek(other.id)).toBe(socket);

        workspace.dispose();
        jest.advanceTimersByTime(PAST_IDLE_MS);
        expect(pool.peek(other.id)).toBeNull();
    });
});

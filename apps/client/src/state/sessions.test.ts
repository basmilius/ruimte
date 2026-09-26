import { beforeEach, describe, expect, test } from 'bun:test';
import type { CanvasNode } from '@/state/canvas';
import { useChats } from '@ruimte/agents-react/state/chats';
import { chatSinkFor } from '@/state/chats';
import { endpointKey, isOfEndpoint } from '@/state/keys';
import { nodeStatus, sessionSinkFor, useSessions } from '@/state/sessions';

const LOCAL = 'local';
const REMOTE = 'Xk3p';

const node = (id: string, kind: CanvasNode['kind']): Pick<CanvasNode, 'id' | 'kind' | 'status'> => ({ id, kind, status: undefined });

beforeEach(() => {
    useSessions.setState({ byKey: {}, restarts: {} });
    useChats.setState({ byKey: {} });
});

describe('two machines with a node of the same id', () => {
    test('keep a row each', () => {
        sessionSinkFor(LOCAL).setAttached('t1', true);
        sessionSinkFor(REMOTE).setExited('t1', 3);
        expect(useSessions.getState().byKey[endpointKey(LOCAL, 't1')]).toEqual({ attached: true });
        expect(useSessions.getState().byKey[endpointKey(REMOTE, 't1')]).toEqual({ attached: false, exited: 3 });
    });

    test('report the status of the machine that is asked about', () => {
        sessionSinkFor(LOCAL).setAttached('t1', true);
        sessionSinkFor(REMOTE).setExited('t1', 1);
        const terminal = node('t1', 'terminal');
        const sessions = useSessions.getState().byKey;
        expect(nodeStatus(terminal, sessions, {}, LOCAL)).toBe('running');
        expect(nodeStatus(terminal, sessions, {}, REMOTE)).toBe('error');
    });

    test('say nothing about a machine that was never asked', () => {
        sessionSinkFor(LOCAL).setAttached('t1', true);
        expect(nodeStatus(node('t1', 'terminal'), useSessions.getState().byKey, {}, 'other')).toBeUndefined();
    });
});

describe('clearing one machine', () => {
    test('leaves the other machine running', () => {
        sessionSinkFor(LOCAL).setAttached('t1', true);
        sessionSinkFor(REMOTE).setAttached('t2', true);
        useSessions.getState().clear(LOCAL);
        expect(Object.keys(useSessions.getState().byKey)).toEqual([endpointKey(REMOTE, 't2')]);
    });

    test('does the same for the threads', () => {
        const info = { chatId: 'c1', provider: 'claude', cwd: '/work', status: 'idle', activeTurnId: null } as never;
        chatSinkFor(LOCAL).reset('c1', info, []);
        chatSinkFor(REMOTE).reset('c1', info, []);
        useChats.getState().forgetWhere((key) => isOfEndpoint(key, REMOTE));
        expect(Object.keys(useChats.getState().byKey)).toEqual([endpointKey(LOCAL, 'c1')]);
    });
});

describe('forgetting one node', () => {
    test('takes only the row of the machine it ran on', () => {
        sessionSinkFor(LOCAL).setAttached('t1', true);
        sessionSinkFor(REMOTE).setAttached('t1', true);
        sessionSinkFor(REMOTE).forget('t1');
        expect(Object.keys(useSessions.getState().byKey)).toEqual([endpointKey(LOCAL, 't1')]);
    });

    test('never resurrects a node nobody tracks', () => {
        sessionSinkFor(LOCAL).setAttached('t1', false);
        expect(useSessions.getState().byKey).toEqual({});
    });
});

describe('restarts', () => {
    test('count up per terminal and machine, and outlive the row a kill forgets and a machine that is dropped', () => {
        const key = endpointKey(LOCAL, 't1');
        sessionSinkFor(LOCAL).setExited('t1', 0);
        useSessions.getState().restart(key);
        sessionSinkFor(LOCAL).forget('t1');
        useSessions.getState().restart(key);
        useSessions.getState().clear(LOCAL);
        expect(useSessions.getState().restarts[key]).toBe(2);
        expect(useSessions.getState().restarts[endpointKey(REMOTE, 't1')]).toBeUndefined();
    });
});

import { describe, expect, test } from 'bun:test';
import type { ComputerUseStatus } from '@ruimte/contracts';
import { indicatorLook, nodeSessionMode } from './indicator';

const status = (session: ComputerUseStatus['session']): ComputerUseStatus => ({
    enabled: true,
    present: true,
    running: true,
    accessibility: true,
    screenRecording: true,
    session
});

describe('the indicator of computer use on a node', () => {
    test('shows only on the node whose agent holds the session', () => {
        expect(nodeSessionMode(status({ mode: 'running', nodeId: 'chat-1' }), 'chat-1')).toBe('running');
        expect(nodeSessionMode(status({ mode: 'running', nodeId: 'chat-1' }), 'chat-2')).toBeNull();
        expect(nodeSessionMode(status({ mode: 'paused', nodeId: null }), 'chat-1')).toBeNull();
        expect(nodeSessionMode(status(null), 'chat-1')).toBeNull();
        expect(nodeSessionMode(status(undefined), 'chat-1')).toBeNull();
        expect(nodeSessionMode(undefined, 'chat-1')).toBeNull();
    });

    test('is the accent while the agent acts, and offers pause and stop', () => {
        expect(indicatorLook('running')).toEqual({ tone: 'accent', label: 'Operating this Mac', actions: ['pause', 'stop'] });
    });

    test('is muted while the person holds the Mac, and offers resume and stop', () => {
        expect(indicatorLook('paused')).toEqual({ tone: 'muted', label: 'Paused', actions: ['resume', 'stop'] });
        expect(indicatorLook('takenOver')).toEqual({ tone: 'muted', label: 'You have control', actions: ['resume', 'stop'] });
    });
});

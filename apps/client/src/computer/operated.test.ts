import { describe, expect, test } from 'bun:test';
import type { ComputerUseStatus } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { operatedHere } from './operated';

const status = (session: ComputerUseStatus['session']): ComputerUseStatus => ({
    enabled: true,
    present: true,
    running: true,
    accessibility: true,
    screenRecording: true,
    session
});

describe('a window an agent operates', () => {
    test('is the desktop window on its own machine while the machine says an agent operates Ruimte', () => {
        expect(operatedHere(LOCAL_ENDPOINT_ID, status({ mode: 'running', nodeId: 'chat-1', operatingRuimte: true }), true)).toBe(true);
    });

    test('decides again once the person paused or took over, or the agent works in another app', () => {
        expect(operatedHere(LOCAL_ENDPOINT_ID, status({ mode: 'takenOver', nodeId: 'chat-1' }), true)).toBe(false);
        expect(operatedHere(LOCAL_ENDPOINT_ID, status({ mode: 'running', nodeId: 'chat-1' }), true)).toBe(false);
        expect(operatedHere(LOCAL_ENDPOINT_ID, status(null), true)).toBe(false);
        expect(operatedHere(LOCAL_ENDPOINT_ID, undefined, true)).toBe(false);
    });

    test('is never a window on another device, which reaches the machine paired', () => {
        const operating = status({ mode: 'running', nodeId: 'chat-1', operatingRuimte: true });
        expect(operatedHere('machine-2', operating, true)).toBe(false);
        expect(operatedHere(LOCAL_ENDPOINT_ID, operating, false)).toBe(false);
    });
});

import { describe, expect, test } from 'bun:test';
import type { BackgroundServiceState } from '@/desktop/bridge';
import { machineUpdateAnswer, machineUpdatePrompt, pendingRestartLine } from './machine-update';

const BRIDGE = { restartNow: async () => STATE, restartWhenIdle: async () => STATE };

const STATE: BackgroundServiceState = { support: 'supported', keepRunning: true, owner: 'service', failure: null, linger: null, pendingRestart: null };

const pending = (work: number | null, answered = false): BackgroundServiceState => ({ ...STATE, pendingRestart: { work, answered } });

describe('machineUpdatePrompt', () => {
    test('says how much a restart ends', () => {
        expect(machineUpdatePrompt(pending(3), BRIDGE)).toEqual({
            title: 'Ruimte was updated',
            description: 'Restart this machine now? This ends 3 running terminals and agents.'
        });
        expect(machineUpdatePrompt(pending(1), BRIDGE)?.description).toBe('Restart this machine now? This ends 1 running terminal or agent.');
    });

    test('still asks when the machine cannot say what runs', () => {
        expect(machineUpdatePrompt(pending(null), BRIDGE)?.description).toBe('Restart this machine now? This ends the terminals and agents running on it.');
    });

    test('asks nothing without a pending restart, once answered, or on a shell that cannot restart', () => {
        expect(machineUpdatePrompt(STATE, BRIDGE)).toBeNull();
        expect(machineUpdatePrompt(null, BRIDGE)).toBeNull();
        expect(machineUpdatePrompt(pending(2, true), BRIDGE)).toBeNull();
        expect(machineUpdatePrompt(pending(2), {})).toBeNull();
    });
});

describe('machineUpdateAnswer', () => {
    test('only the restart button restarts; everything else waits for idle', () => {
        expect(machineUpdateAnswer('restart')).toBe('restart-now');
        expect(machineUpdateAnswer('idle')).toBe('when-idle');
        expect(machineUpdateAnswer('dismiss')).toBe('when-idle');
    });
});

test('the settings line stands while the older build runs', () => {
    expect(pendingRestartLine(pending(2, true))).not.toBeNull();
    expect(pendingRestartLine(STATE)).toBeNull();
});

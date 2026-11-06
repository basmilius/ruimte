import { afterEach, describe, expect, test } from 'bun:test';
import type { BackgroundServiceState } from '@/desktop/bridge';
import {
    askMachineUpdateAgain,
    machineUpdateAnswer,
    machineUpdatePrompt,
    pendingRestartLine,
    showsPendingRestart,
    useMachineUpdateAgain
} from './machine-update';

const BRIDGE = { restartNow: async () => STATE, restartWhenIdle: async () => STATE };

const STATE: BackgroundServiceState = { support: 'supported', keepRunning: true, owner: 'service', failure: null, linger: null, pendingRestart: null };

function pending(work: number | null, answered = false): BackgroundServiceState {
    return { ...STATE, pendingRestart: { work, answered } };
}

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

describe('the question asked again', () => {
    afterEach(() => {
        useMachineUpdateAgain.setState({ again: null });
    });

    test('asks once answered, with the count of now rather than the one from the start', () => {
        expect(machineUpdatePrompt(pending(2, true), BRIDGE, { work: 5 })?.description).toBe(
            'Restart this machine now? This ends 5 running terminals and agents.'
        );
        expect(machineUpdatePrompt(pending(2, true), BRIDGE, { work: null })?.description).toBe(
            'Restart this machine now? This ends the terminals and agents running on it.'
        );
    });

    test('asks nothing once the restart is no longer pending', () => {
        expect(machineUpdatePrompt(STATE, BRIDGE, { work: 1 })).toBeNull();
    });

    test('counts what runs on the machine when it is asked', async () => {
        await askMachineUpdateAgain(async () => ({ work: { terminals: 2, agents: 1 }, home: '~/.ruimte', commandLine: false }));
        expect(useMachineUpdateAgain.getState().again).toEqual({ work: 3 });
    });

    test('says nothing about the count when the machine cannot say or the shell cannot ask', async () => {
        await askMachineUpdateAgain(async () => {
            throw new Error('gone');
        });
        expect(useMachineUpdateAgain.getState().again).toEqual({ work: null });
        await askMachineUpdateAgain(undefined);
        expect(useMachineUpdateAgain.getState().again).toEqual({ work: null });
    });
});

describe('showsPendingRestart', () => {
    test('marks the rail only after "When idle", on a shell that can restart', () => {
        expect(showsPendingRestart(pending(2, true), BRIDGE)).toBe(true);
        expect(showsPendingRestart(pending(2), BRIDGE)).toBe(false);
        expect(showsPendingRestart(STATE, BRIDGE)).toBe(false);
        expect(showsPendingRestart(null, BRIDGE)).toBe(false);
        expect(showsPendingRestart(pending(2, true), {})).toBe(false);
    });
});

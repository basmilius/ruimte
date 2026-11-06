import { describe, expect, test } from 'bun:test';
import type { BackgroundServiceState } from '@/desktop/bridge';
import { backgroundServiceRow, stopRunningLines } from './background-service';

function state(patch: Partial<BackgroundServiceState> = {}): BackgroundServiceState {
    return {
        support: 'supported',
        keepRunning: true,
        owner: 'service',
        failure: null,
        linger: null,
        ...patch
    };
}

describe('backgroundServiceRow', () => {
    test('the service runs the machine: a switch that is on and a way to stop it', () => {
        expect(backgroundServiceRow(state())).toMatchObject({ toggle: { checked: true }, pending: null, canStop: true, unavailable: null });
    });

    test('switched on while the app runs its own daemon: the service takes over at quit', () => {
        const row = backgroundServiceRow(state({ owner: 'app' }));
        expect(row.pending).toContain('next time Ruimte quits');
        expect(row.canStop).toBe(false);
    });

    test('switched off while the service runs: it stops at quit', () => {
        expect(backgroundServiceRow(state({ keepRunning: false })).pending).toBe('This machine stops when Ruimte quits.');
    });

    test('no switch in the dev app, on Windows or for an AppImage, each with its reason', () => {
        const reasons = {
            dev: 'The dev app always runs a machine of its own and stops it when it quits.',
            windows: 'Not available on Windows yet, so this machine stops when Ruimte quits.',
            appimage: 'Not available in the AppImage. Install the deb or rpm package to keep this machine running.'
        };
        for (const support of ['dev', 'windows', 'appimage'] as const) {
            const row = backgroundServiceRow(state({ support, keepRunning: false, owner: 'app' }));
            expect(row.toggle).toBeNull();
            expect(row.unavailable).toBe(reasons[support]);
            expect(row.canStop).toBe(false);
        }
    });

    test('a service the command line installed is named, without a switch that would take it over', () => {
        const row = backgroundServiceRow(state({ keepRunning: false, owner: 'external', commandLineService: true }));
        expect(row.toggle).toBeNull();
        expect(row.unavailable).toContain('npx ruimte service');
        expect(row.canStop).toBe(false);
    });

    test('lingering is offered on Linux only while the switch is on and it is not enabled yet', () => {
        expect(backgroundServiceRow(state({ linger: false })).offerLinger).toBe(true);
        expect(backgroundServiceRow(state({ linger: true })).offerLinger).toBe(false);
        expect(backgroundServiceRow(state({ linger: null })).offerLinger).toBe(false);
        expect(backgroundServiceRow(state({ linger: false, keepRunning: false })).offerLinger).toBe(false);
    });
});

describe('stopRunningLines', () => {
    const home = '~/.ruimte';
    const DATA =
        'Ruimte restarts and only connects to your machines. Your projects, chats and worktrees stay in ~/.ruimte and come back when you run a machine here again.';

    test('says it is checking until the machine answered', () => {
        expect(stopRunningLines(null)).toEqual(['Checking what is running…']);
    });

    test('names nothing when the machine cannot say what runs, and still says where the data stays', () => {
        expect(stopRunningLines({ work: null, home, commandLine: false })).toEqual([DATA]);
    });

    test('names no path when the machine could not say where its data is', () => {
        const lines = stopRunningLines({ work: null, home: '', commandLine: false });
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('stay on this computer');
        expect(lines[0]).not.toContain('~');
    });

    test('says that nothing runs', () => {
        expect(stopRunningLines({ work: { agents: 0, terminals: 0 }, home, commandLine: false })).toEqual(['No agents or terminals are running.', DATA]);
    });

    test('counts an agent, or terminals, alone', () => {
        expect(stopRunningLines({ work: { agents: 1, terminals: 0 }, home, commandLine: false })[0]).toBe('An agent ends now.');
        expect(stopRunningLines({ work: { agents: 0, terminals: 3 }, home, commandLine: false })[0]).toBe('3 terminals end now.');
    });

    test('joins agents and terminals in one sentence that starts with a capital', () => {
        expect(stopRunningLines({ work: { agents: 2, terminals: 3 }, home, commandLine: false })[0]).toBe('2 agents and 3 terminals end now.');
        expect(stopRunningLines({ work: { agents: 1, terminals: 1 }, home, commandLine: false })[0]).toBe('An agent and a terminal end now.');
    });

    test('a machine from the command line keeps running, and that is all the question says', () => {
        expect(stopRunningLines({ work: { agents: 2, terminals: 0 }, home, commandLine: true })).toEqual([
            'You set up this machine from the command line, so it keeps running. Ruimte restarts without it.'
        ]);
    });
});

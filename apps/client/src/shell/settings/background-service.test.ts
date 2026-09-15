import { describe, expect, test } from 'bun:test';
import type { BackgroundServiceState } from '@/desktop/bridge';
import { backgroundServiceRow } from './background-service';

const state = (patch: Partial<BackgroundServiceState> = {}): BackgroundServiceState => ({
    support: 'supported',
    keepRunning: true,
    owner: 'service',
    failure: null,
    linger: null,
    ...patch
});

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
        expect(backgroundServiceRow(state({ keepRunning: false })).pending).toContain('stops when Ruimte quits');
    });

    test('no switch in the dev app, on Windows or for an AppImage, each with its reason', () => {
        for (const support of ['dev', 'windows', 'appimage'] as const) {
            const row = backgroundServiceRow(state({ support, keepRunning: false, owner: 'app' }));
            expect(row.toggle).toBeNull();
            expect(row.unavailable).not.toBeNull();
            expect(row.canStop).toBe(false);
        }
    });

    test('lingering is offered on Linux only while the switch is on and it is not enabled yet', () => {
        expect(backgroundServiceRow(state({ linger: false })).offerLinger).toBe(true);
        expect(backgroundServiceRow(state({ linger: true })).offerLinger).toBe(false);
        expect(backgroundServiceRow(state({ linger: null })).offerLinger).toBe(false);
        expect(backgroundServiceRow(state({ linger: false, keepRunning: false })).offerLinger).toBe(false);
    });
});

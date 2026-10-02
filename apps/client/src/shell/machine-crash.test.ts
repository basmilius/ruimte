import { describe, expect, test } from 'bun:test';
import { machineCrashToast } from './machine-crash';

describe('machineCrashToast', () => {
    test('says once that the machine stopped and starts again', () => {
        expect(machineCrashToast(null, { total: 1, restarting: true })).toEqual({
            id: 'machine-crash',
            kind: 'error',
            title: 'This machine stopped unexpectedly',
            description: 'Ruimte starts it again. What was running on it has ended.',
            persist: false
        });
        expect(machineCrashToast({ total: 1, restarting: true }, { total: 1, restarting: true })).toBeNull();
        expect(machineCrashToast({ total: 1, restarting: true }, { total: 2, restarting: true })).not.toBeNull();
    });

    test('stays up once the app gave up on it', () => {
        const toast = machineCrashToast({ total: 5, restarting: true }, { total: 6, restarting: false });
        expect(toast?.description).toContain('no longer starts it');
        expect(toast?.persist).toBe(true);
    });

    test('nothing while the machine never ended', () => {
        expect(machineCrashToast(null, null)).toBeNull();
    });
});

import { afterEach, describe, expect, test } from 'bun:test';
import type { DesktopBridge } from '@/desktop/bridge';
import { machineBridge } from '../../testing/machine-bridge';
import { hasLocalMachine, isRealMachine, listedEndpoints, startScreenMachine } from './local-machine';

const rows = [{ id: 'local' }, { id: 'studio' }, { id: 'attic' }];

describe('the machine that served the page', () => {
    test('is listed with the rest where it is a machine', () => {
        expect(listedEndpoints(rows, true).map((row) => row.id)).toEqual(['local', 'studio', 'attic']);
    });

    test('is left out of every list on the web client, the other rows keeping their order', () => {
        expect(listedEndpoints(rows, false).map((row) => row.id)).toEqual(['studio', 'attic']);
    });

    test('never counts as a picked machine on the web client', () => {
        expect(isRealMachine('local', false)).toBe(false);
        expect(isRealMachine('studio', false)).toBe(true);
        expect(isRealMachine('local', true)).toBe(true);
    });
});

describe('the start screen', () => {
    test('keeps a link to this machine on the desktop, so its projects do not read as not connected', () => {
        expect(startScreenMachine(rows, true)).toEqual({ id: 'local' });
    });

    test('keeps no link on the web client, and none to another machine', () => {
        expect(startScreenMachine(rows, false)).toBeNull();
        expect(startScreenMachine([{ id: 'studio' }], true)).toBeNull();
    });
});

describe('hasLocalMachine', () => {
    const scope = globalThis as unknown as { window?: { ruimteDesktop?: Partial<DesktopBridge> } };

    afterEach(() => {
        delete scope.window;
    });

    test('is false without a desktop bridge', () => {
        expect(hasLocalMachine()).toBe(false);
    });

    test('is true for a shell from before the mode, which ran a machine', () => {
        scope.window = { ruimteDesktop: { platform: 'darwin' } };
        expect(hasLocalMachine()).toBe(true);
    });

    test('follows the mode the shell names', () => {
        scope.window = { ruimteDesktop: { platform: 'darwin', machine: machineBridge('local') } };
        expect(hasLocalMachine()).toBe(true);
        scope.window = { ruimteDesktop: { platform: 'darwin', machine: machineBridge('none') } };
        expect(hasLocalMachine()).toBe(false);
        scope.window = { ruimteDesktop: { platform: 'darwin', machine: machineBridge('ask') } };
        expect(hasLocalMachine()).toBe(false);
    });
});

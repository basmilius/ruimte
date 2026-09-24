import { describe, expect, test } from 'bun:test';
import type { ComputerUseStatus } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { canSwitch, computerSetupOf, opensSystemSettings, recheckOf, showsGrants } from './setup';

const status = (patch: Partial<ComputerUseStatus> = {}): ComputerUseStatus => ({
    enabled: true,
    present: true,
    running: true,
    accessibility: true,
    screenRecording: true,
    ...patch
});

describe('the setup of computer use', () => {
    test('a machine that is no Mac is macOS only, whatever it answered', () => {
        expect(computerSetupOf(status({ present: false }), 'linux').phase).toBe('unsupported');
        expect(computerSetupOf(null, 'linux').phase).toBe('unsupported');
        expect(canSwitch(computerSetupOf(null, 'linux'))).toBe(false);
    });

    test('waits for an answer, and names a Mac without the helper', () => {
        expect(computerSetupOf(null, 'darwin').phase).toBe('unknown');
        expect(computerSetupOf(null, null).phase).toBe('unknown');
        expect(computerSetupOf(status({ present: false, enabled: false }), 'darwin').phase).toBe('unavailable');
    });

    test('off until a person turns it on, with no grants shown', () => {
        const setup = computerSetupOf(status({ enabled: false, running: false, accessibility: null, screenRecording: null }), 'darwin');
        expect(setup.phase).toBe('off');
        expect(canSwitch(setup)).toBe(true);
        expect(showsGrants(setup)).toBe(false);
    });

    test('on, it starts, then asks for what is missing, then is ready', () => {
        expect(computerSetupOf(status({ accessibility: null, screenRecording: null }), 'darwin').phase).toBe('starting');
        const missing = computerSetupOf(status({ accessibility: true, screenRecording: false }), 'darwin');
        expect(missing).toEqual({ phase: 'grants', accessibility: 'granted', screenRecording: 'missing' });
        expect(showsGrants(missing)).toBe(true);
        expect(computerSetupOf(status(), 'darwin')).toEqual({ phase: 'ready', accessibility: 'granted', screenRecording: 'granted' });
    });

    test('coming back restarts the helper only while Screen Recording is missing', () => {
        expect(recheckOf(computerSetupOf(status({ screenRecording: false }), 'darwin'))).toBe('restart');
        expect(recheckOf(computerSetupOf(status({ accessibility: false }), 'darwin'))).toBe('status');
        expect(recheckOf(computerSetupOf(status(), 'darwin'))).toBeNull();
        expect(recheckOf(computerSetupOf(status({ enabled: false }), 'darwin'))).toBeNull();
    });

    test('opens System Settings only for this Mac, through a shell that can', () => {
        expect(opensSystemSettings(LOCAL_ENDPOINT_ID, 'darwin', true)).toBe(true);
        expect(opensSystemSettings(LOCAL_ENDPOINT_ID, 'darwin', false)).toBe(false);
        expect(opensSystemSettings('studio-mac', 'darwin', true)).toBe(false);
        expect(opensSystemSettings(LOCAL_ENDPOINT_ID, 'linux', true)).toBe(false);
    });
});

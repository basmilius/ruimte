import { describe, expect, test } from 'bun:test';
import { debugFrom, describeError, isAddressInUse, portInUseMessage, runningMachineFrom } from './fatal.ts';

describe('describeError', () => {
    test('prints the message only', () => {
        expect(describeError(new Error('Unknown command: serv'), false)).toBe('Unknown command: serv');
    });

    test('prints the stack with the debug variable', () => {
        const error = new Error('boom');
        error.stack = 'Error: boom\n    at main (/$bunfs/root/ruimte:1:1)';
        expect(describeError(error, true)).toBe(error.stack);
    });

    test('falls back to the name when there is no message', () => {
        expect(describeError(new TypeError(''), false)).toBe('TypeError');
    });

    test('prints what was thrown when it is no error', () => {
        expect(describeError('a string', false)).toBe('a string');
        expect(describeError(42, true)).toBe('42');
    });
});

describe('debugFrom', () => {
    test('only 1 turns it on', () => {
        expect(debugFrom({ RUIMTE_DEBUG: '1' })).toBe(true);
        expect(debugFrom({ RUIMTE_DEBUG: '0' })).toBe(false);
        expect(debugFrom({})).toBe(false);
    });
});

describe('isAddressInUse', () => {
    test('reads the code Bun puts on a failed listen', () => {
        expect(isAddressInUse(Object.assign(new Error('Failed to start server. Is port 4210 in use?'), { code: 'EADDRINUSE' }))).toBe(true);
        expect(isAddressInUse(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe(false);
        expect(isAddressInUse(null)).toBe(false);
    });
});

describe('runningMachineFrom', () => {
    test('reads a health answer', () => {
        expect(runningMachineFrom({ ok: true, version: '0.4.0', build: 'x', service: true })).toEqual({ version: '0.4.0', service: true });
    });

    test('an older machine does not say whether it is the service', () => {
        expect(runningMachineFrom({ ok: true, version: '0.3.0' })).toEqual({ version: '0.3.0', service: null });
    });

    test('anything else is no Ruimte', () => {
        expect(runningMachineFrom({ status: 'up' })).toBeNull();
        expect(runningMachineFrom('ok')).toBeNull();
        expect(runningMachineFrom(null)).toBeNull();
    });
});

describe('portInUseMessage', () => {
    test('another program', () => {
        expect(portInUseMessage(4210, null)).toBe('Port 4210 is in use by another program. Stop that program, or start Ruimte on a free port with --port.');
    });

    test('the background service', () => {
        const message = portInUseMessage(4210, { version: '0.4.0', service: true });
        expect(message).toStartWith('A Ruimte machine is already running on port 4210 (version 0.4.0, as the background service).\n');
        expect(message).toContain('`ruimte service status` checks on it');
        expect(message).toContain('`ruimte login` puts it on your account');
    });

    test('a machine started by hand does not point at the service', () => {
        const message = portInUseMessage(4210, { version: '0.4.0', service: false });
        expect(message).toStartWith('A Ruimte machine is already running on port 4210 (version 0.4.0).\n');
        expect(message).not.toContain('service status');
    });

    test('another port rides along with every command', () => {
        const message = portInUseMessage(4290, { version: '0.4.0', service: true });
        expect(message).toContain('`ruimte service status --port 4290`');
        expect(message).toContain('`ruimte login --port 4290`');
        expect(message).toContain('`ruimte pair --port 4290`');
    });

    test('never an en dash or an em dash', () => {
        for (const message of [portInUseMessage(4210, null), portInUseMessage(4290, { version: '1', service: true })]) {
            expect(message).not.toMatch(/[–—]/);
        }
    });
});

import { describe, expect, test } from 'bun:test';
import { debugFrom, describeError } from './error-text.ts';

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

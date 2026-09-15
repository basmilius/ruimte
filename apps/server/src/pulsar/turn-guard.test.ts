import { describe, expect, test } from 'bun:test';
import { guardWeriftTurn, isWeriftTransactionFailure } from './turn-guard.ts';

/* The shape of werift's `TransactionTimeout` after a minified build: no message, no telling class name, only `str`. */
class Minified extends Error {
    get str(): string {
        return 'STUN transaction timed out';
    }
}

class FailedWithoutResponse extends Error {
    get str(): string {
        throw new TypeError('response is undefined');
    }
}

describe('the werift TURN guard', () => {
    test('recognizes a werift transaction error by its description or its stack, and nothing else', () => {
        expect(isWeriftTransactionFailure(new Minified())).toBe(true);
        const fromStack = new Error('exist');
        fromStack.stack = 'Error: exist\n    at request (/opt/ruimte/node_modules/werift/lib/ice/src/turn/protocol.js:111:19)';
        expect(isWeriftTransactionFailure(fromStack)).toBe(true);
        expect(isWeriftTransactionFailure(new FailedWithoutResponse())).toBe(false);
        expect(isWeriftTransactionFailure(new Error('ENOENT'))).toBe(false);
        expect(isWeriftTransactionFailure('STUN transaction timed out')).toBe(false);
        expect(isWeriftTransactionFailure(null)).toBe(false);
    });

    test('logs a TURN failure and carries on, and crashes on anything else as before', () => {
        const listeners = new Map<string, (error: unknown) => void>();
        const warned: unknown[] = [];
        const exits: number[] = [];
        guardWeriftTurn(
            { on: (event, listener) => listeners.set(event, listener) },
            { warn: (...parts: unknown[]) => warned.push(parts), error: () => undefined },
            (code) => exits.push(code)
        );
        listeners.get('unhandledRejection')!(new Minified());
        listeners.get('uncaughtException')!(new Minified());
        expect(warned).toHaveLength(2);
        expect(exits).toEqual([]);

        listeners.get('unhandledRejection')!(new Error('a bug'));
        listeners.get('uncaughtException')!(new TypeError('another'));
        expect(exits).toEqual([1, 1]);
    });
});

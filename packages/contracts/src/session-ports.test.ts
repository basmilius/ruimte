import { expect, test } from 'bun:test';
import { REQUEST_SCHEMAS } from './index.ts';

test('session ports distinguish unknown from a known empty result', () => {
    const schema = REQUEST_SCHEMAS['session.ports'].result;
    for (const value of [{ status: 'ready', ports: [] }, { status: 'unknown' }, { status: 'unavailable' }, { status: 'closed' }]) {
        expect(schema.safeParse(value).success).toBe(true);
    }
    expect(schema.safeParse({ status: 'ready' }).success).toBe(false);
});

test('ownership additions remain optional on the wire, with bounded verification validity when present', () => {
    const result = REQUEST_SCHEMAS['session.verifyPort'].result;
    expect(result.parse({ url: 'http://127.0.0.1:5173/' })).toEqual({ url: 'http://127.0.0.1:5173/' });
    const verified = { url: 'http://127.0.0.1:5173/', machineId: 'owner', validForMs: 5000 };
    expect(result.parse(verified)).toEqual(verified);
    for (const validForMs of [0, -1, 5001]) {
        expect(result.safeParse({ ...verified, validForMs }).success).toBe(false);
    }
    const listener = { pid: 12, startTime: 1234, port: 5173, host: '127.0.0.1' as const, bindAddress: '*' };
    expect(REQUEST_SCHEMAS['session.ports'].result.parse({ status: 'ready', ports: [listener] })).toEqual({ status: 'ready', ports: [listener] });
});

test('port verification accepts only complete process identities and loopback targets', () => {
    const schema = REQUEST_SCHEMAS['session.verifyPort'].payload;
    const listener = { pid: 12, startTime: 1234, port: 5173, host: '127.0.0.1' };
    expect(schema.safeParse({ sessionId: 'one', listener }).success).toBe(true);
    for (const patch of [{ pid: 0 }, { startTime: 0 }, { port: 0 }, { port: 65536 }, { port: 12.5 }, { host: 'example.com' }, { host: '127.0.0.1/path' }]) {
        expect(schema.safeParse({ sessionId: 'one', listener: { ...listener, ...patch } }).success).toBe(false);
    }
});

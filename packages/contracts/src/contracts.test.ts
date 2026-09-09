import { describe, expect, test } from 'bun:test';
import {
    EVENT_SCHEMAS,
    EventSchema,
    REQUEST_SCHEMAS,
    ReplySchema,
    RequestSchema,
    ServerFrameSchema,
    SessionInfoSchema,
    isEventType,
    isRequestType,
    parseRequest,
    parseServerFrame
} from './index.ts';

const info = {
    sessionId: 'node-1',
    cwd: '/home/bas',
    pid: 4242,
    cols: 80,
    rows: 24,
    createdAt: 1_700_000_000_000,
    attached: 1,
    exited: false
};

describe('envelope', () => {
    test('accepts a request and rejects one without a type', () => {
        expect(RequestSchema.safeParse({ id: 'r1', type: 'server.hello', payload: {} }).success).toBe(true);
        expect(RequestSchema.safeParse({ id: 'r1', payload: {} }).success).toBe(false);
    });

    test('accepts both reply shapes and rejects a mixed one', () => {
        expect(ReplySchema.safeParse({ id: 'r1', ok: true, result: { a: 1 } }).success).toBe(true);
        expect(ReplySchema.safeParse({ id: null, ok: false, error: { code: 'bad-request', message: 'x' } }).success).toBe(true);
        expect(ReplySchema.safeParse({ id: 'r1', ok: true, error: { code: 'x', message: '' } }).success).toBe(false);
    });

    test('accepts an event and rejects a frame that is neither reply nor event', () => {
        expect(EventSchema.safeParse({ type: 'event', event: 'session.exit', payload: {} }).success).toBe(true);
        expect(ServerFrameSchema.safeParse({ type: 'request', event: 'x', payload: {} }).success).toBe(false);
    });

    test('parse helpers report a readable message instead of throwing', () => {
        const good = parseServerFrame({ type: 'event', event: 'session.list-changed', payload: {} });
        expect(good.ok).toBe(true);
        const bad = parseRequest({ id: 12, type: 'server.hello' });
        expect(bad.ok).toBe(false);
        if (!bad.ok) {
            expect(bad.message).toContain('id');
        }
    });
});

describe('server', () => {
    test('server.hello', () => {
        const { payload, result } = REQUEST_SCHEMAS['server.hello'];
        expect(payload.safeParse({}).success).toBe(true);
        expect(result.safeParse({ version: '0.0.0', platform: 'darwin', home: '/home/bas/.ruimte' }).success).toBe(true);
        expect(result.safeParse({ version: '0.0.0', platform: 'darwin' }).success).toBe(false);
    });
});

describe('session requests', () => {
    test('session.create requires the id and a size, the rest is optional', () => {
        const { payload } = REQUEST_SCHEMAS['session.create'];
        expect(payload.safeParse({ sessionId: 'n1', cols: 80, rows: 24 }).success).toBe(true);
        expect(payload.safeParse({ sessionId: 'n1', cols: 80, rows: 24, cwd: '/tmp', shell: '/bin/zsh' }).success).toBe(true);
        expect(payload.safeParse({ sessionId: 'n1', cols: 0, rows: 24 }).success).toBe(false);
    });

    test('session.attach', () => {
        const { payload, result } = REQUEST_SCHEMAS['session.attach'];
        expect(payload.safeParse({ sessionId: 'n1', cols: 120, rows: 40 }).success).toBe(true);
        expect(payload.safeParse({ sessionId: '', cols: 120, rows: 40 }).success).toBe(false);
        expect(result.safeParse({ screen: '', cols: 120, rows: 40, exited: false }).success).toBe(true);
        expect(result.safeParse({ screen: '', cols: 120, rows: 40 }).success).toBe(false);
    });

    test('session.write, resize, detach and kill', () => {
        expect(REQUEST_SCHEMAS['session.write'].payload.safeParse({ sessionId: 'n1', data: 'ls\r' }).success).toBe(true);
        expect(REQUEST_SCHEMAS['session.write'].payload.safeParse({ sessionId: 'n1' }).success).toBe(false);
        expect(REQUEST_SCHEMAS['session.resize'].payload.safeParse({ sessionId: 'n1', cols: 10, rows: 2 }).success).toBe(true);
        expect(REQUEST_SCHEMAS['session.resize'].payload.safeParse({ sessionId: 'n1', cols: 10.5, rows: 2 }).success).toBe(false);
        expect(REQUEST_SCHEMAS['session.detach'].payload.safeParse({ sessionId: 'n1' }).success).toBe(true);
        expect(REQUEST_SCHEMAS['session.kill'].payload.safeParse({}).success).toBe(false);
    });

    test('session.list returns session infos', () => {
        const { result } = REQUEST_SCHEMAS['session.list'];
        expect(result.safeParse({ sessions: [info] }).success).toBe(true);
        expect(result.safeParse({ sessions: [{ ...info, attached: -1 }] }).success).toBe(false);
        expect(SessionInfoSchema.safeParse({ ...info, exited: 'no' }).success).toBe(false);
    });
});

describe('session events', () => {
    test('session.output and session.exit', () => {
        expect(EVENT_SCHEMAS['session.output'].safeParse({ sessionId: 'n1', data: 'hi' }).success).toBe(true);
        expect(EVENT_SCHEMAS['session.output'].safeParse({ sessionId: 'n1', data: 1 }).success).toBe(false);
        expect(EVENT_SCHEMAS['session.exit'].safeParse({ sessionId: 'n1', exitCode: 0 }).success).toBe(true);
        expect(EVENT_SCHEMAS['session.exit'].safeParse({ sessionId: 'n1' }).success).toBe(false);
        expect(EVENT_SCHEMAS['session.list-changed'].safeParse({}).success).toBe(true);
    });
});

describe('type guards', () => {
    test('only know the table entries', () => {
        expect(isRequestType('session.attach')).toBe(true);
        expect(isRequestType('toString')).toBe(false);
        expect(isEventType('session.exit')).toBe(true);
        expect(isEventType('constructor')).toBe(false);
    });
});

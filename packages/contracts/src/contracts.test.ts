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

describe('chat.send', () => {
    test('needs text or an attachment, and bounds what an attachment can be', () => {
        const { payload } = REQUEST_SCHEMAS['chat.send'];
        const png = { name: 'a.png', mediaType: 'image/png', data: 'AAAA' };
        expect(payload.safeParse({ chatId: 'c1', text: 'hi' }).success).toBe(true);
        expect(payload.safeParse({ chatId: 'c1', text: '', attachments: [png] }).success).toBe(true);
        expect(payload.safeParse({ chatId: 'c1', text: 'see', mentions: ['src/a.ts'], attachments: [png] }).success).toBe(true);
        expect(payload.safeParse({ chatId: 'c1', text: '  ' }).success).toBe(false);
        expect(payload.safeParse({ chatId: 'c1', text: 'x', attachments: [{ ...png, mediaType: 'image/svg+xml' }] }).success).toBe(false);
        expect(payload.safeParse({ chatId: 'c1', text: 'x', attachments: [{ ...png, data: '' }] }).success).toBe(false);
        expect(payload.safeParse({ chatId: 'c1', text: 'x', attachments: Array.from({ length: 9 }, () => png) }).success).toBe(false);
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

describe('agent and chat', () => {
    const agent = { kind: 'claude', agentSessionId: 'abc', transcriptPath: null, status: 'running', live: true, updatedAt: 1 };

    test('a session may carry an agent, and session.status carries one or null', () => {
        expect(SessionInfoSchema.safeParse({ ...info, agent }).success).toBe(true);
        expect(EVENT_SCHEMAS['session.status'].safeParse({ sessionId: 'node-1', agent }).success).toBe(true);
        expect(EVENT_SCHEMAS['session.status'].safeParse({ sessionId: 'node-1', agent: null }).success).toBe(true);
        expect(EVENT_SCHEMAS['session.status'].safeParse({ sessionId: 'node-1', agent: { ...agent, status: 'busy' } }).success).toBe(false);
    });

    test('chat events are one of item, delta or info', () => {
        const item = { id: 'i1', createdAt: 1, turnId: null, kind: 'user', text: 'hi' };
        expect(EVENT_SCHEMAS['chat.event'].safeParse({ chatId: 'c1', event: { type: 'item', item } }).success).toBe(true);
        expect(EVENT_SCHEMAS['chat.event'].safeParse({ chatId: 'c1', event: { type: 'delta', itemId: 'i1', text: 'x' } }).success).toBe(true);
        expect(EVENT_SCHEMAS['chat.event'].safeParse({ chatId: 'c1', event: { type: 'item', item: { ...item, kind: 'ghost' } } }).success).toBe(false);
    });

    test('chat.approve only takes allow, allow-always or deny', () => {
        const schema = REQUEST_SCHEMAS['chat.approve'].payload;
        expect(schema.safeParse({ chatId: 'c1', requestId: 'r1', decision: 'allow' }).success).toBe(true);
        expect(schema.safeParse({ chatId: 'c1', requestId: 'r1', decision: 'allow-always' }).success).toBe(true);
        expect(schema.safeParse({ chatId: 'c1', requestId: 'r1', decision: 'maybe' }).success).toBe(false);
    });

    test('a model selection carries free-form options and a runtime mode is one of four', () => {
        const schema = REQUEST_SCHEMAS['chat.configure'].payload;
        expect(
            schema.safeParse({ chatId: 'c1', selection: { model: 'claude-opus-5', options: { effort: 'high', contextWindow: '1m' } }, runtimeMode: 'auto' })
                .success
        ).toBe(true);
        expect(schema.safeParse({ chatId: 'c1', runtimeMode: 'yolo' }).success).toBe(false);
    });
});

describe('project', () => {
    test('a note node carries its body and color, and an edge may connect any two ids without a label', () => {
        const content = {
            name: 'p',
            color: 'violet',
            nodes: [{ id: 'n1', kind: 'note', title: 'Plan', x: 0, y: 0, w: 320, h: 240, body: '# Plan', color: 'blue' }],
            texts: [],
            edges: [{ id: 'e1', from: 'n1', to: 'b1' }]
        };
        const { payload } = REQUEST_SCHEMAS['project.save'];
        expect(payload.safeParse({ projectId: 'p1', baseRev: 0, content }).success).toBe(true);
        expect(payload.safeParse({ projectId: 'p1', baseRev: 0, content: { ...content, nodes: [{ ...content.nodes[0], kind: 'sticky' }] } }).success).toBe(
            false
        );
    });
});

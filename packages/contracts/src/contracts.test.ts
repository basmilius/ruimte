import { describe, expect, test } from 'bun:test';
import {
    EVENT_SCHEMAS,
    EventSchema,
    FsEntrySchema,
    REQUEST_SCHEMAS,
    ReplySchema,
    ProjectDocumentSchema,
    ProjectSummarySchema,
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
        const png = { name: 'a.png', mime: 'image/png', data: 'AAAA' };
        expect(payload.safeParse({ chatId: 'c1', text: 'hi' }).success).toBe(true);
        expect(payload.safeParse({ chatId: 'c1', text: '', attachments: [png] }).success).toBe(true);
        expect(payload.safeParse({ chatId: 'c1', text: 'see', mentions: ['src/a.ts'], skills: ['unslop'], attachments: [png] }).success).toBe(true);
        expect(payload.safeParse({ chatId: 'c1', text: '  ' }).success).toBe(false);
        // Any file type is welcome now, but it still needs a name, a type and bytes.
        expect(payload.safeParse({ chatId: 'c1', text: 'x', attachments: [{ ...png, mime: 'application/zip' }] }).success).toBe(true);
        expect(payload.safeParse({ chatId: 'c1', text: 'x', attachments: [{ ...png, mime: '' }] }).success).toBe(false);
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
        expect(EVENT_SCHEMAS['session.resync'].safeParse({ sessionId: 'n1', screen: 'hi' }).success).toBe(true);
        expect(EVENT_SCHEMAS['session.resync'].safeParse({ sessionId: 'n1' }).success).toBe(false);
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

    test('a subagent item carries its delegation, what it spent and the report it ended with', () => {
        const subagent = {
            id: '1:toolu_agent',
            createdAt: 1,
            turnId: 't1',
            kind: 'subagent',
            toolUseId: 'toolu_agent',
            description: 'Find the bug',
            subagentType: 'general-purpose',
            prompt: 'look around',
            background: true,
            status: 'running',
            startedAt: 1,
            finishedAt: null,
            summary: null,
            result: null,
            usage: null,
            lastTool: 'Grep',
            itemsTruncated: false
        };
        const event = (item: unknown) => EVENT_SCHEMAS['chat.event'].safeParse({ chatId: 'c1', event: { type: 'item', item } }).success;
        expect(event(subagent)).toBe(true);
        expect(
            event({
                ...subagent,
                status: 'done',
                finishedAt: 2,
                summary: 'found it',
                result: '# Report',
                usage: { totalTokens: 10, toolUses: 2, durationMs: 30 },
                outputFile: '/tmp/a1.output'
            })
        ).toBe(true);
        expect(event({ ...subagent, status: 'cancelled' })).toBe(false);
        // Text a subagent wrote names the call it belongs to; the thread's own text has no parent.
        expect(event({ id: 'a1', createdAt: 1, turnId: 't1', kind: 'assistant', text: 'x', streaming: false, parentToolUseId: 'toolu_agent' })).toBe(true);
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

    test('a canvas file written before icons parses, with and without one', () => {
        const before = { version: 1, rev: 4, name: 'p', color: 'violet', nodes: [], texts: [], edges: [] };
        const parsed = ProjectDocumentSchema.safeParse(before);
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.icon).toBeUndefined();
        expect(parsed.success && parsed.data.layouts).toEqual([]);

        expect(ProjectDocumentSchema.safeParse({ ...before, icon: { kind: 'emoji', value: '\u{1f680}' } }).success).toBe(true);
        expect(ProjectDocumentSchema.safeParse({ ...before, icon: { kind: 'lucide', value: 'rocket' } }).success).toBe(true);
        // Only the closed list, and never an image blob in the shared file.
        expect(ProjectDocumentSchema.safeParse({ ...before, icon: { kind: 'lucide', value: 'unicorn' } }).success).toBe(false);
        expect(ProjectDocumentSchema.safeParse({ ...before, icon: { kind: 'image', value: 'data:image/png;base64,AA' } }).success).toBe(false);
        expect(ProjectDocumentSchema.safeParse({ ...before, icon: { kind: 'emoji', value: 'x'.repeat(17) } }).success).toBe(false);
    });

    test('a summary carries the resolved icon and where the name came from', () => {
        const summary = { projectId: 'p1', name: 'Ruimte', color: '#7c74ff', folder: '/repo', lastOpenedAt: 1, available: true };
        expect(ProjectSummarySchema.safeParse({ ...summary, icon: { kind: 'initial', value: 'R' }, nameSource: 'folder' }).success).toBe(true);
        expect(
            ProjectSummarySchema.safeParse({ ...summary, icon: { kind: 'image', value: '.idea/icon.svg', version: '17-42' }, nameSource: 'chosen' }).success
        ).toBe(true);
        // An image icon without a version would make an uncacheable URL.
        expect(ProjectSummarySchema.safeParse({ ...summary, icon: { kind: 'image', value: '.idea/icon.svg' }, nameSource: 'chosen' }).success).toBe(false);
        expect(ProjectSummarySchema.safeParse({ ...summary, icon: { kind: 'initial', value: 'R' }, nameSource: 'guessed' }).success).toBe(false);
        expect(ProjectSummarySchema.safeParse(summary).success).toBe(false);
    });

    test('project.setIcon takes bytes or a null image and answers with the summary', () => {
        const { payload } = REQUEST_SCHEMAS['project.setIcon'];
        expect(payload.safeParse({ projectId: 'p1', image: null }).success).toBe(true);
        expect(payload.safeParse({ projectId: 'p1', image: { mime: 'image/png', base64: 'AAAA' } }).success).toBe(true);
        expect(payload.safeParse({ projectId: 'p1' }).success).toBe(false);
    });
});

describe('fs', () => {
    test('fs.list takes a path with an optional depth and hidden flag', () => {
        const { payload } = REQUEST_SCHEMAS['fs.list'];
        expect(payload.safeParse({ path: '/repo' }).success).toBe(true);
        expect(payload.safeParse({ path: '/repo', depth: 3, hidden: true }).success).toBe(true);
        expect(payload.safeParse({ path: '/repo', depth: 4 }).success).toBe(false);
        expect(payload.safeParse({ path: '/repo', depth: 0 }).success).toBe(false);
        expect(payload.safeParse({ path: '' }).success).toBe(false);
    });

    test('an entry carries its kind, a nullable size and both flags', () => {
        const entry = { name: 'index.ts', path: '/repo/index.ts', kind: 'file', size: 12, mtime: 1, hidden: false, ignored: false };
        expect(FsEntrySchema.safeParse(entry).success).toBe(true);
        expect(FsEntrySchema.safeParse({ ...entry, kind: 'directory', size: null }).success).toBe(true);
        expect(FsEntrySchema.safeParse({ ...entry, kind: 'socket' }).success).toBe(false);
        expect(FsEntrySchema.safeParse({ ...entry, size: undefined }).success).toBe(false);
    });

    test('fs.watch takes one path and fs.changed names the directories that moved', () => {
        expect(REQUEST_SCHEMAS['fs.watch'].payload.safeParse({ path: '/repo' }).success).toBe(true);
        expect(REQUEST_SCHEMAS['fs.unwatch'].payload.safeParse({ path: '' }).success).toBe(false);
        expect(EVENT_SCHEMAS['fs.changed'].safeParse({ root: '/repo', paths: ['/repo/src'] }).success).toBe(true);
        expect(EVENT_SCHEMAS['fs.changed'].safeParse({ root: '/repo' }).success).toBe(false);
    });
});

describe('git', () => {
    const status = {
        repo: true,
        root: '/repo',
        branch: 'main',
        detached: false,
        upstream: 'origin/main',
        ahead: 1,
        behind: 0,
        base: 'origin/main',
        mergeBase: 'abc123',
        files: [{ path: 'src/main.ts', state: 'unstaged', status: 'M', added: 3, deleted: 1, binary: false }],
        truncated: false,
        live: true
    };

    test('a status carries the branch, the counts and the files it grouped', () => {
        expect(REQUEST_SCHEMAS['git.status'].result.safeParse(status).success).toBe(true);
        expect(REQUEST_SCHEMAS['git.status'].result.safeParse({ ...status, branch: null, detached: true }).success).toBe(true);
        expect(REQUEST_SCHEMAS['git.status'].result.safeParse({ ...status, live: undefined }).success).toBe(false);
        expect(
            REQUEST_SCHEMAS['git.status'].result.safeParse({
                ...status,
                files: [{ path: 'a', state: 'gone', status: 'M', added: 0, deleted: 0, binary: false }]
            }).success
        ).toBe(false);
        expect(EVENT_SCHEMAS['git.status'].safeParse({ cwd: '/repo', status }).success).toBe(true);
    });

    test('a diff is asked per path in one of the two scopes', () => {
        const { payload } = REQUEST_SCHEMAS['git.diff'];
        expect(payload.safeParse({ cwd: '/repo', path: 'src/main.ts', scope: 'worktree', staged: true }).success).toBe(true);
        expect(payload.safeParse({ cwd: '/repo', path: 'src/main.ts', scope: 'base' }).success).toBe(true);
        expect(payload.safeParse({ cwd: '/repo', path: 'src/main.ts', scope: 'turn' }).success).toBe(false);
    });

    test('staging and discarding both need at least one path', () => {
        expect(REQUEST_SCHEMAS['git.stage'].payload.safeParse({ cwd: '/repo', paths: ['a'], staged: true }).success).toBe(true);
        expect(REQUEST_SCHEMAS['git.stage'].payload.safeParse({ cwd: '/repo', paths: [], staged: true }).success).toBe(false);
        expect(REQUEST_SCHEMAS['git.discard'].payload.safeParse({ cwd: '/repo', paths: ['a'] }).success).toBe(true);
        expect(REQUEST_SCHEMAS['git.discard'].result.safeParse({ stash: null }).success).toBe(true);
    });
});

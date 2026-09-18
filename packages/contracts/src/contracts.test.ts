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
    parseServerFrame,
    resumeCommandFor
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
        const { payload, result } = REQUEST_SCHEMAS['chat.send'];
        const png = { name: 'a.png', mime: 'image/png', data: 'AAAA' };
        expect(payload.safeParse({ chatId: 'c1', text: 'hi' }).success).toBe(true);
        expect(payload.safeParse({ chatId: 'c1', text: '', attachments: [png] }).success).toBe(true);
        expect(payload.safeParse({ chatId: 'c1', text: 'see', mentions: ['src/a.ts'], skills: ['unslop'], attachments: [png] }).success).toBe(true);
        expect(payload.safeParse({ chatId: 'c1', text: '  ' }).success).toBe(false);
        expect(result.safeParse({ queued: true, turnId: 'turn-1' }).success).toBe(true);
        expect(result.safeParse({ queued: true }).success).toBe(true);
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

    test('session.write, resize, detach, clear and kill', () => {
        expect(REQUEST_SCHEMAS['session.write'].payload.safeParse({ sessionId: 'n1', data: 'ls\r' }).success).toBe(true);
        expect(REQUEST_SCHEMAS['session.write'].payload.safeParse({ sessionId: 'n1' }).success).toBe(false);
        expect(REQUEST_SCHEMAS['session.resize'].payload.safeParse({ sessionId: 'n1', cols: 10, rows: 2 }).success).toBe(true);
        expect(REQUEST_SCHEMAS['session.resize'].payload.safeParse({ sessionId: 'n1', cols: 10.5, rows: 2 }).success).toBe(false);
        expect(REQUEST_SCHEMAS['session.detach'].payload.safeParse({ sessionId: 'n1' }).success).toBe(true);
        expect(REQUEST_SCHEMAS['session.clear'].payload.safeParse({ sessionId: 'n1' }).success).toBe(true);
        expect(REQUEST_SCHEMAS['session.clear'].payload.safeParse({}).success).toBe(false);
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

describe('resumeCommandFor', () => {
    test('quotes the id and puts the flags where the template asks for them', () => {
        expect(resumeCommandFor('claude {flags} --resume {id}', 'abc-123')).toBe("claude --resume 'abc-123'");
        expect(resumeCommandFor('claude {flags} --resume {id}', 'abc-123', ['--permission-mode', 'acceptEdits'])).toBe(
            "claude --permission-mode acceptEdits --resume 'abc-123'"
        );
        expect(resumeCommandFor('codex resume {flags} {id}', "a'b", ['--sandbox', 'danger-full-access'])).toBe(
            "codex resume --sandbox danger-full-access 'a'\\''b'"
        );
        // The id is not always a word of its own, and a template may want no flags at all.
        expect(resumeCommandFor('copilot --resume={id}', 'abc-123', ['--ignored'])).toBe("copilot --resume='abc-123'");
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

    test('a permission request carries its choices, and the whole pending list travels per session', () => {
        const request = {
            requestId: 'r1',
            sessionId: 'node-1',
            toolName: 'Bash',
            summary: 'rm -rf build',
            choices: [
                { id: 'allow', kind: 'allow', label: 'Allow once' },
                { id: 'remember-0', kind: 'remember', label: 'Always allow rm -rf build' },
                { id: 'deny', kind: 'deny', label: 'Deny' }
            ],
            createdAt: 1,
            expiresAt: 2
        };
        expect(EVENT_SCHEMAS['session.approvals'].safeParse({ sessionId: 'node-1', approvals: [request] }).success).toBe(true);
        // An empty list is how a client hears that the request it was showing is settled.
        expect(EVENT_SCHEMAS['session.approvals'].safeParse({ sessionId: 'node-1', approvals: [] }).success).toBe(true);
        expect(EVENT_SCHEMAS['session.approvals'].safeParse({ sessionId: 'node-1', approvals: [{ ...request, choices: [] }] }).success).toBe(false);
        expect(
            EVENT_SCHEMAS['session.approvals'].safeParse({
                sessionId: 'node-1',
                approvals: [{ ...request, choices: [{ id: 'maybe', kind: 'maybe', label: 'Maybe' }] }]
            }).success
        ).toBe(false);
        expect(SessionInfoSchema.safeParse({ ...info, approvals: [request] }).success).toBe(true);
    });

    test('an answer names the session, the request and the choice, and says whether it was in time', () => {
        const schema = REQUEST_SCHEMAS['agent.answerApproval'];
        expect(schema.payload.safeParse({ sessionId: 'node-1', requestId: 'r1', choiceId: 'allow' }).success).toBe(true);
        expect(schema.payload.safeParse({ sessionId: 'node-1', requestId: 'r1' }).success).toBe(false);
        expect(schema.result.safeParse({ accepted: false }).success).toBe(true);
    });

    test('a client says whether it wants permission requests at all, and nothing else', () => {
        const schema = REQUEST_SCHEMAS['agent.setApprovals'];
        expect(schema.payload.safeParse({ enabled: false }).success).toBe(true);
        expect(schema.payload.safeParse({}).success).toBe(false);
        expect(schema.payload.safeParse({ enabled: 'yes' }).success).toBe(false);
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
        const view = {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [{ id: 'n1', kind: 'note', title: 'Plan', x: 0, y: 0, w: 320, h: 240, body: '# Plan', color: 'blue' }],
            texts: [],
            edges: [{ id: 'e1', from: 'n1', to: 'b1' }]
        };
        const content = { name: 'p', color: 'violet', views: [view] };
        const { payload } = REQUEST_SCHEMAS['project.save'];
        expect(payload.safeParse({ projectId: 'p1', baseRev: 0, content }).success).toBe(true);
        // A kind this version does not know is carried along; a known kind with a broken field is not.
        expect(
            payload.safeParse({ projectId: 'p1', baseRev: 0, content: { ...content, views: [{ ...view, nodes: [{ ...view.nodes[0], kind: 'sticky' }] }] } })
                .success
        ).toBe(true);
        expect(
            payload.safeParse({ projectId: 'p1', baseRev: 0, content: { ...content, views: [{ ...view, nodes: [{ ...view.nodes[0], color: 7 }] }] } }).success
        ).toBe(false);
        // A project always has a view; the last one that goes leaves an empty canvas behind.
        expect(payload.safeParse({ projectId: 'p1', baseRev: 0, content: { ...content, views: [] } }).success).toBe(false);
    });

    test('a separator view carries an id and, if a person gave it one, a label', () => {
        const view = { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [] };
        const document = (views: unknown[]) => ProjectDocumentSchema.safeParse({ version: 2, rev: 1, name: 'p', color: 'violet', views });
        expect(document([view, { kind: 'separator', id: 's1' }]).success).toBe(true);
        expect(document([view, { kind: 'separator', id: 's1', name: 'Agents' }]).success).toBe(true);
        // An empty label is not a label: a separator without one is the bare line.
        expect(document([view, { kind: 'separator', id: 's1', name: '' }]).success).toBe(false);
        expect(document([view, { kind: 'separator' }]).success).toBe(false);
    });

    test('a view may overrule the mark of its kind, with the same two kinds a project picks from', () => {
        const view = { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [] };
        const document = (views: unknown[]) => ProjectDocumentSchema.safeParse({ version: 2, rev: 1, name: 'p', color: 'violet', views });
        expect(document([{ ...view, icon: { kind: 'lucide', value: 'rocket' } }]).success).toBe(true);
        expect(document([{ ...view, icon: { kind: 'emoji', value: '\u{1f680}' } }]).success).toBe(true);
        // No icon at all is the default: the row wears the mark of what it is.
        const bare = document([view]);
        expect(bare.success && bare.data.views[0]!.kind === 'canvas' && bare.data.views[0]!.icon).toBeUndefined();
        expect(document([{ ...view, icon: { kind: 'lucide', value: 'unicorn' } }]).success).toBe(false);
        expect(document([{ ...view, icon: { kind: 'image', value: '.ruimte/icon.svg', version: '1' } }]).success).toBe(false);
        // A separator has no room for a mark, so one written into the file is dropped on the way in.
        const withSeparator = document([view, { kind: 'separator', id: 's1', icon: { kind: 'lucide', value: 'rocket' } }]);
        expect(withSeparator.success && withSeparator.data.views[1]).toEqual({ kind: 'separator', id: 's1' });
    });

    test('a canvas file without an icon parses, and only the two kinds a person picks are allowed', () => {
        const view = { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [] };
        const before = { version: 2, rev: 4, name: 'p', color: 'violet', views: [view] };
        const parsed = ProjectDocumentSchema.safeParse(before);
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.icon).toBeUndefined();
        expect(parsed.success && parsed.data.views[0]!.kind === 'canvas' && parsed.data.views[0]!.layouts).toEqual([]);

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

    test('project.setIdentity changes a name or chosen icon without opening the project', () => {
        const { payload } = REQUEST_SCHEMAS['project.setIdentity'];
        expect(payload.safeParse({ projectId: 'p1', name: 'Renamed' }).success).toBe(true);
        expect(payload.safeParse({ projectId: 'p1', icon: { kind: 'lucide', value: 'rocket' } }).success).toBe(true);
        expect(payload.safeParse({ projectId: 'p1', icon: null }).success).toBe(true);
        expect(payload.safeParse({ projectId: 'p1', icon: { kind: 'lucide', value: 'unicorn' } }).success).toBe(false);
        expect(payload.safeParse({ projectId: '', name: 'Renamed' }).success).toBe(false);
    });

    test('project.showView names the view and who asked, and is an event rather than a request', () => {
        const event = EVENT_SCHEMAS['project.showView'];
        expect(event.safeParse({ projectId: 'p1', viewId: 'board', by: 'term-1' }).success).toBe(true);
        // Every field is load-bearing: without the caller no client can say which agent pulled the view up.
        expect(event.safeParse({ projectId: 'p1', viewId: 'board' }).success).toBe(false);
        expect(event.safeParse({ projectId: 'p1', viewId: '', by: 'term-1' }).success).toBe(false);
        expect(event.safeParse({ projectId: '', viewId: 'board', by: 'term-1' }).success).toBe(false);
        // Showing is personal, so nothing on the wire asks the daemon to show a view.
        expect(isRequestType('project.showView')).toBe(false);
        expect(isEventType('project.showView')).toBe(true);
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

describe('usage', () => {
    const totals = { calls: 3, input: 100, cacheRead: 900, cacheWrite: 50, cacheWrite1h: 10, output: 40, reasoning: 12 };
    const summary = {
        from: '2026-09-04',
        to: '2026-09-10',
        resolution: 'day',
        timeZone: 'Europe/Amsterdam',
        buckets: [{ slot: '2026-09-10', provider: 'claude', model: 'claude-opus-5', totals, costUsd: 1.25, cacheSavingsUsd: 0.4, sessions: 2 }],
        models: [{ provider: 'claude', model: 'claude-opus-5', totals, costUsd: 1.25, priceBasis: 'exact', pricedAs: null }],
        projects: [
            {
                folder: '/home/bas/ruimte',
                name: 'ruimte',
                projectId: 'p1',
                byProvider: { claude: { costUsd: 1.25, tokens: 1090 } },
                totals,
                costUsd: 1.25
            }
        ],
        sessions: 2,
        scan: { at: 1_700_000_000_000, files: 1149, changedFiles: 3, durationMs: 84, running: false, failed: false },
        pricing: { source: 'litellm', fetchedAt: 1_700_000_000_000, models: 812 },
        rate: { currency: 'EUR', rate: 0.857, date: '2026-09-10', fetchedAt: 1_700_000_000_000 },
        roots: [{ provider: 'claude', path: '/home/bas/.claude/projects', status: 'ok', message: null }]
    };

    test('a summary is asked per period in the viewer time zone', () => {
        const { payload, result } = REQUEST_SCHEMAS['usage.summary'];
        expect(payload.safeParse({ from: '2026-09-04', to: '2026-09-10', resolution: 'hour', timeZone: 'UTC' }).success).toBe(true);
        expect(payload.safeParse({ from: '2026-09-04', to: '2026-09-10', resolution: 'week', timeZone: 'UTC' }).success).toBe(false);
        expect(result.safeParse(summary).success).toBe(true);
    });

    test('an unpriced model keeps a null cost and a provider outside the readers is refused', () => {
        const { result } = REQUEST_SCHEMAS['usage.summary'];
        expect(result.safeParse({ ...summary, models: [{ ...summary.models[0], costUsd: null, priceBasis: 'unknown', pricedAs: null }] }).success).toBe(true);
        expect(result.safeParse({ ...summary, buckets: [{ ...summary.buckets[0], provider: 'gemini' }] }).success).toBe(false);
        expect(result.safeParse({ ...summary, buckets: [{ ...summary.buckets[0], totals: { ...totals, output: -1 } }] }).success).toBe(false);
        // A page without a rate shows dollars; a rate of zero would divide an amount away.
        expect(result.safeParse({ ...summary, rate: null }).success).toBe(true);
        expect(result.safeParse({ ...summary, rate: { ...summary.rate, rate: 0 } }).success).toBe(false);
    });

    test('a scan tells the page what to ask for next', () => {
        expect(EVENT_SCHEMAS['usage.changed'].safeParse({ scannedAt: 1_700_000_000_000 }).success).toBe(true);
        expect(EVENT_SCHEMAS['usage.changed'].safeParse({}).success).toBe(false);
    });

    test('a window carries a fraction and the moment it resets', () => {
        const provider = {
            kind: 'claude',
            plan: 'max',
            checkedAt: 1_700_000_000_000,
            source: 'probe',
            windows: [{ id: 'five_hour', kind: 'session', label: 'Session', used: 0.38, resetsAt: 1_700_000_600_000, durationMs: 18_000_000 }],
            cost: { sessionUsd: 1.5 },
            unavailable: null
        };
        expect(REQUEST_SCHEMAS['usage.limits'].result.safeParse({ providers: [provider] }).success).toBe(true);
        expect(EVENT_SCHEMAS['usage.limitsChanged'].safeParse({ providers: [provider] }).success).toBe(true);
        expect(
            REQUEST_SCHEMAS['usage.limits'].result.safeParse({ providers: [{ ...provider, windows: [{ ...provider.windows[0], used: 1.4 }] }] }).success
        ).toBe(false);
        expect(
            REQUEST_SCHEMAS['usage.refreshLimits'].result.safeParse({
                providers: [{ ...provider, windows: [], cost: null, unavailable: { reason: 'not-installed', message: null } }]
            }).success
        ).toBe(true);
    });
});

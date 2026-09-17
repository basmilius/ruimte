import { describe, expect, test } from 'bun:test';
import type { ApprovalRequest } from '@ruimte/contracts';
import { ApprovalStore, parsePermissionAsk } from './approvals.ts';

const ASK = {
    hook_event_name: 'PermissionRequest',
    session_id: 'cli-1',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf build', description: 'Clean the build' },
    permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm -rf build' }], behavior: 'allow', destination: 'localSettings' }]
};

const askOf = (body: unknown) => {
    const ask = parsePermissionAsk(body);
    if (ask === null) {
        throw new Error('expected a permission ask');
    }
    return ask;
};

const collector = () => {
    const published: Array<{ sessionId: string; approvals: ApprovalRequest[] }> = [];
    return { published, sink: (sessionId: string, approvals: ApprovalRequest[]) => published.push({ sessionId, approvals }) };
};

const held = (store: ApprovalStore, sessionId = 'node-1', body: unknown = ASK) =>
    store.hold({ sessionId, ask: askOf(body), signal: new AbortController().signal });

describe('parsePermissionAsk', () => {
    test('reads the tool, its command and the rules the CLI offered', () => {
        expect(askOf(ASK)).toEqual({ toolName: 'Bash', summary: 'rm -rf build', suggestions: ASK.permission_suggestions });
    });

    test('names a file tool by its path and an unknown one by whatever string it carries', () => {
        expect(askOf({ ...ASK, tool_name: 'Write', tool_input: { file_path: '/tmp/a.txt', content: 'x' } }).summary).toBe('/tmp/a.txt');
        expect(askOf({ ...ASK, tool_name: 'Weird', tool_input: { whatever: 'a thing' } }).summary).toBe('a thing');
        expect(askOf({ ...ASK, tool_name: 'Weird', tool_input: {} }).summary).toBe('Weird');
    });

    test('is null for every other hook', () => {
        expect(parsePermissionAsk({ hook_event_name: 'PreToolUse', tool_name: 'Bash' })).toBeNull();
        expect(parsePermissionAsk({ hook_event_name: 'PermissionRequest' })).toBeNull();
        expect(parsePermissionAsk('nope')).toBeNull();
    });

    test('is null for a question, which only the TUI can answer', () => {
        expect(parsePermissionAsk({ ...ASK, tool_name: 'AskUserQuestion', tool_input: { questions: [] } })).toBeNull();
    });
});

describe('ApprovalStore', () => {
    test('publishes the request with the choices the CLI offered', async () => {
        const { published, sink } = collector();
        const store = new ApprovalStore(sink, 50);
        const answer = held(store);
        const request = published[0]?.approvals[0];
        expect(published[0]?.sessionId).toBe('node-1');
        expect(request?.toolName).toBe('Bash');
        expect(request?.summary).toBe('rm -rf build');
        expect(request?.choices).toEqual([
            { id: 'allow', kind: 'allow', label: 'Allow once' },
            { id: 'remember-0', kind: 'remember', label: 'Always allow rm -rf build' },
            { id: 'deny', kind: 'deny', label: 'Deny' }
        ]);
        expect(await answer).toBeNull();
    });

    test('offers no rule when the CLI suggested none it can name', async () => {
        const { published, sink } = collector();
        const store = new ApprovalStore(sink, 50);
        const answer = held(store, 'node-1', { ...ASK, permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] });
        expect(published[0]?.approvals[0]?.choices.map((choice) => choice.id)).toEqual(['allow', 'deny']);
        expect(await answer).toBeNull();
    });

    test('names a directory the CLI offered to trust', async () => {
        const { published, sink } = collector();
        const store = new ApprovalStore(sink, 50);
        const answer = held(store, 'node-1', {
            ...ASK,
            permission_suggestions: [{ type: 'addDirectories', directories: ['/tmp/work'], destination: 'session' }]
        });
        expect(published[0]?.approvals[0]?.choices[1]).toEqual({ id: 'remember-0', kind: 'remember', label: 'Always allow /tmp/work' });
        expect(await answer).toBeNull();
    });

    test('answers once and tells the second client it was late', async () => {
        const { published, sink } = collector();
        const store = new ApprovalStore(sink, 5_000);
        const answer = held(store);
        const requestId = published[0]!.approvals[0]!.requestId;
        expect(store.answer('node-1', requestId, 'allow')).toBe(true);
        expect(await answer).toEqual({ behavior: 'allow' });
        expect(store.answer('node-1', requestId, 'deny')).toBe(false);
        // The settle empties the session, which is how the clients that lost see it resolve.
        expect(published.at(-1)).toEqual({ sessionId: 'node-1', approvals: [] });
    });

    test('turns a deny into a message the agent reads and a remembered rule into an update', async () => {
        const { published, sink } = collector();
        const store = new ApprovalStore(sink, 5_000);
        const denied = held(store);
        store.answer('node-1', published[0]!.approvals[0]!.requestId, 'deny');
        expect(await denied).toEqual({ behavior: 'deny', message: 'Denied from Ruimte.' });

        const remembered = held(store);
        store.answer('node-1', published.at(-1)!.approvals[0]!.requestId, 'remember-0');
        expect(await remembered).toEqual({ behavior: 'allow', updatedPermissions: [ASK.permission_suggestions[0]] });
    });

    test('refuses an answer for the wrong session or a choice that is not on offer', async () => {
        const { published, sink } = collector();
        const store = new ApprovalStore(sink, 5_000);
        const answer = held(store);
        const requestId = published[0]!.approvals[0]!.requestId;
        expect(store.answer('node-2', requestId, 'allow')).toBe(false);
        expect(store.answer('node-1', requestId, 'remember-9')).toBe(false);
        expect(store.answer('node-1', 'no-such-request', 'allow')).toBe(false);
        store.answer('node-1', requestId, 'allow');
        expect(await answer).toEqual({ behavior: 'allow' });
    });

    test('lets go when nobody answers in time', async () => {
        const { published, sink } = collector();
        const store = new ApprovalStore(sink, 20);
        expect(await held(store)).toBeNull();
        expect(published.at(-1)?.approvals).toEqual([]);
        expect(store.forSession('node-1')).toEqual([]);
    });

    test('lets go when the CLI cancels the hook because the person used its own prompt', async () => {
        const { published, sink } = collector();
        const store = new ApprovalStore(sink, 5_000);
        const controller = new AbortController();
        const answer = store.hold({ sessionId: 'node-1', ask: askOf(ASK), signal: controller.signal });
        controller.abort();
        expect(await answer).toBeNull();
        expect(published.at(-1)?.approvals).toEqual([]);
    });

    test('drops everything a session was waiting on when it ends', async () => {
        const { published, sink } = collector();
        const store = new ApprovalStore(sink, 5_000);
        const first = held(store);
        const second = held(store);
        expect(store.forSession('node-1')).toHaveLength(2);
        store.dropSession('node-1');
        expect(await first).toBeNull();
        expect(await second).toBeNull();
        expect(store.forSession('node-1')).toEqual([]);
        expect(published.at(-1)?.approvals).toEqual([]);
    });

    test('keeps the sessions apart', async () => {
        const { sink } = collector();
        const store = new ApprovalStore(sink, 5_000);
        const first = held(store, 'node-1');
        const second = held(store, 'node-2');
        expect(store.forSession('node-1')).toHaveLength(1);
        store.dropSession('node-1');
        expect(await first).toBeNull();
        expect(store.forSession('node-2')).toHaveLength(1);
        store.dropSession('node-2');
        expect(await second).toBeNull();
    });
});

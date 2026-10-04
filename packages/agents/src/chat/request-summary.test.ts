import { describe, expect, test } from 'bun:test';
import { CHAT_REQUEST_LIMITS, ChatInfoSchema, type ChatApprovalItem, type ChatInfo, type ChatQuestionItem } from '@ruimte/agent-contracts';
import { approvalSummary, requestSummaries } from './request-summary.ts';
import { ChatThread } from './thread.ts';

const info: ChatInfo = {
    chatId: 'c',
    provider: 'claude',
    cwd: '/',
    agentSessionId: null,
    model: null,
    selection: { model: 'claude-sonnet-5', options: {} },
    runtimeMode: 'full-access',
    status: 'running',
    running: true,
    activeTurnId: 'turn-1',
    slashCommands: [],
    usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 0 },
    createdAt: 0
};

function approval(toolName: string, input: unknown, extra: Partial<ChatApprovalItem> = {}): ChatApprovalItem {
    return {
        id: 'approval-req-1',
        kind: 'approval',
        createdAt: 5,
        turnId: 'turn-1',
        requestId: 'req-1',
        toolUseId: 'toolu_1',
        toolName,
        input,
        description: null,
        canAllowAlways: false,
        decision: 'pending',
        ...extra
    };
}

function question(extra: Partial<ChatQuestionItem> = {}): ChatQuestionItem {
    return {
        id: 'question-req-q',
        kind: 'question',
        createdAt: 7,
        turnId: 'turn-1',
        requestId: 'req-q',
        questions: [{ id: '0', header: 'Choice', question: 'Which color?', choices: [{ label: 'Red', description: 'Warm' }], multiSelect: false }],
        answers: null,
        state: 'pending',
        ...extra
    };
}

describe('approvalSummary', () => {
    test("an edit becomes the lines it takes out and puts in, under the file's path", () => {
        const summary = approvalSummary(approval('Edit', { file_path: 'src/pool.ts', old_string: 'a\nb', new_string: 'c' }));
        expect(summary).toEqual({
            toolName: 'Edit',
            subject: 'src/pool.ts',
            description: null,
            path: 'src/pool.ts',
            diff: '-a\n-b\n+c',
            canAllowAlways: false
        });
    });

    test('a Codex patch shows the changed lines of its first file and how many files it touches', () => {
        const changes = [
            { path: 'a.ts', kind: 'update', diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n' },
            { path: 'b.ts', kind: 'add', diff: '+x\n' }
        ];
        expect(approvalSummary(approval('ApplyPatch', { itemId: 'i', changes }))).toMatchObject({
            subject: 'a.ts',
            path: 'a.ts',
            files: 2,
            diff: '-old\n+new'
        });
    });

    test('a command is carried whole up to its bound, and its first line is the subject', () => {
        const summary = approvalSummary(approval('Bash', { command: 'cd x\nbun test', description: 'Run tests' }, { description: 'Run a command' }));
        expect(summary).toMatchObject({ subject: 'cd x', command: 'cd x\nbun test', description: 'Run a command' });
        expect(summary.truncated).toBeUndefined();
    });

    test('any other tool names its subject from the input, and the allow-always offer comes along', () => {
        const allowAlways = { label: 'Always allow', description: 'Remembered.' };
        expect(approvalSummary(approval('WebFetch', { url: 'https://ruimte.app', prompt: 'read' }, { canAllowAlways: true, allowAlways }))).toEqual({
            toolName: 'WebFetch',
            subject: 'https://ruimte.app',
            description: null,
            canAllowAlways: true,
            allowAlways
        });
        expect(approvalSummary(approval('mcp__thing__do', { target: 'the thing' })).subject).toBe('the thing');
    });

    test('a large input is cut to its bounds and says so', () => {
        const content = Array.from({ length: 500 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
        const write = approvalSummary(approval('Write', { file_path: `/${'deep/'.repeat(80)}file.ts`, content }));
        expect(write.diff!.split('\n')).toHaveLength(CHAT_REQUEST_LIMITS.diffLines);
        expect(write.diff!.length).toBeLessThanOrEqual(CHAT_REQUEST_LIMITS.diff);
        expect(write.truncated).toBe(true);
        expect(write.path!.length).toBe(CHAT_REQUEST_LIMITS.subject);
        expect(write.path!.endsWith('/file.ts')).toBe(true);

        const command = approvalSummary(approval('Bash', { command: 'y'.repeat(5000) }, { description: 'z'.repeat(5000) }));
        expect(command.command!.length).toBe(CHAT_REQUEST_LIMITS.command);
        expect(command.subject.length).toBe(CHAT_REQUEST_LIMITS.subject);
        expect(command.description!.length).toBe(CHAT_REQUEST_LIMITS.description);
        expect(command.truncated).toBe(true);
    });

    test('a cut never splits a character in two', () => {
        const summary = approvalSummary(approval('Bash', { command: `${'a'.repeat(CHAT_REQUEST_LIMITS.command - 1)}😀` }));
        expect(summary.command).toBe('a'.repeat(CHAT_REQUEST_LIMITS.command - 1));
    });
});

describe('requestSummaries', () => {
    test('a question keeps its labels whole, since the answer is the label, and cuts the rest', () => {
        const label = 'L'.repeat(400);
        const [summary] = requestSummaries([
            question({
                async: true,
                questions: [{ id: '0', header: 'H', question: 'q'.repeat(900), choices: [{ label, description: 'd'.repeat(900) }], multiSelect: true }]
            })
        ]);
        expect(summary).toMatchObject({ requestId: 'req-q', itemId: 'question-req-q', kind: 'question', createdAt: 7, question: { async: true } });
        const asked = summary!.question!.questions[0]!;
        expect(asked.choices[0]!.label).toBe(label);
        expect(asked.question.length).toBe(CHAT_REQUEST_LIMITS.question);
        expect(asked.choices[0]!.description.length).toBe(CHAT_REQUEST_LIMITS.choiceDescription);
    });

    test('a chat carries at most its bound of requests, oldest first', () => {
        const many = Array.from({ length: 12 }, (_, i) => approval('Bash', { command: 'ls' }, { id: `approval-${i}`, requestId: `${i}` }));
        expect(requestSummaries(many).map((summary) => summary.requestId)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    });
});

describe('ChatThread requests', () => {
    test('follow the request items, so the next info event says what the chat waits on', () => {
        const thread = new ChatThread(info);
        thread.upsert(approval('Bash', { command: 'date' }));
        thread.upsert(question());
        expect(thread.info.requests?.map((request) => [request.kind, request.requestId])).toEqual([
            ['approval', 'req-1'],
            ['question', 'req-q']
        ]);
        expect(ChatInfoSchema.parse(thread.info)).toEqual(thread.info);

        thread.upsert({ ...approval('Bash', { command: 'date' }), decision: 'allow' });
        expect(thread.info.requests?.map((request) => request.requestId)).toEqual(['req-q']);
        thread.upsert({ ...question(), state: 'answered', answers: { '0': 'Red' } });
        expect(thread.info).not.toHaveProperty('requests');
    });

    test('are worked out again from stored items, and leave with a reset', () => {
        const stale = { ...info, requests: requestSummaries([approval('Bash', { command: 'gone' }, { requestId: 'old' })]) };
        const thread = new ChatThread(stale, [question()]);
        expect(thread.info.requests?.map((request) => request.requestId)).toEqual(['req-q']);
        thread.reset({});
        expect(thread.info).not.toHaveProperty('requests');
    });
});

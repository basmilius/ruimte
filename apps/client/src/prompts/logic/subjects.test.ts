import { describe, expect, test } from 'bun:test';
import type { ApprovalRequest, ChatApprovalItem, ChatQuestionItem } from '@ruimte/contracts';
import { PROMPT_SAMPLES } from './prompts.fixtures';
import { answerPrompt, approvalButtons, isBlockingSubject, promptCreatedAt, promptIdOf, type PromptClients, type PromptSubject } from './subjects';

const request = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
    requestId: 'request-1',
    sessionId: 'terminal-1',
    toolName: 'Bash',
    summary: 'bun test apps/server/src/outbox',
    choices: [
        { id: 'allow', kind: 'allow', label: 'Allow' },
        { id: 'deny', kind: 'deny', label: 'Deny' },
        { id: 'remember', kind: 'remember', label: 'Always allow Bash(bun test:*)' }
    ],
    createdAt: 20,
    expiresAt: 130,
    ...overrides
});

const sampleOf = (label: string) => PROMPT_SAMPLES.find((sample) => sample.label === label)!.items[0]!;
const command = sampleOf('Permission · Command') as ChatApprovalItem;
const optional = sampleOf('Question · Optional') as ChatQuestionItem;

const recorder = (accepted = true) => {
    const calls: unknown[][] = [];
    const clients: PromptClients = {
        chat: {
            approve: async (...args) => void calls.push(['approve', ...args]),
            answer: async (...args) => void calls.push(['answer', ...args]),
            dismiss: async (...args) => void calls.push(['dismiss', ...args])
        },
        sessions: {
            answerApproval: async (...args) => {
                calls.push(['answerApproval', ...args]);
                return accepted;
            }
        },
        computer: {
            answer: async (...args) => {
                calls.push(['computerAnswer', ...args]);
                return accepted;
            }
        }
    };
    return { calls, clients };
};

describe('approval buttons', () => {
    test("a terminal's choices come in the chat's order, with Allow as the primary", () => {
        const buttons = approvalButtons({ kind: 'terminal-approval', nodeId: 'terminal-1', request: request() }, '');
        expect(buttons.map((button) => [button.label, button.primary])).toEqual([
            ['Always allow Bash(bun test:*)', false],
            ['Deny', false],
            ['Allow', true]
        ]);
        expect(buttons[0]!.action).toEqual({ kind: 'choose', choiceId: 'remember' });
    });

    test('a chat approval offers its remembered rule first and carries a reason on Deny only', () => {
        const buttons = approvalButtons({ kind: 'chat', nodeId: 'chat-1', item: command }, '  too broad ');
        expect(buttons.map((button) => button.label)).toEqual(['Allow for this session', 'Deny', 'Allow']);
        expect(buttons[1]!.action).toEqual({ kind: 'approve', decision: 'deny', message: 'too broad' });
        expect(buttons[2]!.action).toEqual({ kind: 'approve', decision: 'allow' });
    });

    test('a question and a waiting terminal have no approval buttons', () => {
        expect(approvalButtons({ kind: 'chat', nodeId: 'chat-1', item: optional }, '')).toEqual([]);
        expect(approvalButtons({ kind: 'terminal-waiting', nodeId: 'terminal-1', since: 5 }, '')).toEqual([]);
    });
});

describe('answering a subject', () => {
    test('a chat subject sends chat.approve, chat.answer and chat.dismiss for its own chat', async () => {
        const { calls, clients } = recorder();
        const subject: PromptSubject = { kind: 'chat', nodeId: 'chat-1', item: command };
        await answerPrompt(subject, { kind: 'approve', decision: 'deny', message: 'no' }, clients);
        await answerPrompt({ kind: 'chat', nodeId: 'chat-1', item: optional }, { kind: 'answer', answers: { endpoints: 'All three' } }, clients);
        await answerPrompt({ kind: 'chat', nodeId: 'chat-1', item: optional }, { kind: 'dismiss' }, clients);
        expect(calls).toEqual([
            ['approve', 'chat-1', command.requestId, 'deny', 'no'],
            ['answer', 'chat-1', optional.requestId, { endpoints: 'All three' }],
            ['dismiss', 'chat-1', optional.id]
        ]);
    });

    test('a terminal approval sends agent.answerApproval with the chosen choice, and a settled one is an error', async () => {
        const { calls, clients } = recorder();
        const subject: PromptSubject = { kind: 'terminal-approval', nodeId: 'terminal-1', request: request() };
        await answerPrompt(subject, { kind: 'choose', choiceId: 'allow' }, clients);
        expect(calls).toEqual([['answerApproval', 'terminal-1', 'request-1', 'allow']]);
        await expect(answerPrompt(subject, { kind: 'choose', choiceId: 'allow' }, recorder(false).clients)).rejects.toThrow('already answered');
    });

    test('a waiting terminal sends nothing', async () => {
        const { calls, clients } = recorder();
        await expect(
            answerPrompt({ kind: 'terminal-waiting', nodeId: 'terminal-1', since: 1 }, { kind: 'choose', choiceId: 'allow' }, clients)
        ).rejects.toThrow();
        expect(calls).toEqual([]);
    });
});

describe('a computer use card', () => {
    const card: PromptSubject = {
        kind: 'computer-approval',
        nodeId: 'chat-1',
        request: {
            requestId: 'computer-1',
            nodeId: 'chat-1',
            surface: 'chat',
            nodeTitle: 'Docs',
            projectId: 'p1',
            projectName: 'Ruimte',
            app: { name: 'TextEdit', bundleId: 'com.example.textedit' },
            command: 'state',
            createdAt: 7,
            expiresAt: 600_007
        }
    };

    test('offers Deny, Always allow and Allow this time, the last as the primary', () => {
        expect(approvalButtons(card, '').map((button) => [button.label, button.primary, button.action])).toEqual([
            ['Deny', false, { kind: 'choose', choiceId: 'deny' }],
            ['Always allow', false, { kind: 'choose', choiceId: 'always' }],
            ['Allow this time', true, { kind: 'choose', choiceId: 'once' }]
        ]);
    });

    test('answers the machine with the choice, and a card that is gone is an error', async () => {
        const { calls, clients } = recorder();
        await answerPrompt(card, { kind: 'choose', choiceId: 'always' }, clients);
        expect(calls).toEqual([['computerAnswer', 'computer-1', 'always']]);
        await expect(answerPrompt(card, { kind: 'choose', choiceId: 'once' }, recorder(false).clients)).rejects.toThrow('already answered');
        await expect(answerPrompt(card, { kind: 'choose', choiceId: 'allow' }, clients)).rejects.toThrow();
        expect(calls).toHaveLength(1);
    });

    test('blocks, and is dated by when the agent first asked', () => {
        expect(isBlockingSubject(card)).toBe(true);
        expect(promptCreatedAt(card)).toBe(7);
        expect(promptIdOf(card)).toBe('computer:chat-1:computer-1');
    });
});

describe('subject identity and order', () => {
    test('ids stay apart across kinds, and each kind is dated by its own arrival', () => {
        const subjects: PromptSubject[] = [
            { kind: 'chat', nodeId: 'node', item: { ...command, requestId: 'same', createdAt: 3 } },
            { kind: 'terminal-approval', nodeId: 'node', request: request({ requestId: 'same', createdAt: 4 }) },
            { kind: 'terminal-waiting', nodeId: 'node', since: 5 }
        ];
        expect(new Set(subjects.map(promptIdOf)).size).toBe(3);
        expect(subjects.map(promptCreatedAt)).toEqual([3, 4, 5]);
    });

    test('only an optional chat question does not block', () => {
        expect(isBlockingSubject({ kind: 'chat', nodeId: 'chat-1', item: optional })).toBe(false);
        expect(isBlockingSubject({ kind: 'chat', nodeId: 'chat-1', item: command })).toBe(true);
        expect(isBlockingSubject({ kind: 'terminal-waiting', nodeId: 'terminal-1', since: 0 })).toBe(true);
    });
});

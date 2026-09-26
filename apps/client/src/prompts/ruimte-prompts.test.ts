import { describe, expect, test } from 'bun:test';
import type { ComputerApprovalChoice } from '@ruimte/contracts';
import { isBlockingSubject, promptCreatedAt, promptIdOf, type PromptSubject } from '@ruimte/agents-react/prompts/logic/subjects';
import { answerRuimtePrompt, computerButtons, computerPrompt, ruimtePayloadOf, waitingPrompt } from '@/prompts/ruimte-prompts';

const request = {
    requestId: 'computer-1',
    nodeId: 'chat-1',
    surface: 'chat' as const,
    nodeTitle: 'Docs',
    projectId: 'p1',
    projectName: 'Ruimte',
    app: { name: 'TextEdit', bundleId: 'com.example.textedit' },
    command: 'state',
    createdAt: 7,
    expiresAt: 600_007
};

const machine = (accepted = true) => {
    const calls: unknown[][] = [];
    const answer = async (requestId: string, choice: ComputerApprovalChoice): Promise<boolean> => {
        calls.push([requestId, choice]);
        return accepted;
    };
    return { calls, answer };
};

describe('a computer use card', () => {
    const card: PromptSubject = { kind: 'host', nodeId: 'chat-1', prompt: computerPrompt('chat-1', request) };

    test('offers Deny, Always allow and Allow this time, the last as the primary', () => {
        expect(computerButtons().map((button) => [button.label, button.primary, button.action])).toEqual([
            ['Deny', false, { kind: 'choose', choiceId: 'deny' }],
            ['Always allow', false, { kind: 'choose', choiceId: 'always' }],
            ['Allow this time', true, { kind: 'choose', choiceId: 'once' }]
        ]);
    });

    test('answers the machine with the choice, and a card that is gone is an error', async () => {
        const { calls, answer } = machine();
        const prompt = computerPrompt('chat-1', request);
        await answerRuimtePrompt(prompt, { kind: 'choose', choiceId: 'always' }, answer);
        expect(calls).toEqual([['computer-1', 'always']]);
        await expect(answerRuimtePrompt(prompt, { kind: 'choose', choiceId: 'once' }, machine(false).answer)).rejects.toThrow('already answered');
        await expect(answerRuimtePrompt(prompt, { kind: 'choose', choiceId: 'allow' }, answer)).rejects.toThrow();
        expect(calls).toHaveLength(1);
    });

    test('blocks, and is dated by when the agent first asked', () => {
        expect(isBlockingSubject(card)).toBe(true);
        expect(promptCreatedAt(card)).toBe(7);
        expect(promptIdOf(card)).toBe('computer:chat-1:computer-1');
    });

    test('stands for its request, so a card read again is the same card', () => {
        expect(ruimtePayloadOf(card)).toBe(ruimtePayloadOf({ kind: 'host', nodeId: 'chat-1', prompt: computerPrompt('chat-1', request) }));
    });
});

describe('a waiting terminal', () => {
    test('sends nothing, since only its TUI answers', async () => {
        const { calls, answer } = machine();
        await expect(answerRuimtePrompt(waitingPrompt('terminal-1', 1), { kind: 'choose', choiceId: 'allow' }, answer)).rejects.toThrow();
        expect(calls).toEqual([]);
    });

    test('keeps an id of its own beside a chat request of the same node', () => {
        const waiting: PromptSubject = { kind: 'host', nodeId: 'node', prompt: waitingPrompt('node', 5) };
        expect(promptIdOf(waiting)).toBe('waiting:node');
        expect(promptCreatedAt(waiting)).toBe(5);
        expect(isBlockingSubject(waiting)).toBe(true);
    });
});

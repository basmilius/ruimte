import { describe, expect, test } from 'bun:test';
import type { ComputerApprovalChoice, ProjectProposal, SecretRequest } from '@ruimte/contracts';
import { isBlockingSubject, promptCreatedAt, promptIdOf, type PromptSubject } from '@adecore/agents-react/prompts';
import { answerRuimtePrompt, computerButtons, computerPrompt, proposalPrompt, ruimtePayloadOf, secretPrompt, waitingPrompt } from '@/prompts/ruimte-prompts';
import type { ProposalAnswers } from '@/proposals/answer';
import type { SecretAnswers } from '@/secrets/answer';

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

function machine(accepted = true) {
    const calls: unknown[][] = [];
    const answer = async (requestId: string, choice: ComputerApprovalChoice): Promise<boolean> => {
        calls.push([requestId, choice]);
        return accepted;
    };
    return { calls, answer };
}

function secretMachine(accepted = true) {
    const calls: unknown[][] = [];
    const answers: SecretAnswers = {
        save: async (endpointId, requestId, value) => {
            calls.push(['save', endpointId, requestId, value]);
            return accepted;
        },
        decline: async (endpointId, requestId) => {
            calls.push(['decline', endpointId, requestId]);
            return accepted;
        }
    };
    return { calls, answers };
}

const NO_SECRETS = secretMachine().answers;

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
        await answerRuimtePrompt(prompt, { kind: 'choose', choiceId: 'always' }, answer, NO_SECRETS);
        expect(calls).toEqual([['computer-1', 'always']]);
        await expect(answerRuimtePrompt(prompt, { kind: 'choose', choiceId: 'once' }, machine(false).answer, NO_SECRETS)).rejects.toThrow('Already answered');
        await expect(answerRuimtePrompt(prompt, { kind: 'choose', choiceId: 'allow' }, answer, NO_SECRETS)).rejects.toThrow();
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
        await expect(answerRuimtePrompt(waitingPrompt('terminal-1', 1), { kind: 'choose', choiceId: 'allow' }, answer, NO_SECRETS)).rejects.toThrow();
        expect(calls).toEqual([]);
    });

    test('keeps an id of its own beside a chat request of the same node', () => {
        const waiting: PromptSubject = { kind: 'host', nodeId: 'node', prompt: waitingPrompt('node', 5) };
        expect(promptIdOf(waiting)).toBe('waiting:node');
        expect(promptCreatedAt(waiting)).toBe(5);
        expect(isBlockingSubject(waiting)).toBe(true);
    });
});

describe('a secret card', () => {
    const secret: SecretRequest = {
        requestId: 'secret-1',
        nodeId: 'chat-1',
        projectId: 'p1',
        launchId: 'api',
        launchName: 'API',
        variable: 'API_KEY',
        label: 'Stripe test key',
        reason: 'Checkout calls Stripe',
        replaces: false,
        createdAt: 9,
        expiresAt: 900_009
    };
    const card: PromptSubject = { kind: 'host', nodeId: 'chat-1', prompt: secretPrompt('m1', 'chat-1', secret) };

    test('saves the typed value to the machine that asked, or declines', async () => {
        const { calls, answers } = secretMachine();
        const prompt = secretPrompt('m1', 'chat-1', secret);
        await answerRuimtePrompt(prompt, { kind: 'answer', answers: { value: 'sk_test_1' } }, machine().answer, answers);
        await answerRuimtePrompt(prompt, { kind: 'choose', choiceId: 'decline' }, machine().answer, answers);
        expect(calls).toEqual([
            ['save', 'm1', 'secret-1', 'sk_test_1'],
            ['decline', 'm1', 'secret-1']
        ]);
    });

    test('an empty value sends nothing, and a card that is gone is an error', async () => {
        const { calls, answers } = secretMachine(false);
        const prompt = secretPrompt('m1', 'chat-1', secret);
        await expect(answerRuimtePrompt(prompt, { kind: 'answer', answers: { value: '' } }, machine().answer, answers)).rejects.toThrow();
        expect(calls).toEqual([]);
        await expect(answerRuimtePrompt(prompt, { kind: 'choose', choiceId: 'decline' }, machine().answer, answers)).rejects.toThrow('Already answered');
    });

    test('blocks, is dated by when the agent asked, and stands for its request', () => {
        expect(isBlockingSubject(card)).toBe(true);
        expect(promptCreatedAt(card)).toBe(9);
        expect(promptIdOf(card)).toBe('secret:chat-1:secret-1');
        expect(ruimtePayloadOf(card)).toBe(secret);
    });
});

describe('a project suggestion card', () => {
    const proposal: ProjectProposal = { proposalId: 'proposal-1', chatId: 'chat-1', name: 'Vinyl shelf', reason: 'It grew', createdAt: 11, expiresAt: 99 };
    const card: PromptSubject = { kind: 'host', nodeId: 'chat-1', prompt: proposalPrompt('m1', 'chat-1', proposal) };

    function proposalMachine(accepted = true) {
        const calls: unknown[][] = [];
        const answers: ProposalAnswers = {
            decline: async (endpointId, proposalId) => {
                calls.push(['decline', endpointId, proposalId]);
                return accepted;
            }
        };
        return { calls, answers };
    }

    test('declines at the machine that holds the card, and a card that is gone is an error', async () => {
        const { calls, answers } = proposalMachine();
        await answerRuimtePrompt(card.prompt, { kind: 'choose', choiceId: 'decline' }, machine().answer, NO_SECRETS, answers);
        expect(calls).toEqual([['decline', 'm1', 'proposal-1']]);
        const gone = proposalMachine(false);
        await expect(answerRuimtePrompt(card.prompt, { kind: 'choose', choiceId: 'decline' }, machine().answer, NO_SECRETS, gone.answers)).rejects.toThrow(
            'Already answered'
        );
    });

    test('sends nothing for any other choice', async () => {
        const { calls, answers } = proposalMachine();
        await expect(answerRuimtePrompt(card.prompt, { kind: 'choose', choiceId: 'review' }, machine().answer, NO_SECRETS, answers)).rejects.toThrow();
        expect(calls).toEqual([]);
    });

    test('blocks, is dated by when the agent suggested, and stands for its proposal', () => {
        expect(isBlockingSubject(card)).toBe(true);
        expect(promptCreatedAt(card)).toBe(11);
        expect(promptIdOf(card)).toBe('project-proposal:chat-1:proposal-1');
        expect(ruimtePayloadOf(card)).toBe(proposal);
    });
});

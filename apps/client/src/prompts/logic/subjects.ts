import i18next from 'i18next';
import type { ApprovalChoice, ApprovalRequest, ComputerApproval, ComputerApprovalChoice } from '@ruimte/contracts';
import { isBlockingPrompt, type PendingPrompt, type PromptAction } from '@/prompts/logic/prompts';

/* What a prompt card draws, whatever asked it. The chat's items pass through unchanged. */
export type PromptSubject =
    | { kind: 'chat'; nodeId: string; item: PendingPrompt }
    // A terminal's permission request, drawn as a chat's: the summary as the command, its choices as the buttons.
    | { kind: 'terminal-approval'; nodeId: string; request: ApprovalRequest }
    // Only its TUI can answer; the card offers the way there.
    | { kind: 'terminal-waiting'; nodeId: string; since: number }
    // An agent in a chat or a terminal wants to operate an app of the machine; the machine asks, not the CLI.
    | { kind: 'computer-approval'; nodeId: string; request: ComputerApproval };

/* The requests a subject can send, as the clients that send them have them. */
export interface PromptClients {
    chat: {
        approve(chatId: string, requestId: string, decision: 'allow' | 'allow-always' | 'deny', message?: string): Promise<void>;
        answer(chatId: string, requestId: string, answers: Record<string, string>): Promise<void>;
        dismiss(chatId: string, itemId: string): Promise<void>;
    } | null;
    sessions: {
        answerApproval(nodeId: string, requestId: string, choiceId: string): Promise<boolean>;
    } | null;
    computer: {
        answer(requestId: string, choice: ComputerApprovalChoice): Promise<boolean>;
    } | null;
}

const COMPUTER_CHOICES: readonly string[] = ['once', 'always', 'deny'] satisfies ComputerApprovalChoice[];

const isComputerChoice = (choiceId: string): choiceId is ComputerApprovalChoice => COMPUTER_CHOICES.includes(choiceId);

export interface ApprovalButtonSpec {
    id: string;
    label: string;
    description?: string;
    primary: boolean;
    action: PromptAction;
}

/* Unique across the chats and terminals of a canvas, and stable while the prompt waits. */
export const promptIdOf = (subject: PromptSubject): string => {
    switch (subject.kind) {
        case 'chat':
            return `chat:${subject.nodeId}:${subject.item.requestId}`;
        case 'terminal-approval':
            return `terminal:${subject.nodeId}:${subject.request.requestId}`;
        case 'terminal-waiting':
            return `waiting:${subject.nodeId}`;
        case 'computer-approval':
            return `computer:${subject.nodeId}:${subject.request.requestId}`;
    }
};

export const promptCreatedAt = (subject: PromptSubject): number => {
    switch (subject.kind) {
        case 'chat':
            return subject.item.createdAt;
        case 'terminal-approval':
            return subject.request.createdAt;
        case 'terminal-waiting':
            return subject.since;
        case 'computer-approval':
            return subject.request.createdAt;
    }
};

/* A terminal is held up by whatever it asks, so only a chat's optional question counts as not blocking. */
export const isBlockingSubject = (subject: PromptSubject): boolean => subject.kind !== 'chat' || isBlockingPrompt(subject.item);

const CHOICE_ORDER: Record<ApprovalChoice['kind'], number> = { remember: 0, deny: 1, allow: 2 };

/* The buttons of a permission request in the order a chat draws them: a remembered rule, Deny, then Allow as the primary. */
export const approvalButtons = (subject: PromptSubject, reason: string): ApprovalButtonSpec[] => {
    if (subject.kind === 'terminal-approval') {
        return [...subject.request.choices]
            .sort((a, b) => CHOICE_ORDER[a.kind] - CHOICE_ORDER[b.kind])
            .map((choice) => ({ id: choice.id, label: choice.label, primary: choice.kind === 'allow', action: { kind: 'choose', choiceId: choice.id } }));
    }
    if (subject.kind === 'computer-approval') {
        const choose = (choiceId: ComputerApprovalChoice) => ({ kind: 'choose', choiceId }) as const;
        return [
            { id: 'deny', label: i18next.t('prompts:computer.deny'), primary: false, action: choose('deny') },
            { id: 'always', label: i18next.t('prompts:computer.always'), primary: false, action: choose('always') },
            { id: 'once', label: i18next.t('prompts:computer.once'), primary: true, action: choose('once') }
        ];
    }
    if (subject.kind !== 'chat' || subject.item.kind !== 'approval') {
        return [];
    }
    const { item } = subject;
    const message = reason.trim();
    return [
        ...(item.canAllowAlways && item.allowAlways
            ? [
                  {
                      id: 'allow-always',
                      label: item.allowAlways.label,
                      description: item.allowAlways.description,
                      primary: false,
                      action: { kind: 'approve', decision: 'allow-always' } as const
                  }
              ]
            : []),
        {
            id: 'deny',
            label: i18next.t('prompts:approval.deny'),
            primary: false,
            action: { kind: 'approve', decision: 'deny', ...(message ? { message } : {}) }
        },
        { id: 'allow', label: i18next.t('prompts:approval.allow'), primary: true, action: { kind: 'approve', decision: 'allow' } }
    ];
};

/* Sends a card's action as the request its subject is answered with. A refusal comes back as an error for the card to show. */
export const answerPrompt = async (subject: PromptSubject, action: PromptAction, clients: PromptClients): Promise<void> => {
    if (subject.kind === 'chat') {
        const { chat } = clients;
        if (chat === null) {
            throw new Error(i18next.t('prompts:error.notConnected'));
        }
        const { item, nodeId } = subject;
        if (action.kind === 'approve') {
            return chat.approve(nodeId, item.requestId, action.decision, action.message);
        }
        if (action.kind === 'answer') {
            return chat.answer(nodeId, item.requestId, action.answers);
        }
        if (action.kind === 'dismiss') {
            return chat.dismiss(nodeId, item.id);
        }
        throw new Error(i18next.t('prompts:error.noChoices'));
    }
    if (subject.kind === 'terminal-waiting' || action.kind !== 'choose') {
        throw new Error(i18next.t('prompts:error.terminalOnly'));
    }
    if (subject.kind === 'computer-approval') {
        const { computer } = clients;
        if (computer === null) {
            throw new Error(i18next.t('prompts:error.notConnected'));
        }
        if (!isComputerChoice(action.choiceId) || !(await computer.answer(subject.request.requestId, action.choiceId))) {
            throw new Error(i18next.t('prompts:error.expired'));
        }
        return;
    }
    const { sessions } = clients;
    if (sessions === null) {
        throw new Error(i18next.t('prompts:error.notConnected'));
    }
    if (!(await sessions.answerApproval(subject.nodeId, subject.request.requestId, action.choiceId))) {
        throw new Error(i18next.t('prompts:error.expired'));
    }
};

import i18next from 'i18next';
import type { ReactNode } from 'react';
import { chatHost } from '../../host';
import { isBlockingPrompt, type PendingPrompt, type PromptAction, type PromptDraft } from './prompts';

/*
 * A prompt the app raises beside a chat's own requests, such as its own approval to operate
 * something. The app draws it and answers it (`ChatHost.prompts`); the chat only orders it among the
 * rest and keeps its draft.
 */
export interface HostPrompt {
    /* Unique across the prompts of a surface, and stable while the prompt waits. */
    id: string;
    createdAt: number;
    blocking: boolean;
    /* The mark a pointer to it wears: a hand for a request, a question mark for anything else. */
    asks: 'approval' | 'question';
    /* What the app knows about it, for its own drawing and answering; the same object while nothing about it changed. */
    data: unknown;
}

/* What a prompt card draws, whatever asked it. The chat's items pass through unchanged. */
export type PromptSubject = { kind: 'chat'; nodeId: string; item: PendingPrompt } | { kind: 'host'; nodeId: string; prompt: HostPrompt };

/* The requests a chat's own prompts are answered with. */
export interface ChatPromptClients {
    approve(chatId: string, requestId: string, decision: 'allow' | 'allow-always' | 'deny', message?: string): Promise<void>;
    answer(chatId: string, requestId: string, answers: Record<string, string>): Promise<void>;
    dismiss(chatId: string, itemId: string): Promise<void>;
}

/* What a card is given to draw, the chat's and the app's alike. */
export interface PromptViewProps {
    subject: PromptSubject;
    draft: PromptDraft;
    onDraft(draft: PromptDraft): void;
    onAction(action: PromptAction): void;
    more: number;
    hasDraft: boolean;
    denyReason: boolean;
    disabled: boolean;
    sending: boolean;
    error: string | null;
    top?: ReactNode;
    /* Takes the person to whatever an app's own card is about. */
    onReveal?: () => void;
}

export interface ApprovalButtonSpec {
    id: string;
    label: string;
    description?: string;
    primary: boolean;
    action: PromptAction;
}

/* Unique across the chats of a surface and the app's own prompts, and stable while the prompt waits. */
export const promptIdOf = (subject: PromptSubject): string =>
    subject.kind === 'chat' ? `chat:${subject.nodeId}:${subject.item.requestId}` : subject.prompt.id;

export const promptCreatedAt = (subject: PromptSubject): number => (subject.kind === 'chat' ? subject.item.createdAt : subject.prompt.createdAt);

/* Only a chat's optional question does not hold anything up; the app says so of its own. */
export const isBlockingSubject = (subject: PromptSubject): boolean => (subject.kind === 'chat' ? isBlockingPrompt(subject.item) : subject.prompt.blocking);

/* The buttons of a chat's permission request in the order it draws them: a remembered rule, Deny, then Allow as the primary. */
export const approvalButtons = (subject: PromptSubject, reason: string): ApprovalButtonSpec[] => {
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
            label: i18next.t('agent-prompts:approval.deny'),
            primary: false,
            action: { kind: 'approve', decision: 'deny', ...(message ? { message } : {}) }
        },
        { id: 'allow', label: i18next.t('agent-prompts:approval.allow'), primary: true, action: { kind: 'approve', decision: 'allow' } }
    ];
};

/* Sends a card's action as the request its subject is answered with. A refusal comes back as an error for the card to show. */
export const answerPrompt = async (subject: PromptSubject, action: PromptAction, chat: ChatPromptClients | null): Promise<void> => {
    if (subject.kind === 'host') {
        return chatHost().prompts.answer(subject.prompt, action);
    }
    if (chat === null) {
        throw new Error(i18next.t('agent-prompts:error.notConnected'));
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
    throw new Error(i18next.t('agent-prompts:error.noChoices'));
};

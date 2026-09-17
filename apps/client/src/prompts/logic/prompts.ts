import type { ChatApprovalItem, ChatQuestionItem, ChatQuestion } from '@ruimte/contracts';
import { toggleChoice } from '@/chat/logic/answers';

export type PendingPrompt = ChatApprovalItem | ChatQuestionItem;
export type PromptAction =
    | { kind: 'approve'; decision: 'allow' | 'allow-always' | 'deny'; message?: string }
    | { kind: 'answer'; answers: Record<string, string> }
    | { kind: 'dismiss' };
export interface PromptAnswer {
    choices: string[];
    text: string;
    custom: boolean;
}
export interface PromptDraft {
    index: number;
    answers: Record<string, PromptAnswer>;
    reason: string;
    showReason: boolean;
}

export const emptyPromptDraft = (): PromptDraft => ({ index: 0, answers: {}, reason: '', showReason: false });
export const answerValue = (answer: PromptAnswer): string => (answer.custom ? answer.text.trim() : answer.choices.join(', '));
export const questionAnswer = (draft: PromptDraft, question: ChatQuestion): PromptAnswer =>
    draft.answers[question.id] ?? { choices: [], text: '', custom: question.choices.length === 0 };

export function pickPromptChoice(answer: PromptAnswer, question: ChatQuestion, label: string): PromptAnswer {
    return { ...answer, custom: false, choices: question.multiSelect ? toggleChoice(answer.choices, label) : [label] };
}

export function nextPrompt(items: PendingPrompt[], activeId: string | null): PendingPrompt | null {
    const active = items.find((item) => item.requestId === activeId);
    if (active) {
        return active;
    }
    const blocking = items.filter((item) => item.kind === 'approval' || !item.async);
    return [...(blocking.length ? blocking : items)].sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
}

export function promptAnswers(item: ChatQuestionItem, draft: PromptDraft): Record<string, string> | null {
    const answers = Object.fromEntries(item.questions.map((question) => [question.id, answerValue(questionAnswer(draft, question))]));
    return Object.values(answers).every((answer) => answer !== '') ? answers : null;
}

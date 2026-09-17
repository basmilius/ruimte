import type { ReactNode } from 'react';
import { toolSummary } from '@/chat/logic/tools';
import { answerValue, promptAnswers, questionAnswer, type PromptAction, type PromptDraft } from '@/prompts/logic/prompts';
import { approvalButtons, type PromptSubject } from '@/prompts/logic/subjects';
import { ApprovalBody, CommandBox } from '@/prompts/ui/ApprovalBody';
import { ApprovalActions, PromptPrimary, QuestionActions } from '@/prompts/ui/PromptActions';
import { PromptCard } from '@/prompts/ui/PromptCard';
import { QuestionBody } from '@/prompts/ui/QuestionBody';

interface Props {
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
    /* Takes the person to the terminal a waiting card is about. */
    onReveal?: () => void;
}

/* A permission request or question, answered in place: a chat's, or a terminal's drawn the same way. */
export function PromptView({ subject, draft, onDraft, onAction, more, hasDraft, denyReason, disabled, sending, error, top, onReveal }: Props) {
    const locked = sending || disabled;
    const buttons = approvalButtons(subject, draft.reason).map(({ action, ...button }) => ({ ...button, onPress: () => onAction(action) }));

    if (subject.kind === 'terminal-waiting') {
        return (
            <PromptCard
                kind="waiting"
                heading="Waiting for you in its terminal"
                top={top}
                busy={false}
                disabled={false}
                error={null}
                actions={
                    <div className="ml-auto flex items-center">
                        <PromptPrimary onClick={onReveal}>Go to terminal</PromptPrimary>
                    </div>
                }
            >
                <p className="text-sm text-text-muted">This question can only be answered in the terminal.</p>
            </PromptCard>
        );
    }

    if (subject.kind === 'terminal-approval') {
        const { request } = subject;
        return (
            <PromptCard
                kind="approval"
                heading={request.toolName === 'Bash' ? 'Run command' : request.toolName}
                top={top}
                busy={sending}
                disabled={disabled}
                error={error}
                actions={<ApprovalActions buttons={buttons} locked={locked} sending={sending} />}
            >
                {request.summary !== '' && <CommandBox command={request.summary} />}
            </PromptCard>
        );
    }

    const { item } = subject;
    const question = item.kind === 'question' ? item.questions[Math.min(draft.index, item.questions.length - 1)]! : null;
    const answer = question ? questionAnswer(draft, question) : null;
    const last = item.kind === 'question' && draft.index === item.questions.length - 1;
    // Whether Next or Answer may go with this draft: the keys ask it as well as the button.
    const readyWith = (next: PromptDraft): boolean =>
        item.kind === 'question' && !!question && !!answerValue(questionAnswer(next, question)) && !(last && !promptAnswers(item, next));
    const commit = (next: PromptDraft) => {
        if (item.kind !== 'question' || locked || !readyWith(next)) {
            return;
        }
        if (!last) {
            onDraft({ ...next, index: next.index + 1 });
        } else {
            const answers = promptAnswers(item, next);
            if (answers) {
                onAction({ kind: 'answer', answers });
            }
        }
    };
    const multiple = item.kind === 'question' && item.questions.length > 1;
    const meta =
        more > 0 || hasDraft || multiple ? (
            <>
                {more > 0 && <span className="tabular-nums">{more + 1} requests waiting</span>}
                {multiple && (
                    <span className="tabular-nums">
                        Question {draft.index + 1} of {item.questions.length}
                    </span>
                )}
                {hasDraft && <span>Draft saved</span>}
            </>
        ) : null;

    if (item.kind === 'approval') {
        return (
            <PromptCard
                kind="approval"
                heading={`${item.toolName === 'Bash' ? 'Run command' : item.toolName} ${item.toolName === 'Bash' ? '' : toolSummary(item.toolName, item.input)}`}
                meta={meta}
                top={top}
                busy={sending}
                disabled={disabled}
                error={error}
                actions={
                    <ApprovalActions
                        buttons={buttons}
                        onAddReason={denyReason && !draft.showReason ? () => onDraft({ ...draft, showReason: true }) : undefined}
                        locked={locked}
                        sending={sending}
                    />
                }
            >
                <ApprovalBody item={item} draft={draft} onDraft={onDraft} denyReason={denyReason} locked={locked} />
            </PromptCard>
        );
    }

    return (
        <PromptCard
            kind="question"
            heading={question?.question}
            meta={meta}
            top={top}
            busy={sending}
            disabled={disabled}
            error={error}
            actions={
                <QuestionActions
                    index={draft.index}
                    dismissable={item.async === true}
                    last={last}
                    ready={readyWith(draft)}
                    locked={locked}
                    sending={sending}
                    onPrevious={() => onDraft({ ...draft, index: draft.index - 1 })}
                    onDismiss={() => onAction({ kind: 'dismiss' })}
                    onCommit={() => commit(draft)}
                />
            }
        >
            {question && answer && (
                <QuestionBody
                    question={question}
                    answer={answer}
                    onAnswer={(next) => onDraft({ ...draft, answers: { ...draft.answers, [question.id]: next } })}
                    onCommit={(next) => commit({ ...draft, answers: { ...draft.answers, [question.id]: next } })}
                    locked={locked}
                />
            )}
        </PromptCard>
    );
}

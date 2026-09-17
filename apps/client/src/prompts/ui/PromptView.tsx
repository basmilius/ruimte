import type { ReactNode } from 'react';
import { toolSummary } from '@/chat/logic/tools';
import { answerValue, promptAnswers, questionAnswer, type PendingPrompt, type PromptAction, type PromptDraft } from '@/prompts/logic/prompts';
import { ApprovalBody } from '@/prompts/ui/ApprovalBody';
import { ApprovalActions, QuestionActions, type ApprovalButton } from '@/prompts/ui/PromptActions';
import { PromptCard } from '@/prompts/ui/PromptCard';
import { QuestionBody } from '@/prompts/ui/QuestionBody';

interface Props {
    item: PendingPrompt;
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
}

/* A chat's permission request or question, answered in place. */
export function PromptView({ item, draft, onDraft, onAction, more, hasDraft, denyReason, disabled, sending, error, top }: Props) {
    const question = item.kind === 'question' ? item.questions[Math.min(draft.index, item.questions.length - 1)]! : null;
    const answer = question ? questionAnswer(draft, question) : null;
    const locked = sending || disabled;
    const last = item.kind === 'question' && draft.index === item.questions.length - 1;
    const approve = (decision: 'allow' | 'allow-always' | 'deny') =>
        onAction({ kind: 'approve', decision, ...(decision === 'deny' && draft.reason.trim() ? { message: draft.reason.trim() } : {}) });
    const commit = () => {
        if (item.kind !== 'question') {
            return;
        }
        if (!last) {
            onDraft({ ...draft, index: draft.index + 1 });
        } else {
            const answers = promptAnswers(item, draft);
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
        const buttons: ApprovalButton[] = [
            ...(item.canAllowAlways && item.allowAlways
                ? [
                      {
                          id: 'allow-always',
                          label: item.allowAlways.label,
                          description: item.allowAlways.description,
                          primary: false,
                          onPress: () => approve('allow-always')
                      }
                  ]
                : []),
            { id: 'deny', label: 'Deny', primary: false, onPress: () => approve('deny') },
            { id: 'allow', label: 'Allow', primary: true, onPress: () => approve('allow') }
        ];
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
                    ready={!!answer && !!answerValue(answer) && !(last && !promptAnswers(item, draft))}
                    locked={locked}
                    sending={sending}
                    onPrevious={() => onDraft({ ...draft, index: draft.index - 1 })}
                    onDismiss={() => onAction({ kind: 'dismiss' })}
                    onCommit={commit}
                />
            }
        >
            {question && answer && (
                <QuestionBody
                    question={question}
                    answer={answer}
                    onAnswer={(next) => onDraft({ ...draft, answers: { ...draft.answers, [question.id]: next } })}
                    locked={locked}
                />
            )}
        </PromptCard>
    );
}

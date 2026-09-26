import { useTranslation } from 'react-i18next';
import { toolSummary } from '../../chat/logic/tools';
import { chatHost } from '../../host';
import { answerValue, promptAnswers, questionAnswer, type PromptDraft } from '../logic/prompts';
import { approvalButtons, type PromptViewProps } from '../logic/subjects';
import { ApprovalBody } from './ApprovalBody';
import { ApprovalActions, QuestionActions } from './PromptActions';
import { PromptCard } from './PromptCard';
import { QuestionBody } from './QuestionBody';

/* A permission request or question, answered in place: a chat's, or one of the app's own that it draws itself. */
export function PromptView(props: PromptViewProps) {
    const { subject, draft, onDraft, onAction, more, hasDraft, denyReason, disabled, sending, error, top } = props;
    const { t } = useTranslation('agent-prompts');
    const locked = sending || disabled;
    const notice = disabled ? t('error.notConnected') : null;
    const buttons = approvalButtons(subject, draft.reason).map(({ action, ...button }) => ({ ...button, onPress: () => onAction(action) }));

    if (subject.kind === 'host') {
        return chatHost().prompts.render(subject.prompt, props);
    }

    const { item } = subject;
    const question = item.kind === 'question' ? item.questions[Math.min(draft.index, item.questions.length - 1)]! : null;
    const answer = question ? questionAnswer(draft, question) : null;
    const last = item.kind === 'question' && draft.index === item.questions.length - 1;
    // Whether Next or Answer may go with this draft. The keys ask it as well as the button.
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
                {more > 0 && <span className="tabular-nums">{t('meta.waiting', { count: more + 1 })}</span>}
                {multiple && <span className="tabular-nums">{t('meta.question', { index: draft.index + 1, total: item.questions.length })}</span>}
                {hasDraft && <span>{t('meta.draftSaved')}</span>}
            </>
        ) : null;

    if (item.kind === 'approval') {
        return (
            <PromptCard
                kind="approval"
                heading={`${item.toolName === 'Bash' ? t('approval.runCommand') : item.toolName} ${item.toolName === 'Bash' ? '' : toolSummary(item.toolName, item.input)}`}
                meta={meta}
                top={top}
                busy={sending}
                notice={notice}
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
            notice={notice}
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

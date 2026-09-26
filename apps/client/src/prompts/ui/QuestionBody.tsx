import { DictationTextarea } from '@/dictation/DictationTextarea';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Circle, CircleCheck, Square } from 'lucide-react';
import type { ChatQuestion } from '@ruimte/contracts';
import { answerFieldKey, choiceKey, stepIndex } from '@/prompts/logic/keys';
import { pickPromptChoice, type PromptAnswer } from '@/prompts/logic/prompts';
import { Icon } from '@ruimte/ui/Icon';

/* One question of a request: its choices, "Something else…", or a written answer when it offers no choices. */
export function QuestionBody({
    question,
    answer,
    onAnswer,
    onCommit,
    locked
}: {
    question: ChatQuestion;
    answer: PromptAnswer;
    onAnswer(answer: PromptAnswer): void;
    /* Next or Answer with this answer in place, when the question allows it. */
    onCommit(answer: PromptAnswer): void;
    locked: boolean;
}) {
    const { t } = useTranslation('prompts');
    // The choices, then the "Something else…" field form one list with a single tab stop.
    const items = useRef<(HTMLElement | null)[]>([]);
    const shownQuestion = useRef(question.id);
    const count = question.choices.length + 1;
    const chosen = question.choices.findIndex((choice) => !answer.custom && answer.choices.includes(choice.label));
    const tabStop = chosen !== -1 ? chosen : answer.custom ? question.choices.length : 0;

    // The focused choice of the question before is gone once the next one shows; the keyboard goes on in this one.
    useEffect(() => {
        if (shownQuestion.current === question.id) {
            return;
        }
        shownQuestion.current = question.id;
        if (document.activeElement === null || document.activeElement === document.body) {
            (items.current[tabStop] ?? items.current[0])?.focus({ preventScroll: true });
        }
    }, [question.id, tabStop]);

    const onChoiceKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, label: string) => {
        const action = choiceKey(event.nativeEvent, {
            multiSelect: question.multiSelect,
            anyChosen: !answer.custom && answer.choices.length > 0
        });
        if (action === null) {
            return;
        }
        event.preventDefault();
        if (action.kind === 'move') {
            items.current[stepIndex(index, count, action.to)]?.focus();
        } else if (action.kind === 'commit') {
            onCommit(answer);
        } else {
            const next = pickPromptChoice(answer, question, label);
            onAnswer(next);
            if (action.kind === 'pick-and-commit') {
                onCommit(next);
            }
        }
    };

    const onFieldKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        const field = event.currentTarget;
        const action = answerFieldKey(event.nativeEvent, {
            belowChoices: question.choices.length > 0,
            caretAtStart: field.selectionStart === 0 && field.selectionEnd === 0,
            hasText: field.value.trim() !== ''
        });
        if (action === null) {
            return;
        }
        event.preventDefault();
        if (action.kind === 'to-last-choice') {
            items.current[question.choices.length - 1]?.focus();
        } else if (action.kind === 'commit') {
            onCommit({ ...answer, custom: true });
        }
    };

    return (
        <div className="flex flex-col gap-2">
            {question.multiSelect && <p className="text-xs text-text-muted">{t('question.multiSelect')}</p>}
            {question.choices.length > 0 && (
                <div role={question.multiSelect ? 'group' : 'radiogroup'} aria-label={question.question} className="flex flex-col gap-2">
                    {question.choices.map((choice, index) => {
                        const selected = !answer.custom && answer.choices.includes(choice.label);
                        return (
                            <button
                                key={choice.label}
                                ref={(element) => {
                                    items.current[index] = element;
                                }}
                                type="button"
                                role={question.multiSelect ? 'checkbox' : 'radio'}
                                aria-checked={selected}
                                tabIndex={index === tabStop ? 0 : -1}
                                data-prompt-entry={index === tabStop ? '' : undefined}
                                disabled={locked}
                                className={clsx(
                                    'flex min-h-9 items-start gap-2 rounded-lg border px-3 py-2 text-left disabled:opacity-50',
                                    selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface-hover hover:bg-surface-active'
                                )}
                                onClick={() => onAnswer(pickPromptChoice(answer, question, choice.label))}
                                onKeyDown={(event) => onChoiceKeyDown(event, index, choice.label)}
                            >
                                <Icon
                                    icon={selected ? CircleCheck : question.multiSelect ? Square : Circle}
                                    size={16}
                                    className="mt-0.5 shrink-0 text-text-muted"
                                />
                                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                                    <span className="text-xs text-text">{choice.label}</span>
                                    {choice.description && <span className="text-xs text-text-muted">{choice.description}</span>}
                                </span>
                            </button>
                        );
                    })}
                    <label
                        className={clsx(
                            'flex min-h-9 items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs text-text focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent',
                            answer.custom ? 'border-accent bg-accent-soft' : 'border-border bg-surface-hover',
                            locked && 'opacity-50'
                        )}
                        // A press picks the row; the keyboard only passing through on its way up or down does not.
                        onPointerDown={() => {
                            if (!locked && !answer.custom) {
                                onAnswer({ ...answer, custom: true });
                            }
                        }}
                    >
                        <Icon icon={answer.custom ? CircleCheck : Circle} size={16} className="mt-0.5 shrink-0" />
                        <DictationTextarea
                            ref={(element) => {
                                items.current[question.choices.length] = element;
                            }}
                            rows={1}
                            tabIndex={tabStop === question.choices.length ? 0 : -1}
                            data-prompt-entry={tabStop === question.choices.length ? '' : undefined}
                            className="max-h-40 min-w-0 flex-1 resize-none field-sizing-content bg-transparent outline-none placeholder:text-text-muted"
                            buttonClassName="-my-1 -mr-1.5"
                            aria-label={t('question.answerLabel')}
                            placeholder={t('question.somethingElse')}
                            value={answer.text}
                            disabled={locked}
                            onChange={(e) => onAnswer({ ...answer, custom: true, text: e.target.value })}
                            onKeyDown={onFieldKeyDown}
                        />
                    </label>
                </div>
            )}
            {question.choices.length === 0 && (
                <DictationTextarea
                    ref={(element) => {
                        items.current[0] = element;
                    }}
                    className="field min-h-20 text-sm"
                    aria-label={t('question.answerLabel')}
                    placeholder={t('question.answerPlaceholder')}
                    data-prompt-entry=""
                    value={answer.text}
                    disabled={locked}
                    onChange={(e) => onAnswer({ ...answer, text: e.target.value })}
                    onKeyDown={onFieldKeyDown}
                />
            )}
        </div>
    );
}

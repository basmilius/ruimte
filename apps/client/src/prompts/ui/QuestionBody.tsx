import clsx from 'clsx';
import { Circle, CircleCheck, Square } from 'lucide-react';
import type { ChatQuestion } from '@ruimte/contracts';
import { pickPromptChoice, type PromptAnswer } from '@/prompts/logic/prompts';
import { Icon } from '@/ui/Icon';

/* One question of a request: its choices, "Something else…", or a written answer when it offers no choices. */
export function QuestionBody({
    question,
    answer,
    onAnswer,
    locked
}: {
    question: ChatQuestion;
    answer: PromptAnswer;
    onAnswer(answer: PromptAnswer): void;
    locked: boolean;
}) {
    return (
        <div className="flex flex-col gap-2">
            {question.multiSelect && <p className="text-xs text-text-muted">Choose one or more</p>}
            {question.choices.map((choice) => {
                const selected = !answer.custom && answer.choices.includes(choice.label);
                return (
                    <button
                        key={choice.label}
                        disabled={locked}
                        aria-pressed={selected}
                        className={clsx(
                            'flex min-h-9 items-start gap-2 rounded-lg border px-3 py-2 text-left disabled:opacity-50',
                            selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface-hover hover:bg-surface-active'
                        )}
                        onClick={() => onAnswer(pickPromptChoice(answer, question, choice.label))}
                    >
                        <Icon icon={selected ? CircleCheck : question.multiSelect ? Square : Circle} size={16} className="mt-0.5 shrink-0 text-text-muted" />
                        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                            <span className="text-xs text-text">{choice.label}</span>
                            {choice.description && <span className="text-xs text-text-muted">{choice.description}</span>}
                        </span>
                    </button>
                );
            })}
            {question.choices.length > 0 && (
                <label
                    className={clsx(
                        'flex min-h-9 items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs text-text',
                        answer.custom ? 'border-accent bg-accent-soft' : 'border-border bg-surface-hover',
                        locked && 'opacity-50'
                    )}
                >
                    <Icon icon={answer.custom ? CircleCheck : Circle} size={16} className="mt-0.5 shrink-0" />
                    <textarea
                        rows={1}
                        className="max-h-40 min-w-0 flex-1 resize-none field-sizing-content bg-transparent outline-none placeholder:text-text-muted"
                        aria-label="Your answer"
                        placeholder="Something else…"
                        value={answer.text}
                        disabled={locked}
                        onFocus={() => onAnswer({ ...answer, custom: true })}
                        onChange={(e) => onAnswer({ ...answer, custom: true, text: e.target.value })}
                    />
                </label>
            )}
            {question.choices.length === 0 && (
                <textarea
                    className="field min-h-20 text-sm"
                    aria-label="Your answer"
                    placeholder="Your answer"
                    value={answer.text}
                    disabled={locked}
                    onChange={(e) => onAnswer({ ...answer, text: e.target.value })}
                />
            )}
        </div>
    );
}

import { Suspense, lazy, useState, type ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import { ArrowUp, Circle, CircleCheck, Hand, MessageCircleQuestionMark, Square } from 'lucide-react';
import type { ChatApprovalItem } from '@ruimte/contracts';
import { answerValue, pickPromptChoice, promptAnswers, questionAnswer, type PendingPrompt, type PromptDraft } from '@/chat/logic/prompts';
import { approvalChanges, fileChanges, toolSummary } from '@/chat/logic/tools';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

const EditDiff = lazy(() => import('@/chat/ui/EditDiff'));
const UnifiedDiff = lazy(() => import('@/chat/ui/UnifiedDiff'));

export type PromptAction =
    | { kind: 'approve'; decision: 'allow' | 'allow-always' | 'deny'; message?: string }
    | { kind: 'answer'; answers: Record<string, string> }
    | { kind: 'dismiss' };

function PromptPrimary(props: ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type="button"
            className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full bg-text px-2.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
            {...props}
        />
    );
}

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
}

function ApprovalDetails({ item }: { item: ChatApprovalItem }) {
    const [expanded, setExpanded] = useState(false);
    const patches = approvalChanges(item.input);
    const edits = patches.length ? [] : fileChanges(item.toolName, item.input);
    const input = typeof item.input === 'object' && item.input !== null ? (item.input as Record<string, unknown>) : {};
    return (
        <>
            {item.description && <p className="text-sm text-text-muted">{item.description}</p>}
            {patches.length + edits.length > 1 && (
                <p className="text-xs text-text-muted">Allow applies to all {patches.length + edits.length} changes in this request.</p>
            )}
            {patches.length + edits.length > 0 ? (
                <div className="overflow-hidden rounded-xl bg-surface-sunken">
                    <div className={clsx('overflow-auto', !expanded && 'max-h-44')}>
                        <Suspense fallback={<p className="p-3 text-xs text-text-muted">Loading diff…</p>}>
                            {patches.map((change, i) => (
                                <UnifiedDiff key={i} change={change} />
                            ))}
                            {edits.map((change, i) => (
                                <EditDiff key={i} change={change} />
                            ))}
                        </Suspense>
                    </div>
                    <div className="flex items-center border-t border-border p-1">
                        <Button size="sm" className="rounded-full!" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                            {expanded ? 'Collapse diff' : 'View full diff'}
                        </Button>
                    </div>
                </div>
            ) : typeof input.command === 'string' ? (
                <div className="rounded-xl bg-surface-sunken p-3">
                    {typeof input.cwd === 'string' && <p className="mb-2 break-all font-mono text-xs text-text-muted">{input.cwd}</p>}
                    <pre className="whitespace-pre-wrap break-words font-mono text-code text-text select-text">{input.command}</pre>
                </div>
            ) : (
                <details>
                    <summary className="flex h-7 cursor-pointer items-center text-xs text-text-muted">Details</summary>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-sunken p-3 font-mono text-code text-text select-text">
                        {JSON.stringify(item.input, null, 2)}
                    </pre>
                </details>
            )}
        </>
    );
}

export function PendingDock({ item, draft, onDraft, onAction, more, hasDraft, denyReason, disabled, sending, error }: Props) {
    const question = item.kind === 'question' ? item.questions[Math.min(draft.index, item.questions.length - 1)]! : null;
    const answer = question ? questionAnswer(draft, question) : null;
    const locked = sending || disabled;
    const last = item.kind === 'question' && draft.index === item.questions.length - 1;
    const approve = (decision: 'allow' | 'allow-always' | 'deny') =>
        onAction({ kind: 'approve', decision, ...(decision === 'deny' && draft.reason.trim() ? { message: draft.reason.trim() } : {}) });
    const updateAnswer = (next: NonNullable<typeof answer>) => {
        if (question) {
            onDraft({ ...draft, answers: { ...draft.answers, [question.id]: next } });
        }
    };
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
    return (
        <div
            className="prompt-card flex min-h-0 flex-col gap-2 p-3"
            role="group"
            aria-label={item.kind === 'approval' ? 'Permission request' : 'Question'}
            aria-busy={sending}
        >
            <div className="max-h-[min(50dvh,480px)] overflow-auto overscroll-contain">
                <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                        <Icon icon={item.kind === 'approval' ? Hand : MessageCircleQuestionMark} size={18} className="mt-0.5 shrink-0 text-status-needs-you" />
                        <h3 tabIndex={-1} className="prompt-heading min-w-0 break-words text-sm font-semibold text-text outline-offset-4">
                            {item.kind === 'approval'
                                ? `${item.toolName === 'Bash' ? 'Run command' : item.toolName} ${item.toolName === 'Bash' ? '' : toolSummary(item.toolName, item.input)}`
                                : question?.question}
                        </h3>
                    </div>
                    {(more > 0 || hasDraft || (item.kind === 'question' && item.questions.length > 1)) && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
                            {more > 0 && <span className="tabular-nums">{more + 1} requests waiting</span>}
                            {item.kind === 'question' && item.questions.length > 1 && (
                                <span className="tabular-nums">
                                    Question {draft.index + 1} of {item.questions.length}
                                </span>
                            )}
                            {hasDraft && <span>Draft saved</span>}
                        </div>
                    )}
                    {item.kind === 'approval' ? (
                        <>
                            <ApprovalDetails item={item} />
                            {denyReason && draft.showReason && (
                                <textarea
                                    className="field min-h-16 text-sm"
                                    autoFocus
                                    aria-label="Reason for declining"
                                    placeholder="Reason for declining, optional"
                                    disabled={locked}
                                    value={draft.reason}
                                    onChange={(e) => onDraft({ ...draft, reason: e.target.value })}
                                />
                            )}
                        </>
                    ) : (
                        question &&
                        answer && (
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
                                            onClick={() => updateAnswer(pickPromptChoice(answer, question, choice.label))}
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
                                            onFocus={() => updateAnswer({ ...answer, custom: true })}
                                            onChange={(e) => updateAnswer({ ...answer, custom: true, text: e.target.value })}
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
                                        onChange={(e) => updateAnswer({ ...answer, text: e.target.value })}
                                    />
                                )}
                            </div>
                        )
                    )}
                    {disabled && <p className="text-xs text-text-muted">Not connected to the machine</p>}
                    {error && (
                        <p role="alert" className="text-xs text-status-error">
                            {error}
                        </p>
                    )}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                {item.kind === 'approval' ? (
                    <>
                        {denyReason && !draft.showReason && (
                            <Button size="sm" className="rounded-full!" disabled={locked} onClick={() => onDraft({ ...draft, showReason: true })}>
                                Add a reason
                            </Button>
                        )}
                        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                            {item.canAllowAlways && item.allowAlways && (
                                <Button
                                    size="sm"
                                    className="rounded-full!"
                                    disabled={locked}
                                    aria-description={item.allowAlways.description}
                                    onClick={() => approve('allow-always')}
                                >
                                    {item.allowAlways.label}
                                </Button>
                            )}
                            <Button size="sm" className="rounded-full!" disabled={locked} onClick={() => approve('deny')}>
                                Deny
                            </Button>
                            <PromptPrimary disabled={locked} onClick={() => approve('allow')}>
                                <Icon icon={CircleCheck} size={16} />
                                {sending ? 'Sending…' : 'Allow'}
                            </PromptPrimary>
                        </div>
                    </>
                ) : (
                    <>
                        {draft.index > 0 && (
                            <Button size="sm" className="rounded-full!" disabled={sending} onClick={() => onDraft({ ...draft, index: draft.index - 1 })}>
                                Previous
                            </Button>
                        )}
                        {item.async && draft.index === 0 && (
                            <Button size="sm" className="rounded-full!" disabled={locked} onClick={() => onAction({ kind: 'dismiss' })}>
                                Dismiss
                            </Button>
                        )}
                        <span className="grow" />
                        <PromptPrimary disabled={locked || !answer || !answerValue(answer) || (last && !promptAnswers(item, draft))} onClick={commit}>
                            {sending ? 'Sending…' : last ? 'Answer' : 'Next'}
                            <Icon icon={ArrowUp} size={16} />
                        </PromptPrimary>
                    </>
                )}
            </div>
        </div>
    );
}

import { Suspense, lazy, useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronLeft, ChevronRight, MessageCircleQuestionMark, X } from 'lucide-react';
import type { ChatApprovalItem, ChatQuestionItem } from '@ruimte/contracts';
import { chatClient } from '@/chat';
import { approvalChanges, fileChanges, toolSummary } from '@/chat/logic/tools';
import { toolIcon } from '@/chat/ui/icons';
import { Icon } from '@/ui/Icon';

const EditDiff = lazy(() => import('@/chat/ui/EditDiff'));
const UnifiedDiff = lazy(() => import('@/chat/ui/UnifiedDiff'));

const buttonClass = 'inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium';

/* One permission request, fused to the top of the composer; the buttons answer it in place. */
export function ApprovalDock({ chatId, item, index, total }: { chatId: string; item: ChatApprovalItem; index: number; total: number }) {
    const [open, setOpen] = useState(false);
    const patches = approvalChanges(item.input);
    const changes = patches.length > 0 ? [] : fileChanges(item.toolName, item.input);
    const command = item.toolName === 'Bash' ? ((item.input as { command?: string })?.command ?? '') : '';
    const decide = (decision: 'allow' | 'allow-always' | 'deny'): void => {
        void chatClient.approve(chatId, item.requestId, decision).catch(() => undefined);
    };
    return (
        <div className="chat-dock">
            <div className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="grid h-6 w-6 shrink-0 place-items-center text-status-needs-you">{toolIcon(item.toolName)}</span>
                <span className="font-medium text-text">{item.toolName}</span>
                <button className="min-w-0 truncate text-left font-mono text-text-muted hover:text-text" onClick={() => setOpen((o) => !o)}>
                    {toolSummary(item.toolName, item.input) || 'wants to run'}
                </button>
                <span className="grow" />
                {total > 1 && (
                    <span className="tabular-nums text-text-faint">
                        {index + 1}/{total}
                    </span>
                )}
                <button className={clsx(buttonClass, 'text-text-muted hover:bg-surface-sunken hover:text-text')} onClick={() => decide('deny')}>
                    <Icon icon={X} size={12} /> Decline
                </button>
                {item.canAllowAlways && (
                    <button className={clsx(buttonClass, 'text-text hover:bg-surface-sunken')} onClick={() => decide('allow-always')}>
                        Always allow
                    </button>
                )}
                <button className={clsx(buttonClass, 'bg-accent text-accent-text')} onClick={() => decide('allow')}>
                    <Icon icon={Check} size={12} /> Approve
                </button>
            </div>
            {item.description && <p className="px-3 pb-2 text-xs text-text-muted">{item.description}</p>}
            {(open || changes.length > 0 || patches.length > 0) && (
                <div className="max-h-64 overflow-auto border-t border-border">
                    {patches.length > 0 ? (
                        <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">Loading diff</div>}>
                            {patches.map((change, i) => (
                                <UnifiedDiff key={i} change={change} />
                            ))}
                        </Suspense>
                    ) : changes.length > 0 ? (
                        <Suspense fallback={<div className="px-3 py-2 text-xs text-text-faint">Loading diff</div>}>
                            {changes.map((change, i) => (
                                <EditDiff key={i} change={change} />
                            ))}
                        </Suspense>
                    ) : (
                        <pre className="whitespace-pre-wrap px-3 py-2 font-mono text-code text-term-fg select-text">
                            {command || JSON.stringify(item.input, null, 2)}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
}

/* The agent's questions, one at a time, with the choices as buttons and room for a written answer. */
export function QuestionDock({ chatId, item }: { chatId: string; item: ChatQuestionItem }) {
    const [index, setIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [custom, setCustom] = useState('');
    const question = item.questions[Math.min(index, item.questions.length - 1)]!;
    const last = index >= item.questions.length - 1;
    const answer = answers[question.id] ?? '';

    const pick = (label: string): void => {
        if (!question.multiSelect) {
            setAnswers((a) => ({ ...a, [question.id]: label }));
            return;
        }
        const chosen = new Set(answer ? answer.split(', ') : []);
        if (chosen.has(label)) {
            chosen.delete(label);
        } else {
            chosen.add(label);
        }
        setAnswers((a) => ({ ...a, [question.id]: [...chosen].join(', ') }));
    };

    const commit = (): void => {
        const value = custom.trim() || answer;
        const next = { ...answers, [question.id]: value };
        setAnswers(next);
        setCustom('');
        if (last) {
            void chatClient.answer(chatId, item.requestId, next).catch(() => undefined);
        } else {
            setIndex(index + 1);
        }
    };

    const selected = new Set(answer ? answer.split(', ') : []);
    return (
        <div className="chat-dock">
            <div className="flex items-center gap-2 px-3 py-2 text-xs">
                <Icon icon={MessageCircleQuestionMark} size={12} className="shrink-0 text-status-needs-you" />
                <span className="font-medium text-text">{question.header || 'Question'}</span>
                <span className="grow" />
                {item.questions.length > 1 && (
                    <span className="tabular-nums text-text-faint">
                        {index + 1}/{item.questions.length}
                    </span>
                )}
            </div>
            <p className="px-3 pb-2 text-sm leading-normal text-text select-text">{question.question}</p>
            <div className="flex flex-col gap-1 px-3 pb-2">
                {question.choices.map((choice) => (
                    <button
                        key={choice.label}
                        className={clsx(
                            'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs hover:bg-surface-sunken',
                            selected.has(choice.label) ? 'border-accent bg-accent-soft' : 'border-border'
                        )}
                        onClick={() => pick(choice.label)}
                    >
                        <span className="font-medium text-text">{choice.label}</span>
                        {choice.description && <span className="text-text-muted">{choice.description}</span>}
                    </button>
                ))}
                <input
                    className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none placeholder:text-text-faint focus:border-accent"
                    placeholder="Or write your own answer"
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter' && (custom.trim() || answer)) {
                            commit();
                        }
                    }}
                />
            </div>
            <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                {index > 0 && (
                    <button className={clsx(buttonClass, 'text-text-muted hover:bg-surface-sunken hover:text-text')} onClick={() => setIndex(index - 1)}>
                        <Icon icon={ChevronLeft} size={12} /> Previous
                    </button>
                )}
                <span className="grow" />
                <button className={clsx(buttonClass, 'bg-accent text-accent-text disabled:opacity-40')} disabled={!custom.trim() && !answer} onClick={commit}>
                    {last ? 'Submit' : 'Next'} {last ? <Icon icon={Check} size={12} /> : <Icon icon={ChevronRight} size={12} />}
                </button>
            </div>
        </div>
    );
}

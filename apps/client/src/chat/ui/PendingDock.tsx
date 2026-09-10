import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronLeft, ChevronRight, MessageCircleQuestionMark, X } from 'lucide-react';
import type { ChatApprovalItem, ChatQuestionItem } from '@ruimte/contracts';
import { chatClient } from '@/chat';
import { approvalChanges, fileChanges, toolSummary } from '@/chat/logic/tools';
import { toolIcon } from '@/chat/ui/icons';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

const EditDiff = lazy(() => import('@/chat/ui/EditDiff'));
const UnifiedDiff = lazy(() => import('@/chat/ui/UnifiedDiff'));

/* Enter answers and Escape refuses while the dock has focus. A field inside it types instead: a
   written answer must be able to hold both keys. */
const isTypingTarget = (target: EventTarget | null): boolean => target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

/* One permission request, fused to the top of the composer; the buttons answer it in place. */
export function ApprovalDock({
    chatId,
    item,
    more,
    denyReason,
    focused
}: {
    chatId: string;
    item: ChatApprovalItem;
    /* How many other approvals and questions wait behind this one. */
    more: number;
    /* Whether this CLI hands a declined tool the reason along with the refusal. */
    denyReason: boolean;
    focused: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const patches = approvalChanges(item.input);
    const changes = patches.length > 0 ? [] : fileChanges(item.toolName, item.input);
    const command = item.toolName === 'Bash' ? ((item.input as { command?: string })?.command ?? '') : '';
    const ref = useRef<HTMLDivElement>(null);
    const decide = (decision: 'allow' | 'allow-always' | 'deny', message?: string): void => {
        void chatClient.approve(chatId, item.requestId, decision, message).catch(() => undefined);
    };

    // A request that arrives inside the node you are working in becomes answerable by keyboard on
    // the spot. A node you are not in, or a field you are typing in, keeps what it has.
    useEffect(() => {
        if (focused && !isTypingTarget(document.activeElement)) {
            ref.current?.focus({ preventScroll: true });
        }
    }, [focused, item.requestId]);

    return (
        <div
            ref={ref}
            className="chat-dock outline-none"
            role="group"
            aria-label={`${item.toolName} wants permission`}
            tabIndex={-1}
            onKeyDown={(e) => {
                if (isTypingTarget(e.target)) {
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    decide('allow');
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    decide('deny');
                }
            }}
        >
            <div className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="grid h-6 w-6 shrink-0 place-items-center text-status-needs-you">{toolIcon(item.toolName)}</span>
                <span className="font-medium text-text">{item.toolName}</span>
                <button className="min-w-0 truncate text-left font-mono text-text-muted hover:text-text" onClick={() => setOpen((o) => !o)}>
                    {toolSummary(item.toolName, item.input) || 'wants to run'}
                </button>
                <span className="grow" />
                {more > 0 && <span className="shrink-0 tabular-nums text-text-faint">{more} more</span>}
                <Button size="sm" onClick={() => decide('deny')}>
                    <Icon icon={X} size={12} /> Decline <kbd className="tooltip-kbd">esc</kbd>
                </Button>
                {item.canAllowAlways && (
                    <Button size="sm" className="text-text hover:bg-surface-sunken" onClick={() => decide('allow-always')}>
                        Always allow
                    </Button>
                )}
                <Button size="sm" variant="primary" onClick={() => decide('allow')}>
                    <Icon icon={Check} size={12} /> Approve <kbd className="tooltip-kbd">↵</kbd>
                </Button>
            </div>
            {item.description && <p className="px-3 pb-2 text-xs text-text-muted">{item.description}</p>}
            {denyReason && note === null && (
                <button className="px-3 pb-2 text-left text-xs text-text-muted hover:text-text" onClick={() => setNote('')}>
                    Decline with a note
                </button>
            )}
            {note !== null && (
                <div className="flex items-center gap-2 px-3 pb-2">
                    <input
                        autoFocus
                        className="field text-xs"
                        aria-label="Why the agent may not do this"
                        placeholder="Tell the agent why not, and what to do instead"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                                decide('deny', note.trim() || undefined);
                            }
                            if (e.key === 'Escape') {
                                setNote(null);
                            }
                        }}
                    />
                    <Button size="sm" onClick={() => decide('deny', note.trim() || undefined)}>
                        <Icon icon={X} size={12} /> Decline
                    </Button>
                </div>
            )}
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
export function QuestionDock({ chatId, item, more, focused }: { chatId: string; item: ChatQuestionItem; more: number; focused: boolean }) {
    const [index, setIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [custom, setCustom] = useState('');
    const ref = useRef<HTMLDivElement>(null);
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

    useEffect(() => {
        if (focused && !isTypingTarget(document.activeElement)) {
            ref.current?.focus({ preventScroll: true });
        }
    }, [focused, item.requestId]);

    /* Escape hands an empty answer back: the agent gets a reply either way, and the dock goes. */
    const dismiss = (): void => {
        void chatClient.answer(chatId, item.requestId, { ...answers, [question.id]: answers[question.id] ?? '' }).catch(() => undefined);
    };

    const selected = new Set(answer ? answer.split(', ') : []);
    const canCommit = custom.trim() !== '' || answer !== '';
    return (
        <div
            ref={ref}
            className="chat-dock outline-none"
            role="group"
            aria-label={question.header || 'Question'}
            tabIndex={-1}
            onKeyDown={(e) => {
                if (isTypingTarget(e.target)) {
                    return;
                }
                if (e.key === 'Enter' && canCommit) {
                    e.preventDefault();
                    e.stopPropagation();
                    commit();
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    dismiss();
                }
            }}
        >
            <div className="flex items-center gap-2 px-3 py-2 text-xs">
                <Icon icon={MessageCircleQuestionMark} size={12} className="shrink-0 text-status-needs-you" />
                <span className="font-medium text-text">{question.header || 'Question'}</span>
                <span className="grow" />
                {item.questions.length > 1 && (
                    <span className="tabular-nums text-text-faint">
                        {index + 1}/{item.questions.length}
                    </span>
                )}
                {more > 0 && <span className="shrink-0 tabular-nums text-text-faint">{more} more</span>}
                {/* Only the agent that keeps working while it waits can be left without an answer. */}
                {item.async === true && (
                    <Button size="sm" onClick={() => void chatClient.dismiss(chatId, item.id).catch(() => undefined)}>
                        <Icon icon={X} size={12} /> Dismiss
                    </Button>
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
                    className="field text-xs"
                    aria-label="Write your own answer"
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
                    <Button size="sm" onClick={() => setIndex(index - 1)}>
                        <Icon icon={ChevronLeft} size={12} /> Previous
                    </Button>
                )}
                <span className="grow" />
                <Button size="sm" variant="primary" disabled={!canCommit} onClick={commit}>
                    {last ? 'Submit' : 'Next'} {last ? <Icon icon={Check} size={12} /> : <Icon icon={ChevronRight} size={12} />}
                    <kbd className="tooltip-kbd">↵</kbd>
                </Button>
            </div>
        </div>
    );
}

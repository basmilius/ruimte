import { useState } from 'react';
import clsx from 'clsx';
import {
    faCheck,
    faChevronDown,
    faCircleExclamation,
    faCircleInfo,
    faCommentQuestion,
    faCompress,
    faCopy,
    faTriangleExclamation,
    faXmark
} from '@fortawesome/duotone-regular-svg-icons';
import type { ChatApprovalItem, ChatAssistantItem, ChatQuestionItem, ChatUserItem } from '@ruimte/contracts';
import { attachmentUrl } from '@/chat/attachments';
import { tokenizeMentions } from '@/chat/mentions';
import { Markdown } from '@/chat/ui/Markdown';
import { toolSummary } from '@/chat/logic/tools';
import { Tooltip } from '@/ui/Tooltip';
import { Icon } from '@/ui/Icon';

// A long prompt folds so the answer stays in view; the reader can open it.
const USER_FOLD_LINES = 8;
const USER_FOLD_CHARS = 600;

const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
};

export function UserRow({ item }: { item: ChatUserItem }) {
    const [open, setOpen] = useState(false);
    const long = item.text.split('\n').length > USER_FOLD_LINES || item.text.length > USER_FOLD_CHARS;
    const segments = tokenizeMentions(item.text, item.mentions ?? []);
    const attachments = item.attachments ?? [];
    return (
        <div className="group/user flex flex-col items-end pb-4">
            {attachments.length > 0 && (
                <div className="mb-1.5 flex max-w-[80%] flex-wrap justify-end gap-1.5">
                    {attachments.map((attachment, index) => (
                        <img
                            key={`${attachment.name}-${index}`}
                            src={attachmentUrl(attachment)}
                            alt={attachment.name}
                            className="max-h-32 max-w-48 rounded-lg border border-border object-cover"
                        />
                    ))}
                </div>
            )}
            {item.text !== '' && (
                <div className="relative max-w-[80%] rounded-2xl bg-accent-soft px-3.5 py-2.5 text-sm leading-normal text-text select-text">
                    <div className={clsx('whitespace-pre-wrap', long && !open && 'chat-fold')}>
                        {segments.map((segment, index) =>
                            segment.kind === 'mention' ? (
                                <span key={index} className="mention-chip">
                                    @{segment.path}
                                </span>
                            ) : (
                                <span key={index}>{segment.text}</span>
                            )
                        )}
                    </div>
                    {long && (
                        <button className="mt-1 flex items-center gap-1 text-xs text-text-muted hover:text-text" onClick={() => setOpen((o) => !o)}>
                            <Icon icon={faChevronDown} size={12} className={clsx('transition-transform', open && 'rotate-180')} />{' '}
                            {open ? 'Show less' : 'Show all'}
                        </button>
                    )}
                </div>
            )}
            <div className="mt-1 flex h-5 items-center gap-1 pr-1 opacity-0 transition-opacity group-hover/user:opacity-100">
                <Tooltip label="Copy">
                    <button className="icon-btn h-5 w-5 rounded" onClick={() => copy(item.text)}>
                        <Icon icon={faCopy} size={14} />
                    </button>
                </Tooltip>
            </div>
        </div>
    );
}

export function AssistantRow({ item, last }: { item: ChatAssistantItem; last: boolean }) {
    return (
        <div className="group/assistant px-1 pb-2">
            <Markdown text={item.text} />
            {item.streaming && item.text === '' && <span className="inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-text-faint align-middle" />}
            {last && !item.streaming && (
                <div className="mt-1 flex h-5 items-center gap-1 opacity-0 transition-opacity group-hover/assistant:opacity-100">
                    <Tooltip label="Copy">
                        <button className="icon-btn h-5 w-5 rounded" onClick={() => copy(item.text)}>
                            <Icon icon={faCopy} size={14} />
                        </button>
                    </Tooltip>
                </div>
            )}
        </div>
    );
}

const NOTE_ICON = {
    info: <Icon icon={faCircleInfo} size={16} />,
    warning: <Icon icon={faTriangleExclamation} size={16} />,
    error: <Icon icon={faCircleExclamation} size={16} />
};

export function NoteRow({ level, text }: { level: 'info' | 'warning' | 'error'; text: string }) {
    return (
        <div
            className={clsx(
                'flex items-center gap-1.5 px-1 pb-2 text-xs',
                level === 'error' ? 'text-status-error' : level === 'warning' ? 'text-status-needs-you' : 'text-text-faint'
            )}
        >
            {NOTE_ICON[level]}
            <span className="select-text">{text}</span>
        </div>
    );
}

const formatTokens = (count: number): string => (count >= 1000 ? `${Math.round(count / 1000)}k` : String(count));

export function CompactionRow({ preTokens }: { preTokens: number | null }) {
    return (
        <div className="flex items-center gap-3 pb-3 text-xs text-text-faint">
            <span className="h-px grow bg-border" />
            <Icon icon={faCompress} size={12} />
            <span>Context compacted{preTokens ? ` from ${formatTokens(preTokens)} tokens` : ''}</span>
            <span className="h-px grow bg-border" />
        </div>
    );
}

const DECISION: Record<Exclude<ChatApprovalItem['decision'], 'pending'>, { label: string; icon: React.ReactNode }> = {
    allow: { label: 'Allowed', icon: <Icon icon={faCheck} size={12} /> },
    'allow-always': { label: 'Always allowed', icon: <Icon icon={faCheck} size={12} /> },
    deny: { label: 'Declined', icon: <Icon icon={faXmark} size={12} /> },
    cancelled: { label: 'No longer needed', icon: <Icon icon={faXmark} size={12} /> }
};

/* The outcome of a permission request, one quiet line; the request itself lived on the composer. */
export function ApprovalHistoryRow({ item }: { item: ChatApprovalItem }) {
    if (item.decision === 'pending') {
        return null;
    }
    const decision = DECISION[item.decision];
    return (
        <div className="flex items-center gap-2 px-1 pb-2 text-xs text-text-faint">
            <span className={clsx('flex items-center gap-1', item.decision === 'deny' && 'text-status-error')}>
                {decision.icon} {decision.label}
            </span>
            <span className="text-text-muted">{item.toolName}</span>
            <span className="min-w-0 truncate font-mono">{toolSummary(item.toolName, item.input)}</span>
        </div>
    );
}

export function QuestionHistoryRow({ item }: { item: ChatQuestionItem }) {
    return (
        <div className="pb-2">
            {item.questions.map((question) => (
                <div key={question.id} className="flex items-start gap-2 px-1 py-0.5 text-xs text-text-faint">
                    <Icon icon={faCommentQuestion} size={16} className="mt-0.5 shrink-0" />
                    <span className="min-w-0">
                        <span className="text-text-muted">{question.question}</span>
                        {item.state === 'answered' && item.answers?.[question.id] !== undefined && (
                            <span className="ml-1.5 text-text">{item.answers[question.id]}</span>
                        )}
                        {item.state === 'cancelled' && <span className="ml-1.5">(not answered)</span>}
                    </span>
                </div>
            ))}
        </div>
    );
}

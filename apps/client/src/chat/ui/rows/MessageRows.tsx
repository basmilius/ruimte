import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Bot, Brain, Check, ChevronDown, CircleAlert, Info, MessageCircleQuestionMark, Minimize2, Paperclip, TriangleAlert, X } from 'lucide-react';
import type { ChatApprovalItem, ChatAssistantItem, ChatQuestionItem, ChatThinkingItem, ChatUserItem } from '@ruimte/contracts';
import { attachmentUrl, formatBytes, isImageAttachment } from '@/chat/attachments';
import { useChatRow } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { useProviders } from '@/state/providers';
import { useSettings } from '@/state/settings';
import { ImageThumb } from '@/chat/ui/ImageView';
import { MessageMarkdown, ReplyMarkdown } from '@/chat/ui/Markdown';
import { settledBlocksText } from '@/chat/ui/markdown-blocks';
import { FADE_CLASS, WHOLE_FADE_CLASS, isWhitespace, wordSegments } from '@/chat/ui/rehype-fade';
import { useRevealedText } from '@/chat/ui/reveal';
import { formatDuration } from '@/chat/logic/timeline';
import { toolSummary } from '@/chat/logic/tools';
import { ROW_GUTTER } from '@/chat/ui/icons';
import { Icon } from '@/ui/Icon';

// A long prompt folds so the answer stays in view; the reader can open it.
const USER_FOLD_LINES = 8;
const USER_FOLD_CHARS = 600;

/* A folded user prompt fades out at the bottom instead of cutting a line in half. */
const FOLD = 'max-h-[10em] overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]';

export function UserRow({ chatId, item }: { chatId: string; item: ChatUserItem }) {
    const [open, setOpen] = useState(false);
    const endpointId = useEndpointId();
    const long = item.text.split('\n').length > USER_FOLD_LINES || item.text.length > USER_FOLD_CHARS;
    const attachments = item.attachments ?? [];
    return (
        <div className="flex flex-col items-end">
            <MessageHeading>You</MessageHeading>
            {attachments.length > 0 && (
                <div className="mb-1.5 flex max-w-[80%] flex-wrap justify-end gap-1.5">
                    {attachments.map((attachment) =>
                        isImageAttachment(attachment.mime) ? (
                            <ImageThumb
                                key={attachment.id}
                                src={attachmentUrl(chatId, attachment.id, endpointId)}
                                alt={attachment.name}
                                className="max-h-32 max-w-48 object-cover"
                            />
                        ) : (
                            <a
                                key={attachment.id}
                                href={attachmentUrl(chatId, attachment.id, endpointId)}
                                target="_blank"
                                rel="noreferrer"
                                className="flex max-w-56 items-center gap-1.5 rounded-lg border border-border bg-surface-sunken px-2.5 py-1.5 text-xs text-text-muted hover:text-text"
                            >
                                <Icon icon={Paperclip} size={12} className="shrink-0 text-text-faint" />
                                <span className="truncate">{attachment.name}</span>
                                <span className="shrink-0 text-text-faint">{formatBytes(attachment.size)}</span>
                            </a>
                        )
                    )}
                </div>
            )}
            {item.text !== '' && (
                <div className="relative max-w-[80%] rounded-2xl bg-surface-active px-3.5 py-2.5 text-sm text-text select-text">
                    <div className={clsx(long && !open && FOLD)}>
                        <MessageMarkdown text={item.text} mentions={item.mentions} skills={item.skills} />
                    </div>
                    {long && (
                        <button className="mt-1 flex items-center gap-1 text-xs text-text-muted hover:text-text" onClick={() => setOpen((o) => !o)}>
                            <Icon icon={ChevronDown} size={12} className={clsx('transition-transform', open && 'rotate-180')} />{' '}
                            {open ? 'Show less' : 'Show all'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

/*
 * The item as the thread holds it now. The row was derived from the structure, which a delta leaves
 * alone, so only this row renders again when a word arrives.
 */
const useCurrentItem = <T extends ChatAssistantItem | ChatThinkingItem>(chatId: string, derived: T): T =>
    useChatRow(chatId, (row) => {
        const item = row?.items[derived.id];
        return item?.kind === derived.kind ? (item as T) : derived;
    });

/*
 * Who wrote a message, for a screen reader only: one heading per message is what lets VoiceOver's
 * rotor walk a thread from message to message. `select-none`, so a selection copied across two
 * messages does not pick the names up.
 */
function MessageHeading({ children }: { children: ReactNode }) {
    return <h3 className="sr-only select-none">{children}</h3>;
}

/* The heading of a reply, named after the agent the chat runs. */
function ReplyHeading({ chatId }: { chatId: string }) {
    const kind = useChatRow(chatId, (row) => row?.info.provider);
    const name = useProviders((s) => s.providers.find((provider) => provider.kind === kind)?.name);
    return <MessageHeading>{name ?? 'Agent'}</MessageHeading>;
}

const WRITING = <span className="chat-live-text text-sm">Writing...</span>;

/*
 * A reply. A word at a time, it follows the text as it arrives. A block at a time, the blocks that
 * closed are drawn and fade in as they land, with "Writing..." where the next one will stand. Whole,
 * it says it is being written and fades in once it is done. Only a row that saw the reply being
 * written fades anything: an old reply scrolled back into view just stands there.
 */
export function AssistantRow({ chatId, item: derived }: { chatId: string; item: ChatAssistantItem }) {
    const item = useCurrentItem(chatId, derived);
    const mode = useSettings((s) => s.chatStreaming);
    const [sawWriting] = useState(item.streaming);
    const live = mode === 'words' && item.streaming;
    const reveal = useRevealedText(item.text, live);

    if (mode === 'blocks') {
        const settled = item.streaming ? settledBlocksText(item.text) : item.text;
        return (
            <div className="-mx-1 px-1 pb-2">
                <ReplyHeading chatId={chatId} />
                {settled !== '' && <ReplyMarkdown text={settled} streaming={false} arriving={sawWriting} />}
                {item.streaming && WRITING}
            </div>
        );
    }
    if (mode === 'whole' && item.streaming) {
        return (
            <div className="-mx-1 px-1 pb-2">
                <ReplyHeading chatId={chatId} />
                {WRITING}
            </div>
        );
    }
    return (
        <div className={clsx('-mx-1 px-1 pb-2', mode === 'whole' && sawWriting && WHOLE_FADE_CLASS)}>
            <ReplyHeading chatId={chatId} />
            <ReplyMarkdown text={reveal.text} streaming={reveal.active} />
            {live && item.text === '' && <span className="inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-text-faint align-middle" />}
        </div>
    );
}

/* Plain text that fades in a word at a time, the way a streamed reply does. */
function FadingWords({ text }: { text: string }) {
    return (
        <>
            {wordSegments(text).map((segment, index) =>
                isWhitespace(segment) ? (
                    segment
                ) : (
                    // Words only arrive at the end, so a word keeps its place and its fade is not restarted.
                    <span key={index} className={FADE_CLASS}>
                        {segment}
                    </span>
                )
            )}
        </>
    );
}

/*
 * What the model thought before it answered. It shimmers while it streams and folds itself away
 * once the answer starts, because the thought is worth a glance and rarely worth reading twice.
 */
export function ThinkingRow({ chatId, item: derived }: { chatId: string; item: ChatThinkingItem }) {
    const item = useCurrentItem(chatId, derived);
    const mode = useSettings((s) => s.chatStreaming);
    const [open, setOpen] = useState(false);
    const reveal = useRevealedText(item.text, mode === 'words' && item.streaming);
    // A block at a time, the paragraphs of the thought that closed are shown as they land.
    const settled = mode === 'blocks' && item.streaming ? settledBlocksText(item.text) : null;
    // Whole, the thought stays behind "Thinking..." until it is done and then folds like any other.
    const shown = open || reveal.active || (settled !== null && settled !== '');
    const text = settled ?? reveal.text;
    return (
        <div className="-mx-1 px-1 pb-2">
            <button className="flex items-center gap-2 text-xs text-text-muted hover:text-text" disabled={item.streaming} onClick={() => setOpen((o) => !o)}>
                <span className={ROW_GUTTER}>
                    <Icon icon={Brain} size={12} />
                </span>
                {item.streaming ? (
                    <span className="chat-live-text">Thinking...</span>
                ) : (
                    <>
                        <span>Thought for {formatDuration((item.endedAt ?? item.createdAt) - item.createdAt)}</span>
                        <Icon icon={ChevronDown} size={12} className={clsx('transition-transform', open && 'rotate-180')} />
                    </>
                )}
            </button>
            {shown && text !== '' && (
                <div className="mt-1 border-l border-border pl-2.5 text-sm whitespace-pre-wrap text-text-faint select-text">
                    {reveal.active ? <FadingWords text={reveal.text} /> : text}
                </div>
            )}
        </div>
    );
}

const NOTE_ICON = {
    info: <Icon icon={Info} size={12} />,
    warning: <Icon icon={TriangleAlert} size={12} />,
    error: <Icon icon={CircleAlert} size={12} />
};

export function NoteRow({ level, text }: { level: 'info' | 'warning' | 'error'; text: string }) {
    return (
        <div
            className={clsx(
                '-mx-1 mb-0.5 flex min-h-7 items-start gap-2 px-1 py-1 text-xs',
                level === 'error' ? 'text-status-error' : level === 'warning' ? 'text-status-needs-you' : 'text-text-faint'
            )}
        >
            <span className={ROW_GUTTER}>{NOTE_ICON[level]}</span>
            <span className="select-text">{text}</span>
        </div>
    );
}

/*
 * The header of a turn the agent started itself, in place of the message of the person that is
 * missing. It is one line: what the sub-agent came back with lives on that agent's own row, behind
 * "Show result". When the CLI named the sub-agent it woke up about, the header opens that row.
 */
export function AgentTurnRow({ label, onOpen }: { label: string; onOpen?: () => void }) {
    if (!onOpen) {
        return (
            <div className="mb-0.5 flex h-7 w-full items-center gap-2 text-left text-xs text-text-muted">
                <span className={ROW_GUTTER}>
                    <Icon icon={Bot} size={12} />
                </span>
                <span className="min-w-0 truncate select-text">{label}</span>
            </div>
        );
    }
    return (
        <button className="mb-0.5 flex h-7 w-full items-center gap-2 text-left text-xs text-text-muted hover:text-text" onClick={onOpen}>
            <span className={ROW_GUTTER}>
                <Icon icon={Bot} size={12} />
            </span>
            <span className="min-w-0 truncate">{label}</span>
        </button>
    );
}

const formatTokens = (count: number): string => (count >= 1000 ? `${Math.round(count / 1000)}k` : String(count));

export function CompactionRow({ preTokens }: { preTokens: number | null }) {
    return (
        <div className="flex items-center gap-3 pb-3 text-xs text-text-faint">
            <span className="h-px grow bg-border" />
            <Icon icon={Minimize2} size={12} />
            <span>Context compacted{preTokens ? ` from ${formatTokens(preTokens)} tokens` : ''}</span>
            <span className="h-px grow bg-border" />
        </div>
    );
}

const DECISION: Record<Exclude<ChatApprovalItem['decision'], 'pending'>, { label: string; icon: React.ReactNode }> = {
    allow: { label: 'Allowed', icon: <Icon icon={Check} size={12} /> },
    'allow-always': { label: 'Always allowed', icon: <Icon icon={Check} size={12} /> },
    deny: { label: 'Declined', icon: <Icon icon={X} size={12} /> },
    cancelled: { label: 'No longer needed', icon: <Icon icon={X} size={12} /> }
};

/* The outcome of a permission request, one quiet line; the request itself lived on the composer. */
export function ApprovalHistoryRow({ item }: { item: ChatApprovalItem }) {
    if (item.decision === 'pending') {
        return null;
    }
    const decision = DECISION[item.decision];
    return (
        <div className="-mx-1 mb-0.5 flex h-7 items-center gap-2 px-1 text-xs text-text-faint">
            <span className={clsx(ROW_GUTTER, item.decision === 'deny' && 'text-status-error')}>{decision.icon}</span>
            <span className={clsx(item.decision === 'deny' && 'text-status-error')}>{decision.label}</span>
            <span className="text-text-muted">{item.toolName}</span>
            <span className="min-w-0 truncate font-mono">{toolSummary(item.toolName, item.input)}</span>
        </div>
    );
}

export function QuestionHistoryRow({ item }: { item: ChatQuestionItem }) {
    return (
        <div>
            {item.questions.map((question) => (
                <div key={question.id} className="-mx-1 mb-0.5 flex min-h-7 items-start gap-2 px-1 py-1 text-xs text-text-faint">
                    <span className={ROW_GUTTER}>
                        <Icon icon={MessageCircleQuestionMark} size={12} />
                    </span>
                    <span className="min-w-0">
                        <span className="text-text-muted">{question.question}</span>
                        {item.state === 'answered' && item.answers?.[question.id] !== undefined && (
                            <span className="ml-1.5 text-text">{item.answers[question.id]}</span>
                        )}
                        {item.state === 'cancelled' && <span className="ml-1.5">(not answered)</span>}
                        {item.state === 'dismissed' && <span className="ml-1.5">(dismissed)</span>}
                    </span>
                </div>
            ))}
        </div>
    );
}

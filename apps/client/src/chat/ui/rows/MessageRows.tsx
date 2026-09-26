import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bot, Brain, Check, ChevronDown, CircleAlert, File, Info, MessageCircleQuestionMark, TriangleAlert, X } from 'lucide-react';
import type { ChatApprovalItem, ChatAttachment, ChatAssistantItem, ChatQuestionItem, ChatThinkingItem, ChatUserItem } from '@ruimte/contracts';
import { fileBadge, formatBytes, isImageAttachment } from '@/chat/attachments';
import { useChatRow } from '@ruimte/agents-react/state/chats';
import { useEndpointId } from '@/state/keys';
import { useProviders } from '@ruimte/agents-react/state/providers';
import { useSettings } from '@/state/settings';
import { useMachineUrl } from '@/transport/machine-url';
import { ChatReferenceChip } from '@/chat/ui/ChatReferenceChip';
import { ImageThumb } from '@/chat/ui/ImageView';
import { MessageMarkdown, ReplyMarkdown } from '@/chat/ui/Markdown';
import { FadingWords } from '@/chat/ui/FadingWords';
import { settledBlocksText } from '@/chat/ui/markdown-blocks';
import { WHOLE_FADE_CLASS } from '@/chat/ui/rehype-fade';
import { useRevealedText } from '@/chat/ui/reveal';
import { formatElapsedShort } from '@ruimte/ui/format/duration';
import { formatTokens } from '@ruimte/ui/format/number';
import { toolSummary } from '@/chat/logic/tools';
import { ROW_GUTTER } from '@/chat/ui/icons';
import { useOpenForFind } from '@/chat/ui/find-reveal';
import { useChatPlace } from '@/chat/ui/use-chat-place';
import { Icon } from '@ruimte/ui/Icon';
import { Tooltip } from '@ruimte/ui/Tooltip';

// A long prompt folds so the answer stays in view; the reader can open it.
const USER_FOLD_LINES = 8;
const USER_FOLD_CHARS = 600;

/* A folded user prompt fades out at the bottom instead of cutting a line in half. */
const FOLD = 'max-h-[10em] overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]';

/*
 * A file attached to a message that is not a picture. `download` is what saves a blob URL: the shell
 * hands a link that opens a window to the system browser, which cannot reach a blob of this page.
 */
function AttachmentLink({ chatId, endpointId, attachment }: { chatId: string; endpointId: string; attachment: ChatAttachment }) {
    const { url } = useMachineUrl({ kind: 'attachment', chatId, attachmentId: attachment.id }, endpointId);
    const badge = fileBadge(attachment.name);
    return (
        <Tooltip label={attachment.name}>
            <a
                href={url ?? undefined}
                download={attachment.name}
                target="_blank"
                rel="noreferrer"
                aria-disabled={url === null}
                className="flex h-28 w-36 flex-col rounded-xl border border-border bg-surface-raised bg-clip-padding p-2.5 text-left hover:bg-surface-hover"
            >
                <span className="flex h-6 min-w-6 items-center justify-center self-start rounded-md border border-border px-1.5 text-xs font-medium text-text-muted">
                    {badge ?? <Icon icon={File} size={12} />}
                </span>
                <span className="mt-auto line-clamp-2 text-xs break-all text-text">{attachment.name}</span>
                <span className="text-xs text-text-faint">{formatBytes(attachment.size)}</span>
            </a>
        </Tooltip>
    );
}

export function UserRow({ chatId, item }: { chatId: string; item: ChatUserItem }) {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(false);
    const endpointId = useEndpointId();
    const long = item.text.split('\n').length > USER_FOLD_LINES || item.text.length > USER_FOLD_CHARS;
    const attachments = item.attachments ?? [];
    const chats = item.chats ?? [];
    useOpenForFind(item.id, 'text', setOpen);
    return (
        <div data-find-item={item.id} className="flex flex-col items-end">
            <MessageHeading>{t('rows.user.heading')}</MessageHeading>
            {attachments.length > 0 && (
                <div className="mb-1.5 flex max-w-[80%] flex-wrap justify-end gap-1.5">
                    {attachments.map((attachment) =>
                        isImageAttachment(attachment.mime) ? (
                            <ImageThumb
                                key={attachment.id}
                                resource={{ kind: 'attachment', chatId, attachmentId: attachment.id }}
                                endpointId={endpointId}
                                alt={attachment.name}
                                className="max-h-32 max-w-48 object-cover"
                            />
                        ) : (
                            <AttachmentLink key={attachment.id} chatId={chatId} endpointId={endpointId} attachment={attachment} />
                        )
                    )}
                </div>
            )}
            {chats.length > 0 && (
                <div className="mb-1.5 flex max-w-[80%] flex-wrap justify-end gap-1.5">
                    {chats.map((id) => (
                        <ChatReferenceChip key={id} chatId={id} />
                    ))}
                </div>
            )}
            {item.text !== '' && (
                <div className="relative max-w-[80%] rounded-2xl bg-surface-active px-3.5 py-2.5 text-sm text-text select-text">
                    <div data-find-field="text" className={clsx(long && !open && FOLD)}>
                        <MessageMarkdown text={item.text} mentions={item.mentions} skills={item.skills} />
                    </div>
                    {long && (
                        <button className="mt-1 flex items-center gap-1 text-xs text-text-muted hover:text-text" onClick={() => setOpen((o) => !o)}>
                            <Icon icon={ChevronDown} size={12} className={clsx('transition-transform', open && 'rotate-180')} />{' '}
                            {open ? t('rows.user.showLess') : t('rows.user.showAll')}
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

/* The report a subagent handed back, drawn as a reply under a label of its own. */
export function ReportRow({ id, text }: { id: string; text: string }) {
    const { t } = useTranslation('chat');
    return (
        <div data-find-item={id} className="-mx-1 px-1 pb-2">
            <MessageHeading>{t('rows.report.heading')}</MessageHeading>
            <div aria-hidden className="mb-1 text-xs font-medium text-text-faint select-none">
                {t('rows.report.heading')}
            </div>
            <div data-find-field="text" data-quote-answer className="contents">
                <ReplyMarkdown text={text} streaming={false} />
            </div>
        </div>
    );
}

/* The heading of a reply, named after the agent the chat runs. */
function ReplyHeading({ chatId }: { chatId: string }) {
    const { t } = useTranslation('chat');
    const kind = useChatRow(chatId, (row) => row?.info.provider);
    const name = useProviders((s) => s.providers.find((provider) => provider.kind === kind)?.name);
    return <MessageHeading>{name ?? t('rows.reply.agent')}</MessageHeading>;
}

/* The line that stands where the next words will land; a component, so the word is read at render and not at import. */
function Writing() {
    const { t } = useTranslation('chat');
    return <span className="chat-live-text text-sm">{t('rows.reply.writing')}</span>;
}

/*
 * A reply. A word at a time, it follows the text as it arrives. A block at a time, the blocks that
 * closed are drawn and fade in as they land, with "Writing…" where the next one will stand. Whole,
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
            <div data-find-item={item.id} className="-mx-1 px-1 pb-2">
                <ReplyHeading chatId={chatId} />
                {settled !== '' && (
                    <div data-find-field="text" data-quote-answer className="contents">
                        <ReplyMarkdown text={settled} streaming={false} arriving={sawWriting} />
                    </div>
                )}
                {item.streaming && <Writing />}
            </div>
        );
    }
    if (mode === 'whole' && item.streaming) {
        return (
            <div className="-mx-1 px-1 pb-2">
                <ReplyHeading chatId={chatId} />
                <Writing />
            </div>
        );
    }
    return (
        <div data-find-item={item.id} className={clsx('-mx-1 px-1 pb-2', mode === 'whole' && sawWriting && WHOLE_FADE_CLASS)}>
            <ReplyHeading chatId={chatId} />
            <div data-find-field="text" data-quote-answer className="contents">
                <ReplyMarkdown text={reveal.text} streaming={reveal.active} />
            </div>
            {live && item.text === '' && <span className="inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-text-faint align-middle" />}
        </div>
    );
}

/*
 * What the model thought before it answered. It shimmers while it streams and folds itself away
 * once the answer starts, because the thought is worth a glance and rarely worth reading twice.
 */
export function ThinkingRow({ chatId, item: derived }: { chatId: string; item: ChatThinkingItem }) {
    const { t } = useTranslation('chat');
    const item = useCurrentItem(chatId, derived);
    const mode = useSettings((s) => s.chatStreaming);
    const [open, setOpen] = useState(false);
    const reveal = useRevealedText(item.text, mode === 'words' && item.streaming);
    // A block at a time, the paragraphs of the thought that closed are shown as they land.
    const settled = mode === 'blocks' && item.streaming ? settledBlocksText(item.text) : null;
    // Whole, the thought stays behind "Thinking…" until it is done and then folds like any other.
    const shown = open || reveal.active || (settled !== null && settled !== '');
    const text = settled ?? reveal.text;
    useOpenForFind(item.id, 'text', setOpen);
    return (
        <div data-find-item={item.id} className="-mx-1 px-1 pb-2">
            <button className="flex items-center gap-2 text-xs text-text-muted hover:text-text" disabled={item.streaming} onClick={() => setOpen((o) => !o)}>
                <span className={ROW_GUTTER}>
                    <Icon icon={Brain} size={12} />
                </span>
                {item.streaming ? (
                    <span className="chat-live-text">{t('rows.thinking.live')}</span>
                ) : (
                    <>
                        <span>{t('rows.thinking.thoughtFor', { duration: formatElapsedShort((item.endedAt ?? item.createdAt) - item.createdAt) })}</span>
                        <Icon icon={ChevronDown} size={12} className={clsx('transition-transform', open && 'rotate-180')} />
                    </>
                )}
            </button>
            {shown && text !== '' && (
                <div data-find-field="text" className="mt-1 border-l border-border pl-2.5 text-sm whitespace-pre-wrap text-text-faint select-text">
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

/*
 * A line from the machine in the thread. A note of more than one line (a summary a fork sent back)
 * shows its first line and folds the rest open as markdown; one that came from a fork leads to it.
 */
export function NoteRow({ id, level, text, from }: { id: string; level: 'info' | 'warning' | 'error'; text: string; from?: string }) {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(false);
    const breakAt = text.indexOf('\n');
    const head = breakAt === -1 ? text : text.slice(0, breakAt);
    const rest = breakAt === -1 ? '' : text.slice(breakAt + 1).trim();
    useOpenForFind(id, 'output', setOpen);
    return (
        <div
            data-find-item={id}
            className={clsx(
                '-mx-1 mb-0.5 flex min-h-7 items-start gap-2 px-1 py-1 text-xs',
                level === 'error' ? 'text-status-error' : level === 'warning' ? 'text-status-needs-you' : 'text-text-faint'
            )}
        >
            <span className={ROW_GUTTER}>{NOTE_ICON[level]}</span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                    <span data-find-field="summary" className="select-text">
                        {head}
                    </span>
                    {rest !== '' && (
                        <button className="text-text-muted hover:text-text" onClick={() => setOpen(!open)}>
                            {open ? t('rows.note.hide') : t('rows.note.show')}
                        </button>
                    )}
                    {from !== undefined && <OpenChatButton chatId={from} />}
                </div>
                {open && rest !== '' && (
                    <div data-find-field="output" className="mt-1 text-text-muted select-text">
                        <MessageMarkdown text={rest} />
                    </div>
                )}
            </div>
        </div>
    );
}

/* "Open fork" on a note a fork sent, while that fork is still in the project. */
function OpenChatButton({ chatId }: { chatId: string }) {
    const { t } = useTranslation('chat');
    const place = useChatPlace(chatId);
    if (place.title === null) {
        return null;
    }
    return (
        <button className="text-text-muted hover:text-text" onClick={place.go}>
            {t('rows.note.openFork')}
        </button>
    );
}

/*
 * The header of a turn the agent started itself, in place of the message of the person that is
 * missing. It is one line: what the sub-agent came back with lives on that agent's own row, behind
 * "Show result". When the CLI named the sub-agent it woke up about, the header opens that row.
 */
export function AgentTurnRow({ label, onOpen }: { label: string; onOpen?: () => void }) {
    const line = 'mb-0.5 flex h-7 w-full items-center gap-2 text-left text-xs text-text-muted';
    // A header with nowhere to go is text to read and copy; one that opens a row is a button.
    const content = (
        <>
            <span className={ROW_GUTTER}>
                <Icon icon={Bot} size={12} />
            </span>
            <span className={clsx('min-w-0 truncate', onOpen === undefined && 'select-text')}>{label}</span>
        </>
    );
    if (onOpen === undefined) {
        return <div className={line}>{content}</div>;
    }
    return (
        <button className={clsx(line, 'hover:text-text')} onClick={onOpen}>
            {content}
        </button>
    );
}

/* A dashed line, since what stands above it is still there for the reader but only a summary to the agent. */
export function CompactionRow({ preTokens }: { preTokens: number | null }) {
    const { t } = useTranslation('chat');
    return (
        <div className="flex items-center gap-3 pb-3 text-xs text-text-faint">
            <span className="grow border-t border-dashed border-border" />
            <Tooltip label={t('rows.compaction.summary')}>
                <span>{preTokens ? t('rows.compaction.from', { tokens: formatTokens(preTokens) }) : t('rows.compaction.plain')}</span>
            </Tooltip>
            <span className="grow border-t border-dashed border-border" />
        </div>
    );
}

const DECISION_ICON: Record<Exclude<ChatApprovalItem['decision'], 'pending'>, React.ReactNode> = {
    allow: <Icon icon={Check} size={12} />,
    'allow-always': <Icon icon={Check} size={12} />,
    deny: <Icon icon={X} size={12} />,
    cancelled: <Icon icon={X} size={12} />
};

/* The outcome of a permission request, one quiet line; the request itself lived on the composer. */
export function ApprovalHistoryRow({ item }: { item: ChatApprovalItem }) {
    const { t } = useTranslation('chat');
    if (item.decision === 'pending') {
        return null;
    }
    return (
        <div className="-mx-1 mb-0.5 flex h-7 items-center gap-2 px-1 text-xs text-text-faint">
            <span className={clsx(ROW_GUTTER, item.decision === 'deny' && 'text-status-error')}>{DECISION_ICON[item.decision]}</span>
            <span className={clsx(item.decision === 'deny' && 'text-status-error')}>{t(`rows.approval.${item.decision}`)}</span>
            <span className="text-text-muted">{item.toolName}</span>
            <span className="min-w-0 truncate font-mono">{toolSummary(item.toolName, item.input)}</span>
        </div>
    );
}

export function QuestionHistoryRow({ item }: { item: ChatQuestionItem }) {
    const { t } = useTranslation('chat');
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
                        {item.state === 'cancelled' && <span className="ml-1.5">{t('rows.question.notAnswered')}</span>}
                        {item.state === 'dismissed' && <span className="ml-1.5">{t('rows.question.dismissed')}</span>}
                    </span>
                </div>
            ))}
        </div>
    );
}

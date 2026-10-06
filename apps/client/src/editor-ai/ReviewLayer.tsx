import { useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useStore } from 'zustand';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button, ButtonGroup, IconButton } from '@adecore/ui';
import { ProviderLogo } from '@adecore/agents-react/agents/ProviderLogo';
import type { Editor } from '@adecore/editor';
import { focusChat } from '@/plan/plan-actions';
import { colorOfChat } from './agent-runs';
import { commentRowId, type AgentReview, type ReviewItem } from './agent-review';
import { useChatIdentity, useProviderName } from './use-chat-identity';

/* The gutter's width keeps a row's words in line with the code beside it. */
const INDENT = { paddingLeft: 'var(--se-gutter-width)' };

/* A button of a change is a chip of about a code line, which a `Button` (24px) is too tall to be inside one. */
const CHIP = 'h-4.5 shrink-0 rounded-sm px-1.75 text-xs leading-4.5 font-sans';

/* Keep, Undo and Comment of one change, where the change stands: after its first line, or after the lines it removed. */
function ReviewActions({ review, item }: { review: AgentReview; item: ReviewItem }) {
    const { t } = useTranslation('panels');
    const commenting = useStore(review.store, (state) => state.commenting?.runId === item.run.id);
    const chat = useChatIdentity(item.run.chatId);

    return (
        <span className="inline-flex h-5 items-center gap-0.75">
            <button type="button" className={clsx(CHIP, 'bg-accent text-accent-text hover:brightness-90')} onClick={() => review.keep(item.run.id)}>
                {t('file.review.keep')}
            </button>
            {item.undoable && (
                <button type="button" className={clsx(CHIP, 'bg-surface-hover text-text hover:bg-border')} onClick={() => review.undo(item.run.id)}>
                    {t('file.review.undo')}
                </button>
            )}
            {chat.exists && (
                <button
                    type="button"
                    className={clsx(CHIP, 'bg-surface-hover text-text hover:bg-border aria-pressed:bg-border')}
                    aria-pressed={commenting}
                    onClick={() => (commenting ? review.closeComment() : review.openComment(item.run.id))}
                >
                    {t('file.review.comment')}
                </button>
            )}
        </span>
    );
}

/*
 * The lines a run took out, tinted as removed and faded, with the words the added lines replaced marked.
 * A removal that put nothing in its place has no line to carry its buttons, so they stand here, after the
 * last of the lines.
 */
function RemovedRow({ review, editor, item }: { review: AgentReview; editor: Editor; item: ReviewItem }) {
    const { t } = useTranslation('panels');
    const code = useRef<HTMLDivElement>(null);
    const [carrier, setCarrier] = useState<HTMLElement | null>(null);
    const before = item.run.before;
    const carries = item.endLine < item.startLine;
    const replaced = JSON.stringify(item.replaced);

    useLayoutEffect(() => {
        const element = code.current;
        if (element === null) {
            return;
        }
        element.replaceChildren();
        if (before !== undefined && before.length > 0) {
            editor.renderCode(element, before.join('\n'), {
                sign: '-',
                color: '--editor-deleted',
                faded: true,
                emphasis: JSON.parse(replaced) as Array<Array<[number, number]>>
            });
        }
        const last = element.querySelectorAll<HTMLElement>('.se-code-text').item(before === undefined ? 0 : before.length - 1);
        if (!carries || last === null) {
            setCarrier(null);
            return;
        }
        const span = element.ownerDocument.createElement('span');
        span.className = 'ml-7 inline-block align-top';
        last.append(span);
        setCarrier(span);
    }, [editor, before, replaced, carries]);

    return (
        <>
            <div ref={code} aria-label={t('file.review.removed')} />
            {carries &&
                (carrier === null ? (
                    <div className="flex h-6 items-center text-xs" style={INDENT}>
                        <ReviewActions review={review} item={item} />
                    </div>
                ) : (
                    createPortal(<ReviewActions review={review} item={item} />, carrier)
                ))}
        </>
    );
}

/* The comment being typed under a change, which goes to the chat's draft and nowhere else. */
function CommentCard({ review, item }: { review: AgentReview; item: ReviewItem }) {
    const { t } = useTranslation('panels');
    const text = useStore(review.store, (state) => state.commenting?.text ?? '');
    const chat = useChatIdentity(item.run.chatId);
    const name = useProviderName(item.run.provider);

    function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            review.submitComment();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            review.closeComment();
        }
    }

    return (
        <div className="py-1.5 pr-4 text-xs" style={INDENT}>
            <div className="flex w-140 max-w-full flex-col gap-2.5 rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-text shadow-(--float-shadow)">
                <textarea
                    autoFocus
                    rows={2}
                    aria-label={t('file.review.commentLabel')}
                    placeholder={t('file.review.commentPlaceholder', { name })}
                    spellCheck={false}
                    className="min-h-9.5 resize-none bg-transparent text-sm leading-5 text-text outline-none placeholder:text-text-faint"
                    value={text}
                    onChange={(event) => review.setComment(event.target.value)}
                    onKeyDown={onKeyDown}
                />
                <div className="flex items-center gap-1.5">
                    <span className="min-w-0 grow truncate text-text-muted">
                        {t('file.review.commentAdds', { label: review.rangeLabel(item), chat: chat.title ?? name })}
                    </span>
                    <Button size="xs" onClick={() => review.closeComment()}>
                        {t('common:action.cancel')}
                    </Button>
                    <Button size="xs" variant="primary" disabled={text.trim() === ''} onClick={() => review.submitComment()}>
                        {t('file.review.addToDraft')}
                    </Button>
                </div>
            </div>
        </div>
    );
}

/* The rows of a review in the editor: portals into the elements it hands out, so the editor owns where they stand. */
export function ReviewLayer({ review, editor }: { review: AgentReview; editor: Editor }) {
    const items = useStore(review.store, (state) => state.items);
    const commenting = useStore(review.store, (state) => state.commenting);
    useSyncExternalStore(review.rows.subscribe, review.rows.getVersion);
    useSyncExternalStore(review.actions.subscribe, review.actions.getVersion);

    return (
        <>
            {items.map((item) => {
                const removed = review.rows.container(item.run.id);
                const actions = review.actions.container(item.run.id);
                const comment = commenting?.runId === item.run.id ? review.rows.container(commentRowId(item.run.id)) : undefined;
                return (
                    <span key={item.run.id}>
                        {removed !== undefined && createPortal(<RemovedRow review={review} editor={editor} item={item} />, removed)}
                        {actions !== undefined && createPortal(<ReviewActions review={review} item={item} />, actions)}
                        {comment !== undefined && createPortal(<CommentCard review={review} item={item} />, comment)}
                    </span>
                );
            })}
        </>
    );
}

/* The line over the editor that says how many changes wait, steps between them and answers them all. */
export function ReviewBar({ review }: { review: AgentReview }) {
    const { t } = useTranslation('panels');
    const { items, current } = useStore(review.store, (state) => state);
    const first = items[0];
    const chats = new Set(items.map((item) => item.run.chatId));
    const turns = new Set(items.map((item) => item.run.turnId));
    const single = chats.size === 1 && first !== undefined ? first.run : null;
    const chat = useChatIdentity(single?.chatId ?? '');
    const provider = useProviderName(single?.provider);
    if (first === undefined) {
        return null;
    }
    const name = chat.title ?? provider;
    const turn = turns.size === 1 ? first.run.turn : undefined;
    const message =
        single === null
            ? t('file.review.summaryMany', { count: items.length })
            : turn === undefined
              ? t('file.review.summary', { name, count: items.length })
              : t('file.review.summaryTurn', { name, turn, count: items.length });

    return (
        <div
            className="flex min-h-9.5 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface py-1.5 pr-2.5 pl-4 text-sm text-text"
            role="status"
        >
            {single !== null && single.provider !== undefined && (single.provider === 'claude' || single.provider === 'codex') && (
                <span className="flex shrink-0 items-center" style={{ color: `var(${colorOfChat(single.chatId)})` }}>
                    <ProviderLogo provider={single.provider} size={14} />
                </span>
            )}
            <span className="min-w-0 truncate">{message}</span>
            <span className="flex items-center gap-1 text-xs text-text-muted">
                {t('file.review.position', { current: (current ?? 0) + 1, total: items.length })}
                <ButtonGroup>
                    <IconButton icon={ArrowUp} size="sm" label={t('file.review.previous')} onClick={() => review.step(-1)} />
                    <IconButton icon={ArrowDown} size="sm" label={t('file.review.next')} onClick={() => review.step(1)} />
                </ButtonGroup>
            </span>
            <span className="grow" />
            {single !== null && chat.exists && (
                <Button size="xs" onClick={() => focusChat(single.chatId)}>
                    {t('file.agent.openChat')}
                </Button>
            )}
            <Button size="xs" variant="secondary" disabled={!items.some((item) => item.undoable)} onClick={() => review.undoAll()}>
                {t('file.review.undoAll')}
            </Button>
            <Button size="xs" variant="primary" onClick={() => review.keepAll()}>
                {t('file.review.keepAll')}
            </Button>
        </div>
    );
}

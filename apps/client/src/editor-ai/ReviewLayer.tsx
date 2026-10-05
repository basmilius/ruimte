import { useLayoutEffect, useRef, useSyncExternalStore, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { ArrowDown, ArrowUp, MessageSquare } from 'lucide-react';
import { Button, ButtonGroup, Icon, IconButton, Input } from '@basmilius/desktop-ui';
import { ProviderLogo } from '@ruimte/agents-react/agents/ProviderLogo';
import type { Editor } from '@ruimte/smart-editor';
import { focusChat } from '@/plan/plan-actions';
import { colorOfChat } from './agent-runs';
import type { AgentReview, ReviewItem } from './agent-review';
import { useChatIdentity, useProviderName } from './use-chat-identity';

/* The gutter's width keeps a row's words in line with the code beside it. */
const INDENT = { paddingLeft: 'var(--se-gutter-width)' };

/* The comment being typed under a change, which goes to the chat's draft and nowhere else. */
function CommentField({ review, item }: { review: AgentReview; item: ReviewItem }) {
    const { t } = useTranslation('panels');
    const text = useStore(review.store, (state) => state.commenting?.text ?? '');
    const chat = useChatIdentity(item.run.chatId);
    const name = useProviderName(item.run.provider);

    function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            review.submitComment();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            review.closeComment();
        }
    }

    return (
        <div className="flex flex-col gap-2 py-1.5 pr-3" style={INDENT}>
            <Input
                autoFocus
                size="sm"
                aria-label={t('file.review.commentLabel')}
                placeholder={t('file.review.commentPlaceholder', { name })}
                spellCheck={false}
                value={text}
                onChange={(event) => review.setComment(event.target.value)}
                onKeyDown={onKeyDown}
            />
            <div className="flex items-center gap-2 text-xs text-text-faint">
                <span className="min-w-0 grow truncate">{t('file.review.commentAdds', { label: review.rangeLabel(item), chat: chat.title ?? name })}</span>
                <Button size="xs" onClick={() => review.closeComment()}>
                    {t('common:action.cancel')}
                </Button>
                <Button size="xs" variant="primary" disabled={text.trim() === ''} onClick={() => review.submitComment()}>
                    {t('file.review.addToDraft')}
                </Button>
            </div>
        </div>
    );
}

/* What one run of an agent asks of a person: the lines it removed, and Keep, Undo and Comment. */
function ReviewRow({ review, editor, item }: { review: AgentReview; editor: Editor; item: ReviewItem }) {
    const { t } = useTranslation('panels');
    const removed = useRef<HTMLDivElement>(null);
    const commenting = useStore(review.store, (state) => state.commenting?.runId === item.run.id);
    const chat = useChatIdentity(item.run.chatId);
    const name = useProviderName(item.run.provider);
    const before = item.run.before;
    const logo = item.run.provider === 'claude' || item.run.provider === 'codex' ? item.run.provider : null;

    useLayoutEffect(() => {
        const element = removed.current;
        if (element === null) {
            return;
        }
        element.replaceChildren();
        if (before !== undefined && before.length > 0) {
            editor.renderCode(element, before.join('\n'), { sign: '-', color: '--editor-deleted' });
        }
    }, [editor, before]);

    return (
        <div className="flex flex-col text-xs">
            <div ref={removed} aria-label={t('file.review.removed')} />
            <div className="flex h-7 items-center gap-2 pr-3" style={INDENT}>
                <span className="flex min-w-0 items-center gap-1.5 text-text-muted">
                    <span className="flex shrink-0 items-center" style={{ color: `var(${colorOfChat(item.run.chatId)})` }}>
                        {logo === null ? <span className="size-2 rounded-full bg-current" /> : <ProviderLogo provider={logo} size={12} />}
                    </span>
                    <span className="truncate">{item.run.turn === undefined ? name : `${name} · ${t('file.agent.turn', { turn: item.run.turn })}`}</span>
                </span>
                <span className="grow" />
                <Button size="xs" variant="secondary" onClick={() => review.keep(item.run.id)}>
                    {t('file.review.keep')}
                </Button>
                {item.undoable && (
                    <Button size="xs" variant="secondary" onClick={() => review.undo(item.run.id)}>
                        {t('file.review.undo')}
                    </Button>
                )}
                {chat.exists && (
                    <Button
                        size="xs"
                        variant="secondary"
                        aria-pressed={commenting}
                        onClick={() => (commenting ? review.closeComment() : review.openComment(item.run.id))}
                    >
                        {t('file.review.comment')}
                    </Button>
                )}
            </div>
            {commenting && <CommentField review={review} item={item} />}
        </div>
    );
}

/* The rows of a review in the editor: portals into the elements it hands out, so the editor owns where they stand. */
export function ReviewLayer({ review, editor }: { review: AgentReview; editor: Editor }) {
    const items = useStore(review.store, (state) => state.items);
    useSyncExternalStore(review.rows.subscribe, review.rows.getVersion);

    return (
        <>
            {items.map((item) => {
                const container = review.rows.container(item.run.id);
                return container === undefined ? null : (
                    <span key={item.run.id}>{createPortal(<ReviewRow review={review} editor={editor} item={item} />, container)}</span>
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
        <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-1.5 text-sm text-text" role="status">
            {single !== null && single.provider !== undefined && (single.provider === 'claude' || single.provider === 'codex') && (
                <span className="flex shrink-0 items-center" style={{ color: `var(${colorOfChat(single.chatId)})` }}>
                    <ProviderLogo provider={single.provider} size={14} />
                </span>
            )}
            <span className="min-w-0 truncate">{message}</span>
            <span className="flex items-center gap-1 text-xs text-text-muted">
                {current === null ? items.length : t('file.review.position', { current: current + 1, total: items.length })}
                <ButtonGroup>
                    <IconButton icon={ArrowUp} size="sm" label={t('file.review.previous')} onClick={() => review.step(-1)} />
                    <IconButton icon={ArrowDown} size="sm" label={t('file.review.next')} onClick={() => review.step(1)} />
                </ButtonGroup>
            </span>
            <span className="grow" />
            {single !== null && chat.exists && (
                <Button size="xs" onClick={() => focusChat(single.chatId)}>
                    <Icon icon={MessageSquare} size={14} />
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

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bookmark, Check, Copy, GitFork } from 'lucide-react';
import { placeBookmark, removeBookmark } from '@/chat/bookmarks';
import { forkRefusal } from '@/chat/logic/fork';
import type { TimelineRow } from '@/chat/logic/timeline';
import { messageTextOf } from '@/chat/logic/timeline-copy';
import { useChatRow, useChats } from '@/state/chats';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useUi } from '@/state/ui';
import { BTN_GROUP } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const COPIED_MS = 1500;

type MessageRow = Extract<TimelineRow, { kind: 'user' | 'assistant' }>;

/*
 * Bookmark, fork and copy under a message, shown while the pointer or the focus is on a
 * `group/message`. The row always takes its height, so the virtualizer never measures it again on a
 * hover. Like the strip's card, it leaves out an action the message cannot take right now.
 */
export function MessageActions({ chatId, row }: { chatId: string; row: MessageRow }) {
    const { t } = useTranslation('chat');
    const endpointId = useEndpointId();
    const turnId = row.item.turnId;
    const bookmark = useChatRow(chatId, (chat) => chat?.bookmarks?.find((candidate) => candidate.itemId === row.id) ?? null);
    const canFork = useChatRow(chatId, (chat) => turnId !== null && forkRefusal(chat?.info ?? null, chat?.structure[turnId]) === null);
    const streaming = useChatRow(chatId, (chat) => {
        const item = chat?.items[row.id];
        return item?.kind === 'assistant' && item.streaming;
    });
    const hasText = useChatRow(chatId, (chat) => {
        const item = chat?.items[row.id];
        return (item?.kind === 'user' || item?.kind === 'assistant') && item.text.trim() !== '';
    });
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) {
            return;
        }
        const timer = setTimeout(() => setCopied(false), COPIED_MS);
        return () => clearTimeout(timer);
    }, [copied]);

    // The row was derived from the structure, which a delta leaves alone; the text to copy is the one held now.
    const copy = (): void => {
        const item = useChats.getState().byKey[endpointKey(endpointId, chatId)]?.items[row.id];
        const text = messageTextOf(item?.kind === row.kind ? ({ ...row, item } as MessageRow) : row);
        if (text !== null) {
            copyText(text);
            setCopied(true);
        }
    };

    return (
        <div
            role="toolbar"
            aria-label={t('timeline.actions.label')}
            className={clsx(
                'flex h-7 items-center opacity-0 transition-opacity group-has-focus-visible/message:opacity-100 group-hover/message:opacity-100',
                row.kind === 'user' ? 'justify-end' : '-ml-1.5'
            )}
        >
            {!streaming && (
                <span className={BTN_GROUP}>
                    <Tooltip label={bookmark === null ? t('bookmarks.add') : t('bookmarks.remove')} name>
                        <button
                            type="button"
                            className={clsx('icon-btn h-7 w-7 rounded-md', bookmark !== null && 'text-accent')}
                            onClick={() => void (bookmark === null ? placeBookmark(endpointId, chatId, row.id) : removeBookmark(endpointId, chatId, bookmark))}
                        >
                            <Icon icon={Bookmark} size={14} />
                        </button>
                    </Tooltip>
                    {canFork && turnId !== null && (
                        <Tooltip label={t('timeline.menu.forkFromHere')} name>
                            <button type="button" className="icon-btn h-7 w-7 rounded-md" onClick={() => useUi.getState().setForkDialog({ chatId, turnId })}>
                                <Icon icon={GitFork} size={14} />
                            </button>
                        </Tooltip>
                    )}
                    {hasText && (
                        <Tooltip label={copied ? t('timeline.actions.copied') : t('timeline.menu.copyMessage')} name>
                            <button type="button" className="icon-btn h-7 w-7 rounded-md" onClick={copy}>
                                <Icon icon={copied ? Check : Copy} size={14} />
                            </button>
                        </Tooltip>
                    )}
                </span>
            )}
        </div>
    );
}

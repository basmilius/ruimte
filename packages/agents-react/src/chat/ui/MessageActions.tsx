import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bookmark, Check, Copy, GitFork } from 'lucide-react';
import { placeBookmark } from '../bookmarks';
import { forkRefusal } from '../logic/fork';
import type { TimelineRow } from '../logic/timeline';
import { markdownOf, messageTextOf } from '../logic/timeline-copy';
import { chatHost } from '../../host';
import { useChatScope } from '../../scope';
import { useChatRow, useChats } from '../../state/chats';
import { BTN_GROUP } from '@ruimte/ui/classes';
import { copyText } from '@ruimte/ui/clipboard';
import { Icon } from '@ruimte/ui/Icon';
import { Tooltip } from '@ruimte/ui/Tooltip';

const COPIED_MS = 1500;

type MessageRow = Extract<TimelineRow, { kind: 'user' | 'assistant' }>;

/*
 * Bookmark, fork and copy under a message, shown while the pointer or the focus is on a
 * `group/message`. The row always takes its height, so the virtualizer never measures it again on a
 * hover. Like the strip's card, it leaves out an action the message cannot take right now.
 */
export function MessageActions({ chatId, row }: { chatId: string; row: MessageRow }) {
    const { t } = useTranslation('agent-chat');
    const scope = useChatScope();
    const { fork } = chatHost();
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
    const copy = (plain: boolean): void => {
        const item = useChats.getState().byKey[scope.keyOf(chatId)]?.items[row.id];
        const current = item?.kind === row.kind ? ({ ...row, item } as MessageRow) : row;
        const text = (plain ? null : markdownOf(current)) ?? messageTextOf(current);
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
                row.kind === 'user' ? '-mr-1.5 mt-1.5 justify-end' : '-ml-1.5'
            )}
        >
            {!streaming && (
                <span className={BTN_GROUP}>
                    {bookmark === null && (
                        <Tooltip label={t('bookmarks.add')} name>
                            <button type="button" className="icon-btn icon-btn-sm" onClick={() => void placeBookmark(scope, chatId, row.id)}>
                                <Icon icon={Bookmark} size={14} />
                            </button>
                        </Tooltip>
                    )}
                    {canFork && turnId !== null && fork !== null && (
                        <Tooltip label={t('timeline.menu.forkFromHere')} name>
                            <button type="button" className="icon-btn icon-btn-sm" onClick={() => fork(chatId, turnId)}>
                                <Icon icon={GitFork} size={14} />
                            </button>
                        </Tooltip>
                    )}
                    {hasText && (
                        <Tooltip label={copied ? t('timeline.actions.copied') : t('timeline.menu.copyMessage')} name>
                            <button type="button" className="icon-btn icon-btn-sm" onClick={(e) => copy(e.shiftKey)}>
                                <Icon icon={copied ? Check : Copy} size={14} />
                            </button>
                        </Tooltip>
                    )}
                </span>
            )}
        </div>
    );
}

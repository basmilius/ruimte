import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bookmark, X } from 'lucide-react';
import { CHAT_BOOKMARK_LIMITS } from '@ruimte/contracts';
import { nameBookmark, placeBookmark, removeBookmark, useBookmarkNaming } from '@/chat/bookmarks';
import { useChatRow } from '@/state/chats';
import { endpointKey, useEndpointId } from '@/state/keys';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

interface MessageBookmarkProps {
    chatId: string;
    itemId: string;
    /* The side the message stands on: a person's message at the end, a reply at the start. */
    align: 'start' | 'end';
}

/*
 * The bookmark of one message in the thread. Without one it is a button that shows while the pointer
 * is on the message; with one it is a line over the message with the icon and the name, which opens
 * the name field. Drawn inside a `group/message`.
 */
export function MessageBookmark({ chatId, itemId, align }: MessageBookmarkProps) {
    const { t } = useTranslation('chat');
    const endpointId = useEndpointId();
    const chatKey = endpointKey(endpointId, chatId);
    const bookmark = useChatRow(chatId, (row) => row?.bookmarks?.find((candidate) => candidate.itemId === itemId) ?? null);
    const naming = useBookmarkNaming((s) => s.chatKey === chatKey && s.itemId === itemId);

    if (bookmark === null && !naming) {
        return (
            <Tooltip label={t('bookmarks.add')} name>
                <button
                    className={clsx(
                        'icon-btn absolute top-0 z-10 h-6 w-6 rounded-md bg-surface opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100',
                        align === 'end' ? 'left-0' : 'right-0'
                    )}
                    onClick={() => void placeBookmark(endpointId, chatId, itemId)}
                >
                    <Icon icon={Bookmark} size={14} />
                </button>
            </Tooltip>
        );
    }

    return (
        <div className={clsx('mb-1 flex min-h-6 min-w-0 items-center gap-1.5 text-xs', align === 'end' && 'justify-end')}>
            <Icon icon={Bookmark} size={12} className="shrink-0 fill-current text-accent" />
            {naming ? (
                <NameField
                    initial={bookmark?.name ?? ''}
                    onDone={(name) => {
                        useBookmarkNaming.getState().close();
                        if (name !== null) {
                            void nameBookmark(endpointId, chatId, itemId, name, bookmark?.name);
                        }
                    }}
                />
            ) : (
                <>
                    <Tooltip label={t('bookmarks.rename')}>
                        <button
                            className={clsx('min-w-0 truncate hover:text-text', bookmark?.name === undefined ? 'text-text-faint' : 'text-text-muted')}
                            onClick={() => useBookmarkNaming.getState().open(chatKey, itemId)}
                        >
                            {bookmark?.name ?? t('bookmarks.unnamed')}
                        </button>
                    </Tooltip>
                    {bookmark !== null && (
                        <Tooltip label={t('bookmarks.remove')} name>
                            <button
                                className="icon-btn h-5 w-5 shrink-0 rounded opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100"
                                onClick={() => void removeBookmark(endpointId, chatId, bookmark)}
                            >
                                <Icon icon={X} size={12} />
                            </button>
                        </Tooltip>
                    )}
                </>
            )}
        </div>
    );
}

/* Settles with the name on Enter or when the focus leaves, and with null on Escape, which keeps the name as it was. */
function NameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
    const { t } = useTranslation('chat');
    const ref = useRef<HTMLInputElement>(null);
    const settled = useRef(false);

    // Again a frame later: the menu the field was opened from hands the focus back as it closes.
    useEffect(() => {
        ref.current?.focus();
        const frame = requestAnimationFrame(() => ref.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, []);

    const settle = (name: string | null): void => {
        if (settled.current) {
            return;
        }
        settled.current = true;
        onDone(name);
    };

    return (
        <input
            ref={ref}
            defaultValue={initial}
            maxLength={CHAT_BOOKMARK_LIMITS.name}
            placeholder={t('bookmarks.namePlaceholder')}
            aria-label={t('bookmarks.nameLabel')}
            className="h-6 w-64 max-w-full min-w-0 rounded-md bg-surface-sunken px-1.5 text-xs text-text outline-none ring-1 ring-accent placeholder:text-text-faint"
            onPointerDown={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => settle(e.currentTarget.value)}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    settle(e.currentTarget.value);
                }
                if (e.key === 'Escape') {
                    settle(null);
                }
            }}
        />
    );
}

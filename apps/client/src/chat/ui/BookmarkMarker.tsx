import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bookmark, Pencil, X } from 'lucide-react';
import { CHAT_BOOKMARK_LIMITS, type ChatBookmark } from '@ruimte/contracts';
import { nameBookmark, removeBookmark, useBookmarkNaming } from '@/chat/bookmarks';
import { bookmarkLabel } from '@/chat/logic/bookmarks';
import { endpointKey, useEndpointId } from '@/state/keys';
import { BTN_GROUP } from '@ruimte/ui/classes';
import { Icon } from '@ruimte/ui/Icon';
import { Tooltip } from '@ruimte/ui/Tooltip';

interface BookmarkMarkerProps {
    chatId: string;
    /* The message the bookmark is on, which for a folded turn is not the row it is drawn before. */
    itemId: string;
    bookmark: ChatBookmark | null;
}

/*
 * A bookmark as a chapter line across the thread, drawn before the message it marks. Without a
 * bookmark it only stands while the name field of a mark still on its way to the machine is open.
 */
export function BookmarkMarker({ chatId, itemId, bookmark }: BookmarkMarkerProps) {
    const { t } = useTranslation('chat');
    const endpointId = useEndpointId();
    const chatKey = endpointKey(endpointId, chatId);
    const naming = useBookmarkNaming((s) => s.chatKey === chatKey && s.itemId === itemId);

    if (bookmark === null && !naming) {
        return null;
    }

    return (
        <div className="group/bookmark mb-2 flex h-7 min-w-0 items-center gap-2 text-xs select-none">
            <Icon icon={Bookmark} size={14} className="shrink-0 text-accent" />
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
                bookmark !== null && (
                    <span className={clsx('min-w-0 truncate', bookmark.name === undefined ? 'text-text-muted' : 'text-text')}>{bookmarkLabel(bookmark)}</span>
                )
            )}
            <span className="min-w-6 grow border-t border-border" />
            {bookmark !== null && !naming && (
                <span
                    className={clsx(
                        BTN_GROUP,
                        '-ml-2 max-w-0 shrink-0 overflow-hidden opacity-0 group-hover/bookmark:ml-0 group-hover/bookmark:max-w-none group-hover/bookmark:opacity-100 group-has-focus-visible/bookmark:ml-0 group-has-focus-visible/bookmark:max-w-none group-has-focus-visible/bookmark:opacity-100'
                    )}
                >
                    <Tooltip label={t('bookmarks.rename')} name>
                        <button type="button" className="icon-btn icon-btn-xs" onClick={() => useBookmarkNaming.getState().open(chatKey, itemId)}>
                            <Icon icon={Pencil} size={12} />
                        </button>
                    </Tooltip>
                    <Tooltip label={t('bookmarks.remove')} name>
                        <button type="button" className="icon-btn icon-btn-xs" onClick={() => void removeBookmark(endpointId, chatId, bookmark)}>
                            <Icon icon={X} size={12} />
                        </button>
                    </Tooltip>
                </span>
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
            className="field field-sm w-64 max-w-full min-w-0 select-text"
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

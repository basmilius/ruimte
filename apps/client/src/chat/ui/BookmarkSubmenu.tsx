import { useMemo, type MouseEvent } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { Bookmark, ChevronRight, Pencil, X } from 'lucide-react';
import { goToBookmark, removeBookmark } from '@/chat/bookmarks';
import { bookmarkLabel, bookmarksInThreadOrder } from '@/chat/logic/bookmarks';
import { useChatPlace } from '@/chat/ui/use-chat-place';
import { useChatRow } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { BTN_GROUP } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

type RowAction = 'rename' | 'remove';

const actionOf = (e: MouseEvent): RowAction | null => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-bookmark-action]')?.dataset.bookmarkAction;
    return action === 'rename' || action === 'remove' ? action : null;
};

/*
 * "Bookmarks" in the menu of a chat node or a chat view: the chat's bookmarks in the order of the
 * thread, each a jump to its message. Rename and remove sit on the row itself; the message's own
 * menu offers both to a keyboard. A chat without bookmarks draws nothing.
 */
export function BookmarkSubmenu({ chatId }: { chatId: string }) {
    const { t } = useTranslation('chat');
    const endpointId = useEndpointId();
    const bookmarks = useChatRow(chatId, (row) => row?.bookmarks);
    const order = useChatRow(chatId, (row) => row?.order);
    const place = useChatPlace(chatId);
    const sorted = useMemo(() => bookmarksInThreadOrder(bookmarks ?? [], order ?? []), [bookmarks, order]);
    if (sorted.length === 0) {
        return null;
    }
    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className="menu-item">
                <Icon icon={Bookmark} size={14} /> {t('bookmarks.menu')}
                <Icon icon={ChevronRight} size={14} className="ml-auto text-text-faint" />
            </Menu.SubmenuTrigger>
            <Menu.Portal>
                <Menu.Positioner className="z-(--z-popup)" sideOffset={4} alignOffset={-4}>
                    <Menu.Popup className="menu-popup max-w-80 min-w-56">
                        {sorted.map((bookmark) => (
                            <Menu.Item
                                key={bookmark.itemId}
                                className="menu-item group/bookmark"
                                onClick={(e) => {
                                    const action = actionOf(e);
                                    if (action === 'remove') {
                                        void removeBookmark(endpointId, chatId, bookmark);
                                        return;
                                    }
                                    if (!goToBookmark(endpointId, chatId, bookmark.itemId, action === 'rename')) {
                                        place.go();
                                    }
                                }}
                            >
                                <Icon icon={Bookmark} size={14} className="shrink-0 fill-current text-accent" />
                                <span className={clsx('min-w-0 grow truncate', bookmark.name === undefined && 'text-text-muted')}>
                                    {bookmarkLabel(bookmark)}
                                </span>
                                <span className={`${BTN_GROUP} -my-1 ml-2 shrink-0 opacity-0 group-data-[highlighted]/bookmark:opacity-100`}>
                                    <Tooltip label={t('bookmarks.rename')} name>
                                        <button type="button" tabIndex={-1} data-bookmark-action="rename" className="icon-btn h-6 w-6 rounded">
                                            <Icon icon={Pencil} size={12} />
                                        </button>
                                    </Tooltip>
                                    <Tooltip label={t('bookmarks.remove')} name>
                                        <button type="button" tabIndex={-1} data-bookmark-action="remove" className="icon-btn h-6 w-6 rounded">
                                            <Icon icon={X} size={12} />
                                        </button>
                                    </Tooltip>
                                </span>
                            </Menu.Item>
                        ))}
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.SubmenuRoot>
    );
}

import { useMemo, type MouseEvent } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bookmark, Pencil, X } from 'lucide-react';
import { goToBookmark, removeBookmark } from '../bookmarks';
import { bookmarkLabel, bookmarksInThreadOrder } from '../logic/bookmarks';
import { chatHost } from '../../host';
import { useChatScope } from '../../scope';
import { useChatRow } from '../../state/chats';
import { ButtonGroup, Icon, IconButton, Menu } from '@basmilius/desktop-ui';

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
    const { t } = useTranslation('agent-chat');
    const scope = useChatScope();
    const bookmarks = useChatRow(chatId, (row) => row?.bookmarks);
    const order = useChatRow(chatId, (row) => row?.order);
    const place = chatHost().useChatPlace(chatId);
    const sorted = useMemo(() => bookmarksInThreadOrder(bookmarks ?? [], order ?? []), [bookmarks, order]);
    if (sorted.length === 0) {
        return null;
    }
    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger>
                <Icon icon={Bookmark} size={14} /> {t('bookmarks.menu')}
            </Menu.SubmenuTrigger>
            <Menu.Popup className="max-w-80 min-w-56">
                {sorted.map((bookmark) => (
                    <Menu.Item
                        key={bookmark.itemId}
                        className="group/bookmark"
                        onClick={(e) => {
                            const action = actionOf(e);
                            if (action === 'remove') {
                                void removeBookmark(scope, chatId, bookmark);
                                return;
                            }
                            if (!goToBookmark(scope, chatId, bookmark.itemId, action === 'rename')) {
                                place.go();
                            }
                        }}
                    >
                        <Icon icon={Bookmark} size={14} className="shrink-0 text-accent" />
                        <span className={clsx('min-w-0 grow truncate', bookmark.name === undefined && 'text-text-muted')}>{bookmarkLabel(bookmark)}</span>
                        <ButtonGroup render={<span />} className="-my-1 ml-2 shrink-0 opacity-0 group-data-[highlighted]/bookmark:opacity-100">
                            <IconButton icon={Pencil} size="xs" label={t('bookmarks.rename')} tabIndex={-1} data-bookmark-action="rename" />
                            <IconButton icon={X} size="xs" label={t('bookmarks.remove')} tabIndex={-1} data-bookmark-action="remove" />
                        </ButtonGroup>
                    </Menu.Item>
                ))}
            </Menu.Popup>
        </Menu.SubmenuRoot>
    );
}

import { useMemo } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bookmark, Pencil, X } from 'lucide-react';
import { goToBookmark, removeBookmark } from '../bookmarks';
import { bookmarkLabel, bookmarksInThreadOrder } from '../logic/bookmarks';
import { chatHost } from '../../host';
import { useChatScope } from '../../scope';
import { useChatRow } from '../../state/chats';
import { Icon, Menu } from '@adecore/ui';

/*
 * "Bookmarks" in the menu of a chat node or a chat view: the chat's bookmarks in the order of the
 * thread, each a jump to its message, with rename and remove on the row. A chat without bookmarks
 * draws nothing.
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

    const go = (itemId: string, rename: boolean): void => {
        if (!goToBookmark(scope, chatId, itemId, rename)) {
            place.go();
        }
    };

    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger>
                <Icon icon={Bookmark} size={14} /> {t('bookmarks.menu')}
            </Menu.SubmenuTrigger>
            <Menu.Popup className="max-w-80 min-w-56">
                {sorted.map((bookmark) => (
                    <Menu.Row key={bookmark.itemId} aria-label={bookmarkLabel(bookmark)}>
                        <Menu.Item onClick={() => go(bookmark.itemId, false)}>
                            <Icon icon={Bookmark} size={14} className="shrink-0 text-accent" />
                            <span className={clsx('min-w-0 grow truncate', bookmark.name === undefined && 'text-text-muted')}>{bookmarkLabel(bookmark)}</span>
                        </Menu.Item>
                        <Menu.RowAction icon={Pencil} label={t('bookmarks.rename')} onClick={() => go(bookmark.itemId, true)} />
                        <Menu.RowAction icon={X} label={t('bookmarks.remove')} onClick={() => void removeBookmark(scope, chatId, bookmark)} />
                    </Menu.Row>
                ))}
            </Menu.Popup>
        </Menu.SubmenuRoot>
    );
}

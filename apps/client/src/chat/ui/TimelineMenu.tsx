import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { BookmarkPlus, BookmarkX, Braces, Copy, Eye, FileText, GitFork, MessageSquare, Pencil, Scan } from 'lucide-react';
import { placeBookmark, removeBookmark, useBookmarkNaming } from '@/chat/bookmarks';
import { forkRefusal, turnIdOfRow } from '@/chat/logic/fork';
import { markdownOf, messageTextOf } from '@/chat/logic/timeline-copy';
import type { TimelineTarget } from '@/chat/logic/timeline-target';
import { openFileLink, useFileLinkCwd } from '@/shell/panels/file-links';
import { useChatRow } from '@/state/chats';
import { endpointKey, useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { MENU_SEPARATOR } from '@/ui/classes';
import { DisabledReason } from '@/ui/DisabledReason';
import { copyText } from '@/ui/clipboard';
import { Icon } from '@/ui/Icon';
import { selectAllWithin } from '@/ui/selection';
import { EDIT_SHORTCUTS } from '@/ui/shortcut';
import { Kbd } from '@/ui/Kbd';

/*
 * The menu behind a right-click in a thread. Copy is the reason it exists. Everything in a thread
 * is text a person may want out of it, and a whole message, a code block or the markdown an answer
 * was written in are each a different amount of that.
 */
export function TimelineMenuPopup({
    target,
    thread,
    chatId = null
}: {
    target: TimelineTarget;
    thread: RefObject<HTMLDivElement | null>;
    /* The chat whose own thread this is; a thread in its place (a sub-agent's) has nothing to fork. */
    chatId?: string | null;
}) {
    const { t } = useTranslation('chat');
    const message = target.row === null ? null : messageTextOf(target.row);
    const turnId = chatId === null || target.row === null ? null : turnIdOfRow(target.row);
    const forkBlocked = useChatRow(chatId ?? '', (row) => (turnId === null ? null : forkRefusal(row?.info ?? null, row?.structure[turnId])));
    const markdown = target.row === null ? null : markdownOf(target.row);
    const markable = chatId !== null && (target.row?.kind === 'user' || target.row?.kind === 'assistant') ? target.row.id : null;
    // A thread outside a chat (a sub-agent's transcript) has no cwd of its own; the project answers there.
    const cwd = useFileLinkCwd();
    const folder = useProject((s) => s.current?.folder ?? null);
    const openInPreview = (): void => {
        if (target.path !== null) {
            void openFileLink(cwd ?? folder, { path: target.path, ...(target.line === null ? {} : { line: target.line }), directory: false });
        }
    };
    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-(--z-popup)">
                <ContextMenu.Popup className="menu-popup">
                    <ContextMenu.Item className="menu-item" disabled={target.selection === ''} onClick={() => copyText(target.selection)}>
                        <Icon icon={Copy} size={14} /> {t('common:action.copy')} <Kbd shortcut={EDIT_SHORTCUTS.copy} />
                    </ContextMenu.Item>
                    {message !== null && (
                        <ContextMenu.Item className="menu-item" onClick={() => copyText(message)}>
                            <Icon icon={MessageSquare} size={14} /> {t('timeline.menu.copyMessage')}
                        </ContextMenu.Item>
                    )}
                    {target.code !== null && (
                        <ContextMenu.Item className="menu-item" onClick={() => copyText(target.code ?? '')}>
                            <Icon icon={Braces} size={14} /> {t('timeline.menu.copyCode')}
                        </ContextMenu.Item>
                    )}
                    {markdown !== null && (
                        <ContextMenu.Item className="menu-item" onClick={() => copyText(markdown)}>
                            <Icon icon={FileText} size={14} /> {t('timeline.menu.copyMarkdown')}
                        </ContextMenu.Item>
                    )}
                    {chatId !== null && turnId !== null && (
                        <DisabledReason reason={forkBlocked}>
                            <ContextMenu.Item
                                className="menu-item"
                                disabled={forkBlocked !== null}
                                onClick={() => useUi.getState().setForkDialog({ chatId, turnId })}
                            >
                                <Icon icon={GitFork} size={14} /> {t('timeline.menu.forkFromHere')}
                            </ContextMenu.Item>
                        </DisabledReason>
                    )}
                    {chatId !== null && markable !== null && <BookmarkMenuItems chatId={chatId} itemId={markable} />}
                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                    <ContextMenu.Item className="menu-item" onClick={() => selectAllWithin(thread.current)}>
                        <Icon icon={Scan} size={14} /> {t('common:action.selectAll')}
                    </ContextMenu.Item>
                    {target.path !== null && (
                        <>
                            <ContextMenu.Separator className={MENU_SEPARATOR} />
                            <ContextMenu.Item className="menu-item" onClick={openInPreview}>
                                <Icon icon={Eye} size={14} /> {t('timeline.menu.openInPreview')}
                            </ContextMenu.Item>
                        </>
                    )}
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}

/*
 * Place a bookmark on a message, or rename and remove the one it has: the same rows from the thread
 * and from the strip beside it. `onName` runs when a row opens the name field, which sits on the
 * bookmark's line over the message and so has to be on screen; the strip scrolls there, the thread
 * was clicked on it.
 */
export function BookmarkMenuItems({ chatId, itemId, onName }: { chatId: string; itemId: string; onName?: () => void }) {
    const { t } = useTranslation('chat');
    const endpointId = useEndpointId();
    const bookmark = useChatRow(chatId, (row) => row?.bookmarks?.find((candidate) => candidate.itemId === itemId) ?? null);
    if (bookmark === null) {
        return (
            <ContextMenu.Item
                className="menu-item"
                onClick={() => {
                    void placeBookmark(endpointId, chatId, itemId);
                    onName?.();
                }}
            >
                <Icon icon={BookmarkPlus} size={14} /> {t('bookmarks.add')}
            </ContextMenu.Item>
        );
    }
    return (
        <>
            <ContextMenu.Item
                className="menu-item"
                onClick={() => {
                    useBookmarkNaming.getState().open(endpointKey(endpointId, chatId), bookmark.itemId);
                    onName?.();
                }}
            >
                <Icon icon={Pencil} size={14} /> {t('bookmarks.rename')}
            </ContextMenu.Item>
            <ContextMenu.Item className="menu-item" onClick={() => void removeBookmark(endpointId, chatId, bookmark)}>
                <Icon icon={BookmarkX} size={14} /> {t('bookmarks.remove')}
            </ContextMenu.Item>
        </>
    );
}

import i18next from 'i18next';
import { create } from 'zustand';
import type { ChatBookmark } from '@ruimte/agent-contracts';
import { chatHost } from '../host';
import type { ChatScope } from '../scope';
import { jumpToTimelineItem } from './timeline-scroll';

/* The one message in the window whose bookmark has its name field open, by the scope's key of its chat. */
interface BookmarkNaming {
    chatKey: string | null;
    itemId: string | null;
    open(chatKey: string, itemId: string): void;
    close(): void;
}

export const useBookmarkNaming = create<BookmarkNaming>((set) => ({
    chatKey: null,
    itemId: null,
    open: (chatKey, itemId) => set({ chatKey, itemId }),
    close: () => set({ chatKey: null, itemId: null })
}));

const failed = (title: string, e: unknown): void => {
    chatHost().notify({ title, description: e instanceof Error ? e.message : String(e), kind: 'error' });
};

const add = async (scope: ChatScope, chatId: string, itemId: string, name?: string): Promise<boolean> => {
    try {
        await scope.chats.addBookmark(chatId, itemId, name);
        return true;
    } catch (e) {
        failed(i18next.t('agent-chat:bookmarks.addFailed'), e);
        return false;
    }
};

/* Marks a message and opens the field for its name at once, before the host answered. */
export const placeBookmark = async (scope: ChatScope, chatId: string, itemId: string): Promise<void> => {
    useBookmarkNaming.getState().open(scope.keyOf(chatId), itemId);
    if (!(await add(scope, chatId, itemId))) {
        useBookmarkNaming.getState().close();
    }
};

/*
 * The name a field settles on. A name goes through `addBookmark`, which also names a bookmark that
 * already stands, so a name typed before the mark itself landed is not refused.
 */
export const nameBookmark = async (scope: ChatScope, chatId: string, itemId: string, name: string, previous: string | undefined): Promise<void> => {
    const next = name.trim();
    if (next === (previous ?? '')) {
        return;
    }
    if (next !== '') {
        await add(scope, chatId, itemId, next);
        return;
    }
    try {
        await scope.chats.renameBookmark(chatId, itemId, '');
    } catch (e) {
        failed(i18next.t('agent-chat:bookmarks.renameFailed'), e);
    }
};

/* Takes a bookmark away at once; the toast puts it back, name and all. */
export const removeBookmark = async (scope: ChatScope, chatId: string, bookmark: ChatBookmark): Promise<void> => {
    try {
        await scope.chats.removeBookmark(chatId, bookmark.itemId);
    } catch (e) {
        failed(i18next.t('agent-chat:bookmarks.removeFailed'), e);
        return;
    }
    chatHost().notify({
        title: i18next.t('agent-chat:bookmarks.removed'),
        kind: 'deleted',
        action: { label: i18next.t('agent-chat:common.action.undo'), run: () => void add(scope, chatId, bookmark.itemId, bookmark.name) }
    });
};

/* Scrolls the chat's thread to the message, and opens its name field for a rename. False when no thread of it is on screen yet. */
export const goToBookmark = (scope: ChatScope, chatId: string, itemId: string, rename = false): boolean => {
    const key = scope.keyOf(chatId);
    if (rename) {
        useBookmarkNaming.getState().open(key, itemId);
    }
    return jumpToTimelineItem(key, itemId);
};

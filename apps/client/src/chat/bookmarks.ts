import i18next from 'i18next';
import { create } from 'zustand';
import type { ChatBookmark } from '@ruimte/contracts';
import { jumpToTimelineItem } from '@/chat/timeline-scroll';
import { endpointKey } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { chatClientFor } from '@/transport/connections';

/* The one message in the window whose bookmark has its name field open, by `endpointKey` of its chat. */
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
    useToasts.getState().show({ title, description: e instanceof Error ? e.message : String(e), kind: 'error' });
};

const clientOf = (endpointId: string) => {
    const client = chatClientFor(endpointId);
    if (client === null) {
        throw new Error(i18next.t('chat:bookmarks.offline'));
    }
    return client;
};

const add = async (endpointId: string, chatId: string, itemId: string, name?: string): Promise<boolean> => {
    try {
        await clientOf(endpointId).addBookmark(chatId, itemId, name);
        return true;
    } catch (e) {
        failed(i18next.t('chat:bookmarks.addFailed'), e);
        return false;
    }
};

/* Marks a message and opens the field for its name at once, before the machine answered. */
export const placeBookmark = async (endpointId: string, chatId: string, itemId: string): Promise<void> => {
    useBookmarkNaming.getState().open(endpointKey(endpointId, chatId), itemId);
    if (!(await add(endpointId, chatId, itemId))) {
        useBookmarkNaming.getState().close();
    }
};

/*
 * The name a field settles on. A name goes through `addBookmark`, which also names a bookmark that
 * already stands, so a name typed before the mark itself landed is not refused.
 */
export const nameBookmark = async (endpointId: string, chatId: string, itemId: string, name: string, previous: string | undefined): Promise<void> => {
    const next = name.trim();
    if (next === (previous ?? '')) {
        return;
    }
    if (next !== '') {
        await add(endpointId, chatId, itemId, next);
        return;
    }
    try {
        await clientOf(endpointId).renameBookmark(chatId, itemId, '');
    } catch (e) {
        failed(i18next.t('chat:bookmarks.renameFailed'), e);
    }
};

/* Takes a bookmark away at once; the toast puts it back, name and all. */
export const removeBookmark = async (endpointId: string, chatId: string, bookmark: ChatBookmark): Promise<void> => {
    try {
        await clientOf(endpointId).removeBookmark(chatId, bookmark.itemId);
    } catch (e) {
        failed(i18next.t('chat:bookmarks.removeFailed'), e);
        return;
    }
    useToasts.getState().show({
        title: i18next.t('chat:bookmarks.removed'),
        kind: 'deleted',
        action: { label: i18next.t('common:action.undo'), run: () => void add(endpointId, chatId, bookmark.itemId, bookmark.name) }
    });
};

/* Scrolls the chat's thread to the message, and opens its name field for a rename. False when no thread of it is on screen yet. */
export const goToBookmark = (endpointId: string, chatId: string, itemId: string, rename = false): boolean => {
    const key = endpointKey(endpointId, chatId);
    if (rename) {
        useBookmarkNaming.getState().open(key, itemId);
    }
    return jumpToTimelineItem(key, itemId);
};

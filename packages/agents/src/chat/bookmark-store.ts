import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CHAT_BOOKMARK_LIMITS, ChatBookmarksSchema, type ChatBookmark } from '@ruimte/agent-contracts';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';
import { KeyedSerializer } from '../serializer.ts';
import { ChatError } from './errors.ts';

const SUFFIX = '.bookmarks.json';

const BookmarkFileSchema = z.object({ version: z.literal(1), bookmarks: ChatBookmarksSchema });

export const bookmarkFileName = (chatId: string): string => `${encodeURIComponent(chatId)}${SUFFIX}`;

/* Whether a name in the chats folder is a bookmarks file, which the chat records beside it must not count as a chat. */
export const isBookmarkFileName = (name: string): boolean => name.endsWith(SUFFIX);

export type BookmarkListener = (chatId: string, bookmarks: ChatBookmark[]) => void;

/* A name as it is kept: trimmed, and none at all when nothing is left. */
const cleanName = (name: string | undefined): string | undefined => {
    const trimmed = name?.trim().slice(0, CHAT_BOOKMARK_LIMITS.name);
    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
};

const named = (bookmark: ChatBookmark, name: string | undefined): ChatBookmark => {
    const { name: _previous, ...rest } = bookmark;
    return name === undefined ? rest : { ...rest, name };
};

/*
 * The bookmarks of every chat, one file per chat beside its record under `<home>/chats`, apart
 * from the record, which is rewritten on every turn. One chain per chat puts two clients' clicks
 * after each other, and every change is told to the listeners from inside that chain, so the lists
 * go out in the order they were written.
 */
export class BookmarkStore {
    readonly dir: string;
    private readonly writes = new KeyedSerializer();
    private readonly listeners = new Set<BookmarkListener>();

    constructor(home: string) {
        this.dir = join(home, 'chats');
    }

    listen(listener: BookmarkListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /* The bookmarks of one chat in the order they were made, after any write still on its way. */
    read(chatId: string): Promise<ChatBookmark[]> {
        return this.writes.run(chatId, () => this.readFile(chatId));
    }

    /* Marks a message; one that already has a bookmark keeps it, and takes the name when one is given. */
    add(chatId: string, input: { itemId: string; excerpt: string; name?: string }, now: number): Promise<ChatBookmark[]> {
        return this.change(chatId, (bookmarks) => {
            const name = cleanName(input.name);
            const existing = bookmarks.find((bookmark) => bookmark.itemId === input.itemId);
            if (existing) {
                return name === undefined ? null : bookmarks.map((bookmark) => (bookmark === existing ? named(bookmark, name) : bookmark));
            }
            if (bookmarks.length >= CHAT_BOOKMARK_LIMITS.perChat) {
                throw new ChatError('too-many-bookmarks', `This chat already keeps ${CHAT_BOOKMARK_LIMITS.perChat} bookmarks; remove one first`);
            }
            const excerpt = input.excerpt.slice(0, CHAT_BOOKMARK_LIMITS.excerpt);
            return [...bookmarks, named({ itemId: input.itemId, excerpt, createdAt: now }, name)];
        });
    }

    rename(chatId: string, itemId: string, name: string): Promise<ChatBookmark[]> {
        return this.change(chatId, (bookmarks) => {
            if (!bookmarks.some((bookmark) => bookmark.itemId === itemId)) {
                throw new ChatError('bookmark-not-found', `This chat has no bookmark on ${itemId}`);
            }
            return bookmarks.map((bookmark) => (bookmark.itemId === itemId ? named(bookmark, cleanName(name)) : bookmark));
        });
    }

    remove(chatId: string, itemId: string): Promise<ChatBookmark[]> {
        return this.change(chatId, (bookmarks) =>
            bookmarks.some((bookmark) => bookmark.itemId === itemId) ? bookmarks.filter((bookmark) => bookmark.itemId !== itemId) : null
        );
    }

    /* The bookmarks go with the chat or with a clear of it. A file that no longer parses goes too, since nothing could show it again. */
    removeChat(chatId: string): Promise<void> {
        return this.writes.run(chatId, async () => {
            const had = await this.readFile(chatId).then(
                (bookmarks) => bookmarks.length > 0,
                () => true
            );
            await rm(join(this.dir, bookmarkFileName(chatId)), { force: true });
            if (had) {
                this.tell(chatId, []);
            }
        });
    }

    /* A fork keeps the bookmarks on the messages it copied, which are the ones up to where it was cut. */
    async copyChat(fromChatId: string, toChatId: string, keep: (itemId: string) => boolean): Promise<void> {
        const kept = (await this.read(fromChatId)).filter((bookmark) => keep(bookmark.itemId));
        if (kept.length === 0) {
            return;
        }
        await this.writes.run(toChatId, async () => {
            await this.writeFile(toChatId, kept);
            this.tell(toChatId, kept);
        });
    }

    /* One read, one decision and one write in the chat's chain; a change that returns null changes nothing and tells nobody. */
    private change(chatId: string, decide: (bookmarks: ChatBookmark[]) => ChatBookmark[] | null): Promise<ChatBookmark[]> {
        return this.writes.run(chatId, async () => {
            const bookmarks = await this.readFile(chatId);
            const next = decide(bookmarks);
            if (next === null) {
                return bookmarks;
            }
            await this.writeFile(chatId, next);
            this.tell(chatId, next);
            return next;
        });
    }

    private tell(chatId: string, bookmarks: ChatBookmark[]): void {
        for (const listener of this.listeners) {
            listener(chatId, bookmarks);
        }
    }

    private async readFile(chatId: string): Promise<ChatBookmark[]> {
        let raw: string;
        try {
            raw = await readFile(join(this.dir, bookmarkFileName(chatId)), 'utf8');
        } catch (e) {
            if (isNotFound(e)) {
                return [];
            }
            throw e;
        }
        // A file that does not parse is refused rather than read as empty, which the next write would make true.
        const parsed = BookmarkFileSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
            throw new Error(`The bookmarks file of chat ${chatId} is not valid: ${parsed.error.issues[0]?.message ?? 'unknown problem'}`);
        }
        return parsed.data.bookmarks;
    }

    private async writeFile(chatId: string, bookmarks: readonly ChatBookmark[]): Promise<void> {
        const path = join(this.dir, bookmarkFileName(chatId));
        if (bookmarks.length === 0) {
            await rm(path, { force: true });
            return;
        }
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(path, JSON.stringify({ version: 1, bookmarks }));
    }
}

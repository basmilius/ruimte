import { isCanvasView, viewChats, type ChatItem, type ChatSearchHit, type ChatSearchPayload, type ChatSearchResult, type ProjectView } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents';
import { searchThreadItems } from '@adecore/agents/chat';

export class ChatSearchError extends CodedError<'not-open'> {}

interface SearchableChat {
    chatId: string;
    title: string;
}

export interface ProjectChatSearchDeps {
    /* Whether this client has the project open. */
    holds(clientId: string, projectId: string): Promise<boolean>;
    chatsOf(projectId: string): SearchableChat[];
    /* The thread of a chat the daemon runs now; null when no session of it is loaded. */
    loadedItems(chatId: string): readonly ChatItem[] | null;
    /* The thread as it is on disk, the log played over the snapshot; null when it cannot be read. */
    readStored(chatId: string): Promise<readonly ChatItem[] | null>;
}

const DEFAULT_LIMIT = 200;
const HITS_PER_CHAT = 20;

/*
 * The chats a person can open in a project: chat views that are listed, and the chat nodes on its
 * canvases. `unlisted` adds the hidden and empty chat views, which are still Ruimte's own.
 */
export function chatsOfViews(views: readonly ProjectView[], unlisted = false): SearchableChat[] {
    return views.flatMap((view): SearchableChat[] => {
        if (view.kind === 'chat') {
            return !unlisted && (view.empty === true || view.hidden === true) ? [] : [{ chatId: view.id, title: view.name ?? '' }];
        }
        if (view.kind === 'design') {
            return viewChats(view).map((chat) => ({ chatId: chat.id, title: chat.name }));
        }
        if (isCanvasView(view)) {
            return view.nodes.filter((node) => node.kind === 'chat').map((node) => ({ chatId: node.id, title: node.title }));
        }
        return [];
    });
}

function searchKey(clientId: string, searchId: string): string {
    return `${clientId}:${searchId}`;
}

/* Keeps the chats the index places in this project: an id written into its file may be a chat of another one. */
export function chatsLocatedIn(
    chats: readonly SearchableChat[],
    projectId: string,
    locate: (chatId: string) => { projectId: string } | null
): SearchableChat[] {
    return chats.filter((chat) => locate(chat.chatId)?.projectId === projectId);
}

/*
 * Searches the messages of every chat in a project, one chat after the other, so a search over a
 * long history never holds more than one thread in memory and a newer query can stop it between two.
 */
export class ProjectChatSearch {
    private readonly deps: ProjectChatSearchDeps;
    private readonly running = new Set<string>();
    private readonly cancelled = new Set<string>();

    constructor(deps: ProjectChatSearchDeps) {
        this.deps = deps;
    }

    /* Stops the search before it opens its next chat; a search that is not running is nothing to stop. */
    cancel(searchId: string, clientId: string): void {
        const key = searchKey(clientId, searchId);
        if (this.running.has(key)) {
            this.cancelled.add(key);
        }
    }

    async search(payload: ChatSearchPayload, clientId: string): Promise<ChatSearchResult> {
        const { searchId, query, projectId } = payload;
        const limit = payload.limit ?? DEFAULT_LIMIT;
        // Every window counts its own search ids, so an id means something only next to its client.
        const key = searchKey(clientId, searchId);
        this.running.add(key);
        try {
            if (!(await this.deps.holds(clientId, projectId))) {
                throw new ChatSearchError('not-open', 'Open this project before searching its chats');
            }
            const result: ChatSearchResult = { hits: [], chats: [], searched: 0, failed: [], truncated: false, cancelled: false };
            // The chats a session of the daemon holds now come first: they are the ones in use.
            const chats = this.deps.chatsOf(projectId);
            const loaded = new Set(chats.filter((chat) => this.deps.loadedItems(chat.chatId) !== null));
            const ordered = [...loaded, ...chats.filter((chat) => !loaded.has(chat))];
            for (const chat of ordered) {
                if (this.cancelled.has(key)) {
                    result.cancelled = true;
                    break;
                }
                if (result.hits.length >= limit) {
                    result.truncated = true;
                    break;
                }
                const items = this.deps.loadedItems(chat.chatId) ?? (await this.read(chat.chatId));
                if (items === null) {
                    result.failed.push({ chatId: chat.chatId, title: chat.title, reason: 'The chat could not be read' });
                    continue;
                }
                result.searched += 1;
                const room = Math.min(HITS_PER_CHAT, limit - result.hits.length);
                // One more than fits says that there were more.
                const all = searchThreadItems(items, query, { limit: room + 1 });
                const found = all.slice(0, room);
                result.truncated = result.truncated || all.length > room;
                if (found.length > 0) {
                    result.chats.push({ chatId: chat.chatId, title: chat.title });
                    result.hits.push(...found.map(({ turnId: _turnId, ...hit }): ChatSearchHit => ({ chatId: chat.chatId, ...hit })));
                }
            }
            return result;
        } finally {
            this.running.delete(key);
            this.cancelled.delete(key);
        }
    }

    private async read(chatId: string): Promise<readonly ChatItem[] | null> {
        try {
            return await this.deps.readStored(chatId);
        } catch {
            return null;
        }
    }
}

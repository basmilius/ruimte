import type { ChatItem } from '@ruimte/contracts';
import type { ChatManager } from './chat-manager.ts';
import type { ChatSession } from './chat-session.ts';

/* A chat the daemon may open a turn in, as the outbox handlers see it: what its thread holds, and the one call that opens one, false while a turn or an owed resume is in the way. */
export interface WakeChat {
    items(): ChatItem[];
    wake(wake: { text: string; label: string; note?: string; taskIds: string[]; messageFrom?: string[] }): boolean;
}

export interface ChatOpenerDeps {
    chats: Pick<ChatManager, 'get' | 'hasStored' | 'create'>;
    /* Whether a project still places the node; one that left the document is nobody's to open a turn in. */
    placed(nodeId: string): boolean;
}

/*
 * A chat, loaded from disk when nobody has it, so work owed to a chat nobody mounted since the restart
 * still lands. Null for a node with no thread at all.
 */
export const loadChat = async (deps: ChatOpenerDeps, chatId: string): Promise<ChatSession | null> => {
    if (!deps.chats.get(chatId)) {
        if (!deps.placed(chatId) || !(await deps.chats.hasStored(chatId))) {
            return null;
        }
        await deps.chats.create({ chatId });
    }
    return deps.chats.get(chatId) ?? null;
};

/* The chat a turn is to be opened in. */
export const chatOpener =
    (deps: ChatOpenerDeps) =>
    async (chatId: string): Promise<WakeChat | null> => {
        const session = await loadChat(deps, chatId);
        return session
            ? {
                  items: () => session.thread.list(),
                  // A turn before the reset would stop on the same limit and spend one of the resume's tries, so it waits for the resume turn.
                  wake: (wake) => session.info.resumeAt === undefined && session.wake(wake) !== null
              }
            : null;
    };

import type { ChatMoveRefusal, Task } from '@ruimte/contracts';

export interface MoveRefusalDeps {
    /* Whether the chat is a chat view of the Chats project. */
    inChats(chatId: string): boolean;
    /* A turn runs, or the chat waits on a person. A chat nobody loaded since a restart does neither. */
    working(chatId: string): boolean;
    lineage: {
        /* Counts agents that ended too, since their records go with the Chats write. */
        openedCount(chatId: string): number;
        startedBy(chatId: string): string | null;
    };
    tasks: { involving(chatId: string): ReadonlyArray<Pick<Task, 'parentId' | 'childId' | 'status'>> };
    outbox: { list(): ReadonlyArray<{ target: string; kind: string; notBefore: number }> };
    notices: { waiting(chatId: string): readonly unknown[] };
    prWatches: { watchOf(chatId: string): unknown };
}

/*
 * Why a chat cannot leave Chats now, or null. Each reason is something the write that removes the
 * view from Chats would end or orphan: a fork's lineage is the one thing that travels, so it refuses nothing.
 */
export function moveRefusal(chatId: string, deps: MoveRefusalDeps): ChatMoveRefusal | null {
    if (!deps.inChats(chatId)) {
        return { reason: 'not-in-chats' };
    }
    if (deps.working(chatId)) {
        return { reason: 'working' };
    }
    if (deps.lineage.openedCount(chatId) > 0 || deps.lineage.startedBy(chatId) !== null) {
        return { reason: 'agents' };
    }
    // Any status as a parent, since a settled task is pruned with the chat that gave it.
    if (deps.tasks.involving(chatId).some((task) => task.parentId === chatId || (task.childId === chatId && task.status === 'open'))) {
        return { reason: 'tasks' };
    }
    const owed = deps.outbox.list().filter((entry) => entry.target === chatId);
    if (owed.length > 0) {
        const limit = owed.find((entry) => entry.kind === 'resume-limit');
        return limit === undefined ? { reason: 'owed' } : { reason: 'owed', at: limit.notBefore };
    }
    if (deps.notices.waiting(chatId).length > 0) {
        return { reason: 'messages' };
    }
    if (deps.prWatches.watchOf(chatId) !== null) {
        return { reason: 'pr-watch' };
    }
    return null;
}

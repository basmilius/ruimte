import type { AgentLineageStore } from '../agents/lineage.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import { errorText } from '../error-text.ts';
import type { SessionManager } from '../sessions/manager.ts';
import type { TaskStore } from '../tasks/task-store.ts';
import type { EndChildrenEntry, OutboxEntry, OutboxStore, OutboxWork } from './outbox.ts';

/* What a chat child's thread and a cancelled task say about why they ended. */
export const ENDED_REASON = 'the agent that opened this chat was stopped';

export interface EndChildrenDeps {
    /* The agents a node opened and the ones those opened, nearest first, leaving out what a cascade already ended. */
    descendants(nodeId: string): string[];
    /* The project a node was made in, read from its lineage because the node that opened it may be gone. */
    projectOf(nodeId: string): string | null;
    markEnded(nodeIds: readonly string[]): Promise<void>;
    entries(): OutboxEntry[];
    enqueue(projectId: string, target: string, work: OutboxWork): Promise<void>;
    remove(entryId: string): Promise<void>;
    cancelTasks(childIds: ReadonlySet<string>): Promise<void>;
    /* Ends whatever runs for the node, a chat or a terminal, and keeps what a person can still read. */
    stop(nodeId: string): Promise<void>;
}

/* The work that would start or wake an agent again; an agent that was ended has none of it left. */
const REVIVING: ReadonlySet<OutboxEntry['kind']> = new Set(['start-agent', 'resume-run', 'wake-parent', 'deliver-message', 'give-task']);

/*
 * Owes ending the agents a node opened, before the node itself is stopped or once it is deleted. Written
 * to disk first, so a restart between a person's confirmation and the children ending still ends them.
 * A second call for a node whose entry is still owed adds nothing. A delete from a client both kills the
 * node's session and removes it from the document, and each says so.
 */
export const oweEndChildren =
    (deps: EndChildrenDeps) =>
    async (nodeId: string): Promise<number> => {
        const nodeIds = deps.descendants(nodeId);
        const projectId = nodeIds.map((id) => deps.projectOf(id)).find((id) => id !== null) ?? null;
        if (nodeIds.length === 0 || projectId === null) {
            return 0;
        }
        const owed = deps.entries().some((entry) => entry.kind === 'end-children' && entry.target === nodeId);
        if (!owed) {
            await deps.enqueue(projectId, nodeId, { kind: 'end-children', payload: { nodeIds } });
        }
        return nodeIds.length;
    };

/*
 * Ends every agent below a stopped node. Marked first, so a restart halfway through finishes the same
 * way; then the work that would bring one back goes, the open tasks are cancelled before any turn is
 * aborted (so no parent is woken by an agent that was stopped), and the leaves stop before the nodes
 * that opened them. Every step is safe to run twice.
 */
export const endChildrenHandler =
    (deps: EndChildrenDeps) =>
    async (entry: EndChildrenEntry): Promise<void> => {
        const nodeIds = [...new Set([...entry.payload.nodeIds, ...deps.descendants(entry.target)])];
        await deps.markEnded(nodeIds);
        const ended = new Set(nodeIds);
        for (const owed of deps.entries()) {
            if (REVIVING.has(owed.kind) && ended.has(owed.target)) {
                await deps.remove(owed.id);
            }
        }
        await deps.cancelTasks(ended);
        for (const nodeId of [...nodeIds].reverse()) {
            await deps.stop(nodeId);
        }
    };

export interface EndChildrenWiringDeps {
    lineage: AgentLineageStore;
    outbox: OutboxStore;
    tasks: TaskStore;
    chats: Pick<ChatManager, 'get' | 'stop'>;
    sessions: Pick<SessionManager, 'get' | 'end'>;
    enqueue(projectId: string, target: string, work: OutboxWork): Promise<void>;
    now?: () => number;
    log?: (line: string) => void;
}

export interface EndChildrenWiring {
    /* Called on every stop or delete of a node. Owes ending the agents it opened and answers how many that is. */
    owe(nodeId: string): Promise<number>;
    handler(entry: EndChildrenEntry): Promise<void>;
    /*
     * Stops one node the way a stop of its parent would, for a person who stops a task from the list of
     * the chat that gave it. Its open task is cancelled first, so nobody is woken, then its CLI or shell
     * ends with its thread and screen kept, and the agents it opened are owed an end of their own.
     */
    stopNode(nodeId: string, reason: string): Promise<void>;
    /* The agents stopping this node would end that still run; this is what `agent.children` answers. */
    children(nodeId: string): string[];
    /* For `ProjectIndex.onPlaces`. A node that left the document takes its agents with it, however it left. */
    places(projectId: string, ids: ReadonlySet<string>): void;
    /* From here on `places` owes at once; what the index said before (warming it at start) is looked at now. */
    start(): void;
}

export const wireEndChildren = ({
    lineage,
    outbox,
    tasks,
    chats,
    sessions,
    enqueue,
    now = Date.now,
    log = console.error
}: EndChildrenWiringDeps): EndChildrenWiring => {
    const deps: EndChildrenDeps = {
        descendants: (nodeId) => lineage.descendants(nodeId),
        projectOf: (nodeId) => lineage.projectOf(nodeId),
        markEnded: (nodeIds) => lineage.markEnded(nodeIds),
        entries: () => outbox.list(),
        enqueue,
        remove: (entryId) => outbox.remove(entryId),
        cancelTasks: async (childIds) => {
            await tasks.cancelOpen(childIds, ENDED_REASON, now());
            // A stopped chat that gave tasks of its own is not woken about them either.
            for (const childId of childIds) {
                await tasks.dropWake(childId);
            }
        },
        stop: async (nodeId) => {
            await chats.stop(nodeId, ENDED_REASON);
            await sessions.end(nodeId);
        }
    };
    const live = (nodeId: string): boolean => {
        const chat = chats.get(nodeId);
        return chat ? chat.running || chat.info.activeTurnId !== null : sessions.get(nodeId)?.exited === false;
    };
    const owe = oweEndChildren(deps);
    // The index is warmed before the outbox can take work, so what it says until then waits here.
    let early: Map<string, ReadonlySet<string>> | null = new Map();
    const places = (projectId: string, ids: ReadonlySet<string>): void => {
        if (early !== null) {
            early.set(projectId, ids);
            return;
        }
        for (const openedBy of new Set(lineage.orphans(projectId, ids).map((orphan) => orphan.openedBy))) {
            void owe(openedBy).catch((e: unknown) => log(`Owing the end of the agents ${openedBy} opened failed: ${errorText(e)}`));
        }
    };
    const stopNode = async (nodeId: string, reason: string): Promise<void> => {
        await owe(nodeId);
        await deps.markEnded([nodeId]);
        for (const owed of outbox.list()) {
            if (REVIVING.has(owed.kind) && owed.target === nodeId) {
                await outbox.remove(owed.id);
            }
        }
        await tasks.cancelOpen(new Set([nodeId]), reason, now());
        await tasks.dropWake(nodeId);
        await chats.stop(nodeId, reason);
        await sessions.end(nodeId);
    };
    return {
        owe,
        stopNode,
        handler: endChildrenHandler(deps),
        children: (nodeId) => lineage.descendants(nodeId).filter(live),
        places,
        start: () => {
            const waiting = early ?? new Map<string, ReadonlySet<string>>();
            early = null;
            for (const [projectId, ids] of waiting) {
                places(projectId, ids);
            }
        }
    };
};

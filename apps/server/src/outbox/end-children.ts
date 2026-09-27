import type { AgentLineageStore } from '@ruimte/agents/lineage';
import { endChildren } from '@ruimte/agents/tasks/end-children';
import type { ChatManager } from '../chat/chat-manager.ts';
import { errorText } from '../error-text.ts';
import type { SessionManager } from '../sessions/manager.ts';
import type { TaskStore } from '@ruimte/agents/tasks/task-store';
import type { EndChildrenEntry, OutboxEntry, OutboxStore, OutboxWork } from './outbox.ts';

/* What a chat child's thread and a cancelled task say about why they ended. */
export const ENDED_REASON = 'the agent that opened this chat was stopped';

/* Ruimte's work that would start or wake an agent again, beside what tasks owe. */
const REVIVING: readonly OutboxEntry['kind'][] = ['start-agent', 'resume-run', 'deliver-message'];

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
    const ending = endChildren({
        lineage,
        tasks,
        outbox: { list: () => outbox.list(), enqueue, remove: (entryId) => outbox.remove(entryId) },
        reviving: REVIVING,
        reason: ENDED_REASON,
        stop: async (nodeId, reason) => {
            await chats.stop(nodeId, reason);
            await sessions.end(nodeId);
        },
        now
    });
    const live = (nodeId: string): boolean => {
        const chat = chats.get(nodeId);
        return chat ? chat.running || chat.info.activeTurnId !== null : sessions.get(nodeId)?.exited === false;
    };
    const owe = (nodeId: string): Promise<number> => ending.owe(nodeId);
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
        await ending.end([nodeId], reason);
    };
    return {
        owe,
        stopNode,
        handler: ending.handler,
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

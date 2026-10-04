import { z } from 'zod';
import type { AgentLineageStore } from '../lineage.ts';
import type { OutboxEntryOf } from '../outbox/outbox.ts';
import type { TaskStore } from './task-store.ts';
import type { AnyOutboxEntry } from './task-work.ts';

export const EndChildrenWorkSchema = z.object({
    kind: z.literal('end-children'),
    // The target is the node that was stopped or deleted; these are the agents it had opened when that was owed.
    payload: z.object({ nodeIds: z.array(z.string().min(1)) })
});

export type EndChildrenWork = z.infer<typeof EndChildrenWorkSchema>;
export type EndChildrenEntry = OutboxEntryOf<EndChildrenWork>;

/* The work of tasks that would start or wake an agent again; an agent that was ended has none of it left. */
const TASK_REVIVING: readonly string[] = ['wake-parent', 'give-task'];

/* The outbox of a host as ending uses it, whatever else the host owes in it. */
export interface EndChildrenOutbox {
    list(): readonly AnyOutboxEntry[];
    enqueue(projectId: string, target: string, work: EndChildrenWork): Promise<void>;
    remove(id: string): Promise<void>;
}

export interface EndChildrenDeps {
    lineage: Pick<AgentLineageStore, 'descendants' | 'projectOf' | 'markEnded'>;
    tasks: Pick<TaskStore, 'cancelOpen' | 'dropWake'>;
    outbox: EndChildrenOutbox;
    /* The host's own kinds of work that would start or wake an agent again, beside the task kinds. */
    reviving?: readonly string[];
    /* What the thread of a chat an `end-children` entry ended and its cancelled task say about why. */
    reason: string;
    /* Ends whatever runs for the node and keeps what a person can still read. */
    stop(nodeId: string, reason: string): Promise<void>;
    /* The host's own clean-up once these nodes stopped; like every step, run again after a restart halfway. */
    ended?: (nodeIds: readonly string[]) => Promise<void>;
    now?: () => number;
}

export interface EndChildren {
    /*
     * Owes ending the agents a node opened, before the node itself is stopped or once it is deleted, and
     * answers how many that is. Written to disk first, so a restart in between still ends them. A second
     * call for a node whose entry is still owed adds nothing. `nodeIds` names them for a target that did
     * not open them itself, such as a document whose chats go with it; its descendants when absent.
     */
    owe(target: string, nodeIds?: readonly string[]): Promise<number>;
    handler(entry: EndChildrenEntry): Promise<void>;
    /* Ends these nodes at once, given nearest first; the ones they opened are not among them unless named. */
    end(nodeIds: readonly string[], reason: string): Promise<void>;
}

/*
 * The ending of agents and the ones they opened. Marked first, so a restart halfway through finishes
 * the same way; then the work that would bring one back goes, the open tasks are cancelled before any
 * turn is aborted (so no parent is woken by an agent that was stopped), and the leaves stop before
 * the nodes that opened them. Every step is safe to run twice.
 */
export function endChildren(deps: EndChildrenDeps): EndChildren {
    const { lineage, tasks, outbox } = deps;
    const now = deps.now ?? Date.now;
    const reviving = new Set([...TASK_REVIVING, ...(deps.reviving ?? [])]);

    const end = async (nodeIds: readonly string[], reason: string): Promise<void> => {
        await lineage.markEnded(nodeIds);
        const ended = new Set(nodeIds);
        for (const owed of outbox.list()) {
            if (reviving.has(owed.kind) && ended.has(owed.target)) {
                await outbox.remove(owed.id);
            }
        }
        await tasks.cancelOpen(ended, reason, now());
        // A stopped chat that gave tasks of its own is not woken about them either.
        for (const nodeId of nodeIds) {
            await tasks.dropWake(nodeId);
        }
        for (const nodeId of [...nodeIds].reverse()) {
            await deps.stop(nodeId, reason);
        }
        await deps.ended?.(nodeIds);
    };

    return {
        owe: async (target, named) => {
            const nodeIds = named === undefined ? lineage.descendants(target) : [...named];
            const projectId = nodeIds.map((id) => lineage.projectOf(id)).find((id) => id !== null) ?? null;
            if (nodeIds.length === 0 || projectId === null) {
                return 0;
            }
            const owed = outbox.list().some((entry) => entry.kind === 'end-children' && entry.target === target);
            if (!owed) {
                await outbox.enqueue(projectId, target, { kind: 'end-children', payload: { nodeIds } });
            }
            return nodeIds.length;
        },
        handler: (entry) => end([...new Set([...entry.payload.nodeIds, ...lineage.descendants(entry.target)])], deps.reason),
        end
    };
}

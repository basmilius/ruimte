import { join } from 'node:path';
import { RuntimeModeSchema, type RuntimeMode } from '@ruimte/contracts';
import { RecordDirectory } from '../record-directory.ts';
import { z } from 'zod';

const LineageSchema = z.object({
    projectId: z.string().min(1),
    nodeId: z.string().min(1),
    /* The node that ran the verb; a caller is counted against this to cap one runaway agent. */
    openedBy: z.string().min(1),
    depth: z.number().int().nonnegative(),
    /* Whether this is an agent node, which is what the depth and the per-caller cap are about. A
       record written before a plain node was written down at all is one of those, hence the default. */
    agent: z.boolean().default(true),
    /* A fork is a sibling a person made beside `openedBy` rather than a node it opened; absent is opened by a verb. */
    relation: z.literal('fork').optional(),
    /* The widest mode the agent may start in, the mode of its opener when it was made. Absent on a
       record from before, and on a node nobody may widen anyway since no agent started it. */
    ceiling: RuntimeModeSchema.optional(),
    createdAt: z.number(),
    /* When stopping or deleting the node that opened it ended this one too; a cascade never ends a node twice. */
    endedAt: z.number().optional()
});

type Lineage = z.infer<typeof LineageSchema>;

/* Opened by the agent it names, which is what every rule about children is about; a fork lives on its own. */
const openedByAgent = (entry: Lineage): boolean => entry.agent && entry.relation !== 'fork';

/*
 * Lineage lives under `$RUIMTE_HOME`, outside the agent-writable project, so agents cannot reset
 * their own depth. Persisting it also prevents a daemon restart from resetting recursion limits.
 */
export class AgentLineageStore {
    readonly dir: string;
    private readonly opened: RecordDirectory<Lineage>;

    constructor(home: string) {
        this.dir = join(home, 'lineage');
        this.opened = new RecordDirectory({ dir: this.dir, schema: LineageSchema, idOf: (entry) => entry.nodeId });
    }

    /* Reads what an earlier run of the daemon wrote down. Call before any verb can ask. */
    load(): Promise<void> {
        return this.opened.load();
    }

    async put(record: Omit<Lineage, 'createdAt' | 'endedAt'>): Promise<void> {
        await this.opened.write({ ...record, createdAt: Date.now() });
    }

    /*
     * The agent nodes this one opened and the ones those opened in turn that no cascade ended yet,
     * nearest first, so whoever ends them can go from the leaves back up.
     */
    descendants(nodeId: string): string[] {
        const found: string[] = [];
        const seen = new Set([nodeId]);
        for (let i = -1; i < found.length; i++) {
            const parent = i === -1 ? nodeId : found[i]!;
            for (const entry of this.opened.all()) {
                if (entry.openedBy === parent && openedByAgent(entry) && entry.endedAt === undefined && !seen.has(entry.nodeId)) {
                    seen.add(entry.nodeId);
                    found.push(entry.nodeId);
                }
            }
        }
        return found;
    }

    /* The project a node was made in, for work owed about it after the node that opened it is gone. */
    projectOf(nodeId: string): string | null {
        return this.opened.get(nodeId)?.projectId ?? null;
    }

    endedAt(nodeId: string): number | null {
        return this.opened.get(nodeId)?.endedAt ?? null;
    }

    /* On the wall clock, like `createdAt`: a chat holds the mark against the time its turn started. */
    async markEnded(nodeIds: readonly string[]): Promise<void> {
        const at = Date.now();
        for (const nodeId of nodeIds) {
            const entry = this.opened.get(nodeId);
            if (entry && entry.endedAt === undefined) {
                await this.opened.write({ ...entry, endedAt: at });
            }
        }
    }

    /* The nodes of this project whose opener it no longer places, and that no cascade ended yet. */
    orphans(projectId: string, ids: ReadonlySet<string>): Array<{ nodeId: string; openedBy: string }> {
        return [...this.opened.all()]
            .filter(
                (entry) =>
                    entry.projectId === projectId && openedByAgent(entry) && entry.endedAt === undefined && ids.has(entry.nodeId) && !ids.has(entry.openedBy)
            )
            .map((entry) => ({ nodeId: entry.nodeId, openedBy: entry.openedBy }));
    }

    /* The widest mode this agent node may start in, every time it starts; null for one no agent opened. */
    ceilingOf(nodeId: string): RuntimeMode | null {
        const entry = this.opened.get(nodeId);
        return entry !== undefined && openedByAgent(entry) ? (entry.ceiling ?? null) : null;
    }

    /* How deep a node sits. A node nobody wrote down is one a person made, which is where a chain starts. */
    depthOf(nodeId: string): number {
        return this.opened.get(nodeId)?.depth ?? 0;
    }

    /*
     * The agent nodes this caller opened that are still on a canvas; a deleted node is pruned away.
     * Only the agent ones: a caller that makes notes would otherwise use up the room it has for agents.
     */
    openedCount(callerId: string): number {
        let count = 0;
        for (const entry of this.opened.all()) {
            if (entry.openedBy === callerId && openedByAgent(entry)) {
                count += 1;
            }
        }
        return count;
    }

    /* Who made this node, or null for one a person made: the whole of the rule node delete follows. */
    madeBy(nodeId: string): string | null {
        const entry = this.opened.get(nodeId);
        return entry === undefined || entry.relation === 'fork' ? null : entry.openedBy;
    }

    /* The node that opened this one as an agent, or null for a node no agent or team started. */
    startedBy(nodeId: string): string | null {
        const entry = this.opened.get(nodeId);
        return entry !== undefined && openedByAgent(entry) ? entry.openedBy : null;
    }

    /* The chat a fork was made from, or null for a node that is no fork. */
    forkedFrom(nodeId: string): string | null {
        const entry = this.opened.get(nodeId);
        return entry?.relation === 'fork' ? entry.openedBy : null;
    }

    /* The forks made from a chat. */
    forksOf(nodeId: string): string[] {
        return [...this.opened.all()].filter((entry) => entry.relation === 'fork' && entry.openedBy === nodeId).map((entry) => entry.nodeId);
    }

    /* The forks of this project whose node is gone, read before `prune` forgets them. */
    forksLeaving(projectId: string, ids: ReadonlySet<string>): string[] {
        return [...this.opened.all()]
            .filter((entry) => entry.projectId === projectId && entry.relation === 'fork' && !ids.has(entry.nodeId))
            .map((entry) => entry.nodeId);
    }

    /* Drops what this project wrote down for ids it no longer has: the node was deleted. */
    prune(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        return this.opened.prune((entry) => entry.projectId === projectId && !ids.has(entry.nodeId));
    }
}

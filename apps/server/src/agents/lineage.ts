import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';

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
    createdAt: z.number(),
    /* When stopping or deleting the node that opened it ended this one too; a cascade never ends a node twice. */
    endedAt: z.number().optional()
});

type Lineage = z.infer<typeof LineageSchema>;

/* Opened by the agent it names, which is what every rule about children is about; a fork lives on its own. */
const openedByAgent = (entry: Lineage): boolean => entry.agent && entry.relation !== 'fork';

// The id is a node id the client chose, so it is encoded before it becomes a file name.
const fileName = (nodeId: string): string => `${encodeURIComponent(nodeId)}.json`;

/*
 * Who opened an agent node and how deep in the chain of agents it sits, held per node id. It is not
 * a field on the node in `project.json` for two reasons. A node field would be a number the limited
 * party can edit: an agent in a terminal has a shell in the project folder and could rewrite
 * `.ruimte/project.json` to call itself depth 0. And the document is stripped by zod on every hop
 * (`ProjectNodeSchema`), so a client save would erase a field the client does not know. On disk
 * under `$RUIMTE_HOME`, because a restart is exactly when a loop of agents would otherwise start
 * counting from zero again.
 */
export class AgentLineageStore {
    readonly dir: string;
    private readonly opened = new Map<string, Lineage>();

    constructor(home: string) {
        this.dir = join(home, 'lineage');
    }

    /* Reads what an earlier run of the daemon wrote down. Call before any verb can ask. */
    async load(): Promise<void> {
        let names: string[];
        try {
            names = await readdir(this.dir);
        } catch (e) {
            if (isNotFound(e)) {
                return;
            }
            throw e;
        }
        for (const name of names) {
            if (!name.endsWith('.json')) {
                continue;
            }
            const raw = await readFile(join(this.dir, name), 'utf8').catch(() => null);
            if (raw === null) {
                continue;
            }
            let parsed: ReturnType<typeof LineageSchema.safeParse>;
            try {
                parsed = LineageSchema.safeParse(JSON.parse(raw));
            } catch {
                continue;
            }
            if (parsed.success) {
                this.opened.set(parsed.data.nodeId, parsed.data);
            }
        }
    }

    async put(record: Omit<Lineage, 'createdAt' | 'endedAt'>): Promise<void> {
        await this.write({ ...record, createdAt: Date.now() });
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
            for (const entry of this.opened.values()) {
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

    async markEnded(nodeIds: readonly string[], at: number): Promise<void> {
        for (const nodeId of nodeIds) {
            const entry = this.opened.get(nodeId);
            if (entry && entry.endedAt === undefined) {
                await this.write({ ...entry, endedAt: at });
            }
        }
    }

    /* The nodes of this project whose opener it no longer places, and that no cascade ended yet. */
    orphans(projectId: string, ids: ReadonlySet<string>): Array<{ nodeId: string; openedBy: string }> {
        return [...this.opened.values()]
            .filter(
                (entry) =>
                    entry.projectId === projectId && openedByAgent(entry) && entry.endedAt === undefined && ids.has(entry.nodeId) && !ids.has(entry.openedBy)
            )
            .map((entry) => ({ nodeId: entry.nodeId, openedBy: entry.openedBy }));
    }

    private async write(entry: Lineage): Promise<void> {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(join(this.dir, fileName(entry.nodeId)), JSON.stringify(entry));
        this.opened.set(entry.nodeId, entry);
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
        for (const entry of this.opened.values()) {
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

    /* Drops what this project wrote down for ids it no longer has: the node was deleted. */
    async prune(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        for (const entry of [...this.opened.values()]) {
            if (entry.projectId === projectId && !ids.has(entry.nodeId)) {
                this.opened.delete(entry.nodeId);
                await rm(join(this.dir, fileName(entry.nodeId)), { force: true });
            }
        }
    }
}

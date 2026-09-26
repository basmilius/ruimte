import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { RecordDirectory } from '../record-directory.ts';

/* One kind of work a host owes: its schema's `kind` is a literal, and the kinds together a discriminated union. */
export interface OutboxWorkShape {
    kind: string;
    payload: unknown;
}

const OutboxEntryFieldsSchema = z.object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    // The node the work is about. Entries for one target run one at a time, and it goes with the node.
    target: z.string().min(1),
    createdAt: z.number(),
    attempts: z.number().int().nonnegative(),
    notBefore: z.number()
});

export type OutboxEntryFields = z.infer<typeof OutboxEntryFieldsSchema>;
export type OutboxEntryOf<Work extends OutboxWorkShape> = Work & OutboxEntryFields;

export interface OutboxStoreOptions<Work extends OutboxWorkShape> {
    /* The entries go in `outbox` under it. */
    dataDir: string;
    work: z.ZodType<Work>;
    /* The nodes an entry is about, its target first; work on any of them waits while it runs. Only the target when absent. */
    lanesOf?(entry: OutboxEntryOf<Work>): string[];
    /* Work owed exactly because its target is gone, which pruning therefore keeps. */
    outlivesTarget?(entry: OutboxEntryOf<Work>): boolean;
}

/*
 * Work a host still owes, one file per entry under `<dataDir>/outbox`, removed once it is done. On
 * disk because the owing outlives the process: a node written a moment before a restart still has
 * its agent started after it.
 */
export class OutboxStore<Work extends OutboxWorkShape> {
    readonly dir: string;
    private readonly entries: RecordDirectory<OutboxEntryOf<Work>>;
    private readonly lanes: (entry: OutboxEntryOf<Work>) => string[];
    private readonly outlivesTarget: (entry: OutboxEntryOf<Work>) => boolean;

    constructor(options: OutboxStoreOptions<Work>) {
        this.dir = join(options.dataDir, 'outbox');
        this.entries = new RecordDirectory<OutboxEntryOf<Work>>({
            dir: this.dir,
            schema: z.intersection(options.work, OutboxEntryFieldsSchema),
            idOf: (entry) => entry.id
        });
        this.lanes = options.lanesOf ?? ((entry) => [entry.target]);
        this.outlivesTarget = options.outlivesTarget ?? (() => false);
    }

    /* Reads what an earlier run of the host still owed. Call before the worker starts. */
    load(): Promise<void> {
        return this.entries.load();
    }

    /* `notBefore` later than `now` is work due at a time, which holds no lane until then. */
    async put(projectId: string, target: string, work: Work, now: number, notBefore = now): Promise<OutboxEntryOf<Work>> {
        const entry: OutboxEntryOf<Work> = {
            ...work,
            id: `${work.kind}-${randomBytes(6).toString('hex')}`,
            projectId,
            target,
            createdAt: now,
            attempts: 0,
            notBefore
        };
        await this.entries.write(entry);
        return entry;
    }

    /* The same entry with what its last attempt left behind. */
    async update(entry: OutboxEntryOf<Work>): Promise<void> {
        if (!this.entries.has(entry.id)) {
            return;
        }
        await this.entries.write(entry);
    }

    remove(id: string): Promise<void> {
        return this.entries.remove(id);
    }

    /* Oldest first, which is the order the work was owed in. */
    list(): OutboxEntryOf<Work>[] {
        return this.entries.all().sort((a, b) => a.createdAt - b.createdAt);
    }

    has(id: string): boolean {
        return this.entries.has(id);
    }

    lanesOf(entry: OutboxEntryOf<Work>): string[] {
        return this.lanes(entry);
    }

    /* Drops what this project owed for ids it no longer has, since nothing is started for a node that was deleted. */
    prune(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        return this.entries.prune((entry) => entry.projectId === projectId && !this.outlivesTarget(entry) && !ids.has(entry.target));
    }
}

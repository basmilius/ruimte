import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentKindSchema, RuntimeModeSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';

const StartAgentSchema = z.object({
    kind: z.literal('start-agent'),
    payload: z.object({
        node: z.enum(['chat', 'terminal']),
        provider: AgentKindSchema,
        // Null starts where a session without a directory starts, which is the machine's home.
        cwd: z.string().nullable(),
        // The mode `--mode` asked for, the mode of the chat that opened a chat, or the mode a terminal was written down with.
        runtimeMode: RuntimeModeSchema.optional(),
        // The mode of the node that opened it, which nothing the agent starts with may be wider than; absent on an older entry.
        ceiling: RuntimeModeSchema.optional()
    })
});

const ResumeRunSchema = z.object({
    kind: z.literal('resume-run'),
    // The target is the chat; the turn it was running and the attempt that takes it up again.
    payload: z.object({ turnId: z.string().min(1), attempt: z.number().int().positive() })
});

const WakeParentSchema = z.object({
    kind: z.literal('wake-parent'),
    // The target is the chat to wake; the task that settled is only what owed it, since a wake takes every settled task.
    payload: z.object({ taskId: z.string().min(1) })
});

const EndChildrenSchema = z.object({
    kind: z.literal('end-children'),
    // The target is the node that was stopped or deleted; these are the agents it had opened when that was owed.
    payload: z.object({ nodeIds: z.array(z.string().min(1)) })
});

const DeliverSummarySchema = z.object({
    kind: z.literal('deliver-summary'),
    // The target is the chat the summary is for; the fork wrote it in this turn.
    payload: z.object({ forkId: z.string().min(1), turnId: z.string().min(1), text: z.string() })
});

const OutboxWorkSchema = z.discriminatedUnion('kind', [StartAgentSchema, ResumeRunSchema, WakeParentSchema, EndChildrenSchema, DeliverSummarySchema]);

const OutboxEntrySchema = z.intersection(
    OutboxWorkSchema,
    z.object({
        id: z.string().min(1),
        projectId: z.string().min(1),
        // The node the work is about: entries for one target run one at a time, and it goes with the node.
        target: z.string().min(1),
        createdAt: z.number(),
        attempts: z.number().int().nonnegative(),
        notBefore: z.number()
    })
);

export type OutboxWork = z.infer<typeof OutboxWorkSchema>;
export type OutboxEntry = z.infer<typeof OutboxEntrySchema>;
export type StartAgentEntry = Extract<OutboxEntry, { kind: 'start-agent' }>;
export type ResumeRunEntry = Extract<OutboxEntry, { kind: 'resume-run' }>;
export type WakeParentEntry = Extract<OutboxEntry, { kind: 'wake-parent' }>;
export type EndChildrenEntry = Extract<OutboxEntry, { kind: 'end-children' }>;
export type DeliverSummaryEntry = Extract<OutboxEntry, { kind: 'deliver-summary' }>;

/* The nodes an entry is about: work on any of them waits while it runs. Ending children holds their lanes too, so no start or resume of one runs beside it. */
export const lanesOf = (entry: OutboxEntry): string[] => (entry.kind === 'end-children' ? [entry.target, ...entry.payload.nodeIds] : [entry.target]);

const fileName = (id: string): string => `${encodeURIComponent(id)}.json`;

/*
 * Work the daemon still owes, one file per entry under `$RUIMTE_HOME/outbox`, removed once it is
 * done. On disk because the owing outlives the process: a node written a moment before a restart
 * still has its agent started after it. Only a verb or a restart puts something here, never a clock.
 */
export class OutboxStore {
    readonly dir: string;
    private readonly entries = new Map<string, OutboxEntry>();

    constructor(home: string) {
        this.dir = join(home, 'outbox');
    }

    /* Reads what an earlier run of the daemon still owed. Call before the worker starts. */
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
            let parsed: ReturnType<typeof OutboxEntrySchema.safeParse>;
            try {
                parsed = OutboxEntrySchema.safeParse(JSON.parse(raw));
            } catch {
                continue;
            }
            if (parsed.success) {
                this.entries.set(parsed.data.id, parsed.data);
            }
        }
    }

    async put(projectId: string, target: string, work: OutboxWork, now: number): Promise<OutboxEntry> {
        const entry: OutboxEntry = {
            ...work,
            id: `${work.kind}-${randomBytes(6).toString('hex')}`,
            projectId,
            target,
            createdAt: now,
            attempts: 0,
            notBefore: now
        };
        this.entries.set(entry.id, entry);
        await this.write(entry);
        return entry;
    }

    /* The same entry with what its last attempt left behind. */
    async update(entry: OutboxEntry): Promise<void> {
        if (!this.entries.has(entry.id)) {
            return;
        }
        this.entries.set(entry.id, entry);
        await this.write(entry);
    }

    async remove(id: string): Promise<void> {
        this.entries.delete(id);
        await rm(join(this.dir, fileName(id)), { force: true });
    }

    /* Oldest first, which is the order the work was owed in. */
    list(): OutboxEntry[] {
        return [...this.entries.values()].sort((a, b) => a.createdAt - b.createdAt);
    }

    has(id: string): boolean {
        return this.entries.has(id);
    }

    /*
     * Drops what this project owed for ids it no longer has: nothing is started for a node that was
     * deleted. Ending the children of a deleted node is owed exactly because it is gone, so that stays.
     */
    async prune(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        for (const entry of [...this.entries.values()]) {
            if (entry.projectId === projectId && entry.kind !== 'end-children' && !ids.has(entry.target)) {
                await this.remove(entry.id);
            }
        }
    }

    private async write(entry: OutboxEntry): Promise<void> {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(join(this.dir, fileName(entry.id)), JSON.stringify(entry));
        // Removed while the file was being written: the rename must not bring it back.
        if (!this.entries.has(entry.id)) {
            await rm(join(this.dir, fileName(entry.id)), { force: true });
        }
    }
}

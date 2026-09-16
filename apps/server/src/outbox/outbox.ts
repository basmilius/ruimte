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
        // A chat node only: the mode of the chat that opened it; absent leaves the default a new chat gets.
        runtimeMode: RuntimeModeSchema.optional()
    })
});

const ResumeRunSchema = z.object({
    kind: z.literal('resume-run'),
    // The target is the chat; the turn it was running and the attempt that takes it up again.
    payload: z.object({ turnId: z.string().min(1), attempt: z.number().int().positive() })
});

/* The later phases add their kinds (wake-parent, end-children) as members of this union. */
const OutboxWorkSchema = z.discriminatedUnion('kind', [StartAgentSchema, ResumeRunSchema]);

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

    /* Drops what this project owed for ids it no longer has: nothing is started for a node that was deleted. */
    async prune(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        for (const entry of [...this.entries.values()]) {
            if (entry.projectId === projectId && !ids.has(entry.target)) {
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

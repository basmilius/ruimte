import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';

const RecordSchema = z.object({
    branch: z.string().min(1),
    from: z.object({ branch: z.string().optional(), commit: z.string().min(1) }),
    projectId: z.string().optional(),
    nodeId: z.string().optional(),
    madeBy: z.enum(['verb', 'client']),
    // False when the worktree checked out a branch that was already there; that branch is not the daemon's to delete.
    branchMade: z.boolean().default(true),
    madeAt: z.number()
});

export type WorktreeRecord = z.infer<typeof RecordSchema>;

const FileSchema = z.object({
    version: z.literal(1),
    worktrees: z.record(z.string(), z.unknown())
});

const FILE_NAME = 'worktrees.json';

/*
 * What the daemon wrote down about the worktrees it made in one repository, keyed by the path git
 * reports: where each one was made from and for which node. Git stays the truth about which
 * worktrees exist; this only adds what git cannot say. It lives under `$RUIMTE_HOME` and not in
 * `project.json` for the lineage's reasons: an agent with a shell can rewrite the project file, and a
 * client save strips a field it does not know.
 */
export class WorktreeRegister {
    readonly file: string;
    private readonly dir: string;
    // One write at a time, so two changes in a row never read the same file and drop one of them.
    private chain: Promise<unknown> = Promise.resolve();

    constructor(dir: string) {
        this.dir = dir;
        this.file = join(dir, FILE_NAME);
    }

    /* Every record that still parses; one a newer or broken write left behind is skipped, not fatal. */
    async read(): Promise<Map<string, WorktreeRecord>> {
        let raw: string;
        try {
            raw = await readFile(this.file, 'utf8');
        } catch (e) {
            if (isNotFound(e)) {
                return new Map();
            }
            throw e;
        }
        const records = new Map<string, WorktreeRecord>();
        let parsed: ReturnType<typeof FileSchema.safeParse>;
        try {
            parsed = FileSchema.safeParse(JSON.parse(raw));
        } catch {
            return records;
        }
        if (!parsed.success) {
            return records;
        }
        for (const [path, entry] of Object.entries(parsed.data.worktrees)) {
            const record = RecordSchema.safeParse(entry);
            if (record.success) {
                records.set(path, record.data);
            }
        }
        return records;
    }

    async put(path: string, record: WorktreeRecord): Promise<void> {
        await this.update((records) => {
            records.set(path, record);
        });
    }

    async delete(path: string): Promise<void> {
        await this.update((records) => {
            records.delete(path);
        });
    }

    async update(change: (records: Map<string, WorktreeRecord>) => void): Promise<void> {
        const next = this.chain.then(async () => {
            const records = await this.read();
            const before = JSON.stringify([...records]);
            change(records);
            if (JSON.stringify([...records]) === before) {
                return;
            }
            await mkdir(this.dir, { recursive: true, mode: 0o700 });
            await writeAtomic(this.file, `${JSON.stringify({ version: 1, worktrees: Object.fromEntries(records) }, null, 2)}\n`);
        });
        this.chain = next.catch(() => undefined);
        await next;
    }
}

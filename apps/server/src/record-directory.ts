import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import { isNotFound, writeAtomic } from './fs.ts';
import { KeyedSerializer } from './serializer.ts';

// The id is a node id or a chat id a client chose, so it is encoded before it becomes a file name.
export const recordFileName = (id: string): string => `${encodeURIComponent(id)}.json`;

export interface RecordDirectoryOptions<T> {
    dir: string;
    schema: z.ZodType<T>;
    idOf(record: T): string;
    /*
     * What a record read from disk is worth keeping as, for a store that drops what went stale while
     * the daemon was down. Null takes the file with it.
     */
    keep?(record: T): T | null;
}

/*
 * One kind of record under `$RUIMTE_HOME`, a file per record and the whole of it in memory. A file
 * that does not parse is left alone rather than deleted: it is a record of an older or newer daemon,
 * and the one thing worse than not reading it is throwing it away.
 */
export class RecordDirectory<T> {
    readonly dir: string;
    private readonly schema: z.ZodType<T>;
    private readonly idOf: (record: T) => string;
    private readonly keep: ((record: T) => T | null) | null;
    private readonly records = new Map<string, T>();
    // One write at a time per record, so an older one never lands after a newer one.
    private readonly writes = new KeyedSerializer();

    constructor(options: RecordDirectoryOptions<T>) {
        this.dir = options.dir;
        this.schema = options.schema;
        this.idOf = options.idOf;
        this.keep = options.keep ?? null;
    }

    /* Reads what an earlier run of the daemon wrote down. Call before anything can ask. */
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
            let parsed: ReturnType<typeof this.schema.safeParse>;
            try {
                parsed = this.schema.safeParse(JSON.parse(raw));
            } catch {
                continue;
            }
            if (!parsed.success) {
                continue;
            }
            const record = this.keep === null ? parsed.data : this.keep(parsed.data);
            if (record === null) {
                await rm(join(this.dir, name), { force: true });
                continue;
            }
            this.records.set(this.idOf(record), record);
        }
    }

    get(id: string): T | undefined {
        return this.records.get(id);
    }

    has(id: string): boolean {
        return this.records.has(id);
    }

    all(): T[] {
        return [...this.records.values()];
    }

    /*
     * Holds the record in memory at once, so the next question in the same tick already sees it, and
     * answers whether it is still the one this directory holds by the time the file is written. A
     * record removed while its file was being written does not come back: the rename is undone.
     */
    write(record: T): Promise<boolean> {
        const id = this.idOf(record);
        this.records.set(id, record);
        return this.writes.run(id, async () => {
            if (this.records.get(id) !== record) {
                return false;
            }
            await mkdir(this.dir, { recursive: true, mode: 0o700 });
            await writeAtomic(this.pathOf(id), JSON.stringify(record));
            if (!this.records.has(id)) {
                await rm(this.pathOf(id), { force: true });
                return false;
            }
            return true;
        });
    }

    /* Forgets a record here and now; its file follows. */
    remove(id: string): Promise<void> {
        this.records.delete(id);
        return rm(this.pathOf(id), { force: true });
    }

    /* Drops every record the predicate says is gone. */
    async prune(drop: (record: T) => boolean): Promise<void> {
        for (const record of this.all()) {
            if (drop(record)) {
                await this.remove(this.idOf(record));
            }
        }
    }

    private pathOf(id: string): string {
        return join(this.dir, recordFileName(id));
    }
}

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvenanceRunSchema } from '@ruimte/contracts';
import { isNotFound, writeAtomic } from '@adecore/agents/fs';
import { z } from 'zod';
import type { FileRecord } from './runs.ts';

const FileRecordSchema = z.object({
    version: z.literal(1),
    path: z.string(),
    lineHashes: z.array(z.string()),
    mtime: z.number(),
    runs: z.array(ProvenanceRunSchema)
});

/* The name a file's record has in its project's folder. */
export function recordNameOf(path: string): string {
    return `${createHash('sha1').update(path).digest('hex').slice(0, 20)}.json`;
}

export interface StoredFile {
    name: string;
    record: FileRecord;
    /* When the record was last written, which is how the oldest is told when a project holds too many. */
    writtenAt: number;
}

/*
 * One JSON record per file under `$RUIMTE_HOME/provenance/<projectId>`, never in the project's own
 * files, which an agent with a shell can rewrite. The daemon is its only writer, and the caller
 * serializes the writes of one file. A record that does not parse is as good as none.
 */
export class ProvenanceStore {
    private readonly root: string;

    constructor(home: string) {
        this.root = join(home, 'provenance');
    }

    private dirOf(projectId: string): string {
        return join(this.root, encodeURIComponent(projectId));
    }

    async read(projectId: string, path: string): Promise<FileRecord | null> {
        return this.parse(await readFile(join(this.dirOf(projectId), recordNameOf(path)), 'utf8').catch(() => null));
    }

    async write(projectId: string, record: FileRecord): Promise<void> {
        const dir = this.dirOf(projectId);
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await writeAtomic(join(dir, recordNameOf(record.path)), JSON.stringify(record));
    }

    async remove(projectId: string, path: string): Promise<void> {
        await this.removeNamed(projectId, recordNameOf(path));
    }

    async removeNamed(projectId: string, name: string): Promise<void> {
        await rm(join(this.dirOf(projectId), name), { force: true });
    }

    /* Every record of a project, with the folder that held them. */
    async removeProject(projectId: string): Promise<void> {
        await rm(this.dirOf(projectId), { recursive: true, force: true });
    }

    /* Whether a project already has a record for this file, which tells a new file from one that is only updated. */
    async has(projectId: string, path: string): Promise<boolean> {
        return stat(join(this.dirOf(projectId), recordNameOf(path))).then(
            () => true,
            () => false
        );
    }

    /* Every record of a project, for the sweep that drops the old and the gone. */
    async list(projectId: string): Promise<StoredFile[]> {
        const dir = this.dirOf(projectId);
        const names = await readdir(dir).catch((e: unknown) => {
            if (isNotFound(e)) {
                return [];
            }
            throw e;
        });
        const files: StoredFile[] = [];
        for (const name of names.filter((entry) => entry.endsWith('.json'))) {
            const path = join(dir, name);
            const [text, info] = await Promise.all([readFile(path, 'utf8').catch(() => null), stat(path).catch(() => null)]);
            const record = this.parse(text);
            if (record === null || info === null) {
                // A record that cannot be read is cleared out with the rest.
                await rm(path, { force: true });
                continue;
            }
            files.push({ name, record, writtenAt: info.mtimeMs });
        }
        return files;
    }

    private parse(text: string | null): FileRecord | null {
        if (text === null) {
            return null;
        }
        try {
            const parsed = FileRecordSchema.safeParse(JSON.parse(text));
            return parsed.success ? parsed.data : null;
        } catch {
            return null;
        }
    }
}

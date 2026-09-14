import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { usageRoots } from '../usage/roots.ts';
import { cleanTitle, readLines } from './title-file.ts';

// Every line of the index is about a name; one without this key is not worth parsing.
const MARKER = '"thread_name"';

/*
 * The name Codex gave a thread, out of `session_index.jsonl` in its home. The TUI appends a line
 * `{"id", "thread_name", "updated_at"}` whenever it names a thread, so the last line for an id is its
 * name. The file only grows, so it is read on from where the previous read stopped, and a size that
 * did not change costs one stat.
 */
export class CodexTitleReader {
    private readonly path: string;
    private readonly chunkBytes: number;
    private readonly names = new Map<string, string>();
    private offset = 0;

    constructor(path: string = CodexTitleReader.defaultPath(), chunkBytes = 1024 * 1024) {
        this.path = path;
        this.chunkBytes = chunkBytes;
    }

    private static defaultPath(): string {
        const sessions = usageRoots().find((root) => root.provider === 'codex')?.path;
        return sessions === undefined ? '' : join(dirname(sessions), 'session_index.jsonl');
    }

    async forThread(threadId: string): Promise<string | null> {
        if (this.path === '') {
            return null;
        }
        let size: number;
        try {
            size = (await stat(this.path)).size;
        } catch {
            return null;
        }
        // Smaller than where we were is a file that was replaced, not one that grew.
        if (size < this.offset) {
            this.offset = 0;
            this.names.clear();
        }
        if (size > this.offset) {
            this.offset = await readLines(this.path, this.offset, size, this.chunkBytes, (line) => this.take(line));
        }
        return this.names.get(threadId) ?? null;
    }

    private take(line: string): void {
        if (!line.includes(MARKER)) {
            return;
        }
        let record: unknown;
        try {
            record = JSON.parse(line);
        } catch {
            return;
        }
        if (typeof record !== 'object' || record === null) {
            return;
        }
        const entry = record as Record<string, unknown>;
        const name = cleanTitle(entry.thread_name);
        if (typeof entry.id === 'string' && name !== null) {
            this.names.set(entry.id, name);
        }
    }
}

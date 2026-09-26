import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { usageRoots } from '@ruimte/agents/usage/roots';
import { cleanTitle, readLines } from '@ruimte/agents/title-file';

// Every line of the index is about a name; one without this key is not worth parsing.
const MARKER = '"thread_name"';

interface Progress {
    offset: number;
    names: Map<string, string>;
}

/* The index in a Codex home, which is the folder CODEX_HOME names. */
export const codexIndexIn = (home: string): string => join(home, 'session_index.jsonl');

/*
 * The name Codex gave a thread, out of `session_index.jsonl` in its home. The TUI appends a line
 * `{"id", "thread_name", "updated_at"}` whenever it names a thread, so the last line for an id is its
 * name. The file only grows, so each index is read on from where the previous read stopped, and a
 * size that did not change costs one stat.
 */
export class CodexTitleReader {
    private readonly path: string;
    private readonly chunkBytes: number;
    private readonly progress = new Map<string, Progress>();

    constructor(path: string = CodexTitleReader.defaultPath(), chunkBytes = 1024 * 1024) {
        this.path = path;
        this.chunkBytes = chunkBytes;
    }

    private static defaultPath(): string {
        const sessions = usageRoots().find((root) => root.provider === 'codex')?.path;
        return sessions === undefined ? '' : codexIndexIn(dirname(sessions));
    }

    /* The name of a thread in the index of the Codex home its TUI runs under; the default home's without one. */
    async forThread(threadId: string, index: string = this.path): Promise<string | null> {
        if (index === '') {
            return null;
        }
        let size: number;
        try {
            size = (await stat(index)).size;
        } catch {
            return null;
        }
        let progress = this.progress.get(index);
        // Smaller than where we were is a file that was replaced, not one that grew.
        if (!progress || size < progress.offset) {
            progress = { offset: 0, names: new Map() };
            this.progress.set(index, progress);
        }
        if (size > progress.offset) {
            const current = progress;
            current.offset = await readLines(index, current.offset, size, this.chunkBytes, (line) => this.take(line, current.names));
        }
        return progress.names.get(threadId) ?? null;
    }

    private take(line: string, names: Map<string, string>): void {
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
            names.set(entry.id, name);
        }
    }
}

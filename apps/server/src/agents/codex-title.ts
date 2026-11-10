import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cleanTitle, readLines } from '@adecore/agents';
import { usageRoots } from '@adecore/agents/usage';
import { isRecord } from '@adecore/utils/record';

// Every line of the index is about a name; one without this key is not worth parsing.
const MARKER = '"thread_name"';

interface Progress {
    offset: number;
    names: Map<string, string>;
}

export function codexIndexIn(home: string): string {
    return join(home, 'session_index.jsonl');
}

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
        if (!isRecord(record)) {
            return;
        }
        const name = cleanTitle(record.thread_name);
        if (typeof record.id === 'string' && name !== null) {
            names.set(record.id, name);
        }
    }
}

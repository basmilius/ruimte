import { existsSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { SUGGESTED_TITLE_LIMIT } from '@ruimte/contracts';
import { usageRoots } from '../usage/roots.ts';

interface Progress {
    // Where the next read starts: just past the last whole line seen.
    offset: number;
    aiTitle: string | null;
    customTitle: string | null;
}

// The two records carry these words; a line without them is never parsed.
const MARKERS = ['"ai-title"', '"custom-title"'];

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]+/g;

/*
 * The model wrote this, so it is text and nothing else: no control characters, no line breaks, one
 * space between words and a length a header can hold.
 */
export const cleanTitle = (raw: unknown): string | null => {
    if (typeof raw !== 'string') {
        return null;
    }
    const text = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
    if (text === '') {
        return null;
    }
    return text.length <= SUGGESTED_TITLE_LIMIT ? text : `${text.slice(0, SUGGESTED_TITLE_LIMIT - 1).trimEnd()}…`;
};

/*
 * The name Claude Code gave a session, out of its own transcript. It writes an `ai-title` record a
 * few seconds after the first prompt, anywhere in the file and more than once, and a `custom-title`
 * when a person ran /rename in the CLI, which wins because a person chose it. A transcript only ever
 * grows, so each path is read from where the previous read stopped: a file of many megabytes costs
 * its full read once, and every read after that only the lines added since.
 */
export class ClaudeTitleReader {
    private readonly progress = new Map<string, Progress>();
    private readonly found = new Map<string, string>();
    private readonly projectsDir: string;
    private readonly chunkBytes: number;

    constructor(projectsDir: string = usageRoots().find((root) => root.provider === 'claude')?.path ?? '', chunkBytes = 4 * 1024 * 1024) {
        this.projectsDir = projectsDir;
        this.chunkBytes = chunkBytes;
    }

    /* The title of a session found by its id, for a chat, which knows no transcript path. */
    async forSession(agentSessionId: string): Promise<string | null> {
        const path = await this.locate(agentSessionId);
        return path === null ? null : await this.forTranscript(path);
    }

    async forTranscript(path: string): Promise<string | null> {
        let size: number;
        try {
            size = (await stat(path)).size;
        } catch {
            return null;
        }
        let progress = this.progress.get(path);
        // Smaller than where we were is a file that was replaced, not one that grew.
        if (!progress || size < progress.offset) {
            progress = { offset: 0, aiTitle: null, customTitle: null };
            this.progress.set(path, progress);
        }
        if (size > progress.offset) {
            await this.readFrom(path, progress, size);
        }
        return progress.customTitle ?? progress.aiTitle;
    }

    private async readFrom(path: string, progress: Progress, size: number): Promise<void> {
        const handle = await open(path, 'r');
        try {
            // In pieces, so a transcript of hundreds of megabytes is never one buffer. Cut on bytes,
            // since a piece may end halfway into a character.
            let carry = Buffer.alloc(0);
            let position = progress.offset;
            while (position < size) {
                const piece = Buffer.alloc(Math.min(this.chunkBytes, size - position));
                const { bytesRead } = await handle.read(piece, 0, piece.length, position);
                if (bytesRead === 0) {
                    return;
                }
                position += bytesRead;
                const bytes = Buffer.concat([carry, piece.subarray(0, bytesRead)]);
                const end = bytes.lastIndexOf(0x0a);
                if (end < 0) {
                    carry = bytes;
                    continue;
                }
                for (const line of bytes.subarray(0, end).toString('utf8').split('\n')) {
                    this.take(line, progress);
                }
                // A line still being written is left for the next read.
                carry = bytes.subarray(end + 1);
                progress.offset = position - carry.length;
            }
        } finally {
            await handle.close();
        }
    }

    private take(line: string, progress: Progress): void {
        if (!MARKERS.some((marker) => line.includes(marker))) {
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
        if (entry.type === 'ai-title') {
            progress.aiTitle = cleanTitle(entry.aiTitle) ?? progress.aiTitle;
        } else if (entry.type === 'custom-title') {
            progress.customTitle = cleanTitle(entry.customTitle) ?? progress.customTitle;
        }
    }

    /* The folder a transcript sits in is named after the working directory, so the file name is the only key a session id gives. */
    private async locate(agentSessionId: string): Promise<string | null> {
        const known = this.found.get(agentSessionId);
        if (known !== undefined && existsSync(known)) {
            return known;
        }
        if (this.projectsDir === '' || agentSessionId.includes('/')) {
            return null;
        }
        let dirs: string[];
        try {
            dirs = await readdir(this.projectsDir);
        } catch {
            return null;
        }
        const file = `${agentSessionId}.jsonl`;
        for (const dir of dirs) {
            const path = join(this.projectsDir, dir, file);
            if (existsSync(path)) {
                this.found.set(agentSessionId, path);
                return path;
            }
        }
        return null;
    }
}

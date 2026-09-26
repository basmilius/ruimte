import { closeSync, fstatSync, mkdirSync, openSync, readSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { ChatEventSchema, type ChatEvent } from '@ruimte/agent-contracts';
import { z } from 'zod';
import { errorText } from '../error-text.ts';
import { writeAtomicSync } from '../fs.ts';

export interface ChatLogLine {
    seq: number;
    at: number;
    event: ChatEvent;
}

/* Past this the next write of the record folds the log into it. */
export const COMPACT_ABOVE_BYTES = 1024 * 1024;

const LineSchema = z.object({ seq: z.number().int().positive(), at: z.number(), event: ChatEventSchema });

/*
 * The lines of a log as they were written. A line that does not parse is left out: a crash in the
 * middle of an append leaves a torn last line, and what came before it is still good.
 */
export const parseLog = (raw: string): ChatLogLine[] => {
    const lines: ChatLogLine[] = [];
    for (const text of raw.split('\n')) {
        if (text === '') {
            continue;
        }
        let parsed: ReturnType<typeof LineSchema.safeParse>;
        try {
            parsed = LineSchema.safeParse(JSON.parse(text));
        } catch {
            continue;
        }
        if (parsed.success && parsed.data.seq > (lines.at(-1)?.seq ?? 0)) {
            lines.push(parsed.data);
        }
    }
    return lines;
};

export interface ChatLogState {
    // The last seq anything on disk accounts for, the snapshot or the log.
    seq: number;
    resetSeq: number;
    // What the log file still holds, oldest first.
    lines: ChatLogLine[];
}

/*
 * Number and synchronously append each broadcast event so disk, memory and snapshot boundaries keep
 * one order. Recent lines stay in memory for immediate `since` attachment.
 */
export class ChatLog {
    private readonly path: string | null;
    private lines: ChatLogLine[];
    private bytes: number;
    // Every event after this seq is in `lines`; anything at or before it only the snapshot still has.
    private base: number;
    private fd: number | null = null;
    private seqValue: number;
    private resetSeqValue: number;
    // False once a line failed to reach the disk, until a fold writes the file again.
    private written = true;

    constructor(path: string | null, state: ChatLogState = { seq: 0, resetSeq: 0, lines: [] }) {
        this.path = path;
        this.lines = state.lines;
        this.bytes = state.lines.reduce((sum, line) => sum + JSON.stringify(line).length + 1, 0);
        this.seqValue = Math.max(state.seq, state.lines.at(-1)?.seq ?? 0);
        this.resetSeqValue = state.resetSeq;
        const first = state.lines[0];
        // A log with a hole in front of it only answers from after the hole.
        this.base = first === undefined ? this.seqValue : first.seq - 1;
        for (let i = 1; i < state.lines.length; i++) {
            if (state.lines[i]!.seq !== state.lines[i - 1]!.seq + 1) {
                this.base = state.lines[i - 1]!.seq;
                this.lines = state.lines.slice(i);
            }
        }
    }

    get seq(): number {
        return this.seqValue;
    }

    get resetSeq(): number {
        return this.resetSeqValue;
    }

    /* How much the log file holds, which is what decides whether writing a snapshot folds it in. */
    get size(): number {
        return this.bytes;
    }

    /* Whether the file holds every line since the last fold, which is what lets a snapshot wait. */
    get onDisk(): boolean {
        return this.written;
    }

    /* Numbers an event and writes it down; answers its seq. The seq holds even when the disk refused the line. */
    append(event: ChatEvent, at: number): number {
        this.seqValue += 1;
        const line: ChatLogLine = { seq: this.seqValue, at, event };
        if (event.type === 'reset') {
            this.resetSeqValue = line.seq;
        }
        const text = `${JSON.stringify(line)}\n`;
        this.lines.push(line);
        this.bytes += text.length;
        if (this.path !== null) {
            try {
                this.fd ??= this.open(this.path);
                writeSync(this.fd, text);
            } catch (e) {
                this.written = false;
                // The event still reaches every client; only a restart before the next snapshot loses it.
                console.error(`Appending to ${this.path} failed:`, errorText(e));
            }
        }
        return line.seq;
    }

    /*
     * What came after `since`, when all of it is still here: null for a seq from before a reset (the
     * thread it built on is gone), from before the lines held (folded into the snapshot) or from a
     * stream this chat never reached.
     */
    after(since: number): ChatEvent[] | null {
        if (since < this.resetSeqValue || since < this.base || since > this.seqValue) {
            return null;
        }
        return this.lines.filter((line) => line.seq > since).map((line) => line.event);
    }

    /*
     * Folds the log into a snapshot that holds everything up to `seq`. What came after it (events
     * broadcast while that snapshot was on its way to disk) is written again as the whole log, in
     * one synchronous step, so no append can land between the two. A snapshot older than the last
     * fold changes nothing.
     */
    compact(seq: number): void {
        if (seq <= this.base) {
            return;
        }
        this.lines = this.lines.filter((line) => line.seq > seq);
        this.base = seq;
        const text = this.lines.map((line) => `${JSON.stringify(line)}\n`).join('');
        this.bytes = text.length;
        if (this.path === null) {
            return;
        }
        this.close();
        try {
            if (text === '') {
                rmSync(this.path, { force: true });
            } else {
                writeAtomicSync(this.path, text);
            }
            this.written = true;
        } catch (e) {
            console.error(`Compacting ${this.path} failed:`, errorText(e));
        }
    }

    close(): void {
        if (this.fd !== null) {
            closeSync(this.fd);
            this.fd = null;
        }
    }

    /* A torn last line from a crash gets its newline first, so the next line does not run into it and get lost with it. */
    private open(path: string): number {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        const fd = openSync(path, 'a+', 0o600);
        const { size } = fstatSync(fd);
        if (size > 0) {
            const last = Buffer.alloc(1);
            readSync(fd, last, 0, 1, size - 1);
            if (last[0] !== 0x0a) {
                writeSync(fd, '\n');
            }
        }
        return fd;
    }
}

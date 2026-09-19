import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeAtomicSync } from '../fs.ts';
import { PushAttentionResultSchema, type PushAttentionEntry } from '@ruimte/contracts';

const RETENTION_MS = 30 * 24 * 60 * 60_000;

export class PushAttention {
    private readonly entries = new Map<string, PushAttentionEntry>();
    /*
     * The first moment this ledger ran on a version whose clients mark nodes from it. Entries from
     * before were only ever about notifications, and up to 30 days of them would otherwise all turn
     * into marks after an update.
     */
    readonly marksFrom: number;

    private readonly path: string | undefined;
    private readonly now: () => number;

    constructor(path?: string, now: () => number = Date.now) {
        this.path = path;
        this.now = now;
        let marksFrom: number | undefined;
        if (path && existsSync(path)) {
            const saved = PushAttentionResultSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
            for (const entry of saved.entries) {
                this.entries.set(entry.nodeId, entry);
            }
            marksFrom = saved.marksFrom;
        }
        this.marksFrom = marksFrom ?? this.now();
        this.prune();
        if (marksFrom === undefined) {
            this.save();
        }
    }

    snapshot(): PushAttentionEntry[] {
        this.prune();
        return [...this.entries.values()];
    }

    notify(nodeId: string): PushAttentionEntry {
        const previous = this.entries.get(nodeId);
        const entry = { nodeId, issuedAt: Math.max(this.now(), (previous?.issuedAt ?? 0) + 1), readThrough: previous?.readThrough ?? 0 };
        this.entries.set(nodeId, entry);
        this.save();
        return entry;
    }

    read(nodeId: string, issuedAt: number): PushAttentionEntry | null {
        const previous = this.entries.get(nodeId);
        // A delayed acknowledgment may clear an older turn, but never the next one.
        if (!previous || issuedAt > previous.issuedAt || issuedAt <= previous.readThrough) {
            return null;
        }
        const entry = { ...previous, readThrough: issuedAt };
        this.entries.set(nodeId, entry);
        this.save();
        return entry;
    }

    isRead(nodeId: string, issuedAt: number): boolean {
        return (this.entries.get(nodeId)?.readThrough ?? 0) >= issuedAt;
    }

    private prune(): void {
        for (const [id, entry] of this.entries) {
            if (entry.issuedAt < this.now() - RETENTION_MS) {
                this.entries.delete(id);
            }
        }
        while (this.entries.size > 1000) {
            const oldest = [...this.entries.values()].sort((left, right) => left.issuedAt - right.issuedAt)[0]!;
            this.entries.delete(oldest.nodeId);
        }
    }

    private save(): void {
        this.prune();
        if (!this.path) {
            return;
        }
        mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
        writeAtomicSync(this.path, JSON.stringify({ entries: [...this.entries.values()], marksFrom: this.marksFrom }));
    }
}

/* What one sample says of a window's renderer: its memory as the OS counts it, and the pages it hosts. */
export interface RendererSample {
    readonly contentsId: number;
    readonly workingSetKb: number;
    readonly guests: number;
}

/* What a report of a renderer that ran out of memory carries about it, from the samples before it went. */
export interface RendererMemoryReport {
    readonly memoryMb: number;
    readonly peakMemoryMb: number;
    readonly uptimeMin: number;
    readonly guests: number;
}

interface Tracked {
    readonly since: number;
    last: RendererSample;
    peakKb: number;
}

/*
 * Keeps the last sample of every window's renderer, taken by the main process, since a renderer that
 * is gone can no longer say how large it was. Only sizes and counts, never what a page holds.
 */
export class RendererMemory {
    private readonly tracked = new Map<number, Tracked>();

    sample(samples: readonly RendererSample[], now: number): void {
        const seen = new Set<number>();

        for (const sample of samples) {
            seen.add(sample.contentsId);

            const current = this.tracked.get(sample.contentsId);

            if (current === undefined) {
                this.tracked.set(sample.contentsId, { since: now, last: sample, peakKb: sample.workingSetKb });
                continue;
            }

            current.last = sample;
            current.peakKb = Math.max(current.peakKb, sample.workingSetKb);
        }

        for (const id of this.tracked.keys()) {
            if (!seen.has(id)) {
                this.tracked.delete(id);
            }
        }
    }

    reportOf(contentsId: number, now: number): RendererMemoryReport | null {
        const tracked = this.tracked.get(contentsId);

        if (tracked === undefined) {
            return null;
        }

        return {
            memoryMb: Math.round(tracked.last.workingSetKb / 1024),
            peakMemoryMb: Math.round(tracked.peakKb / 1024),
            uptimeMin: Math.round((now - tracked.since) / 60_000),
            guests: tracked.last.guests
        };
    }
}

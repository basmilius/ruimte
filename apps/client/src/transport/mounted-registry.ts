// Enough to hide the round trips of a slow link, few enough that a first screen is not queued behind twenty.
const REATTACH_CONCURRENCY = 4;

export interface MountedEntry {
    /* False between a lost connection (or a failed attach) and the next successful attach. */
    attached: boolean;
}

/*
 * What a client keeps for the nodes it has open on one machine, and the reconnect discipline they
 * all share: a lost socket detaches everything, and the socket that comes back attaches it again.
 * The daemon on the other side is a fresh one as far as this client knows, so nothing is assumed.
 */
export class MountedRegistry<T extends MountedEntry> extends Map<string, T> {
    /* Nothing is attached over a link that is gone; `report` is how a store hears about it. */
    detachAll(report?: (id: string, entry: T) => void): void {
        for (const [id, entry] of this) {
            entry.attached = false;
            report?.(id, entry);
        }
    }

    /*
     * One pass over what is mounted but not attached, in mount order, a few at a time. It works on a
     * copy, because attaching mounts and unmounts as it goes. An entry that left in the meantime is
     * skipped, since a node may leave the canvas while its attach is on the wire.
     */
    async reattachAll(reattach: (id: string, entry: T) => Promise<void>): Promise<void> {
        const queue = [...this];
        const work = async (): Promise<void> => {
            for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
                const [id, entry] = next;
                if (entry.attached || this.get(id) !== entry) {
                    continue;
                }
                try {
                    await reattach(id, entry);
                } catch {
                    // A socket that dropped again brings the next pass; anything else surfaces on the next mount.
                }
            }
        };
        await Promise.all(Array.from({ length: REATTACH_CONCURRENCY }, work));
    }
}

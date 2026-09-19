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
     * One pass over what is mounted but not attached, in the order it was mounted. The list is
     * copied first, because attaching mounts and unmounts as it goes, and an entry that went in the
     * meantime is left alone: a node may leave the canvas while its attach is still on the wire.
     */
    async reattachAll(reattach: (id: string, entry: T) => Promise<void>): Promise<void> {
        for (const [id, entry] of [...this]) {
            if (entry.attached || this.get(id) !== entry) {
                continue;
            }
            try {
                await reattach(id, entry);
            } catch {
                // A socket that dropped again brings the next pass; anything else surfaces on the next mount.
            }
        }
    }
}

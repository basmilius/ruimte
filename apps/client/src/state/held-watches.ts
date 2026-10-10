import { endpointKey } from '@/state/keys';
import type { Transport } from '@/transport/transport';

interface Held {
    endpointId: string;
    path: string;
    /* How many readers want this path; the daemon hears about the first and the last. */
    count: number;
    ready: Promise<void>;
    /* What each reader does once the daemon watches again after its link came back. */
    renewed: Set<() => void>;
}

export interface HeldWatch {
    /* Resolves once the daemon is watching, which is what a first read waits for so a write in between is reported rather than missed. */
    ready: Promise<void>;
    release: () => void;
}

/*
 * Watches on a daemon, counted per machine and path. The daemon keeps one per client and per path
 * with no count of its own, so one reader letting go would leave another blind. It also forgets every
 * one of them with the socket, so a link that opens again is asked for all that are still held, and
 * their readers read once more for whatever changed while it was down.
 */
export abstract class HeldWatches {
    private readonly held = new Map<string, Held>();
    /* The link of each machine anything is held on, followed for as long as that lasts. */
    private readonly following = new Map<string, () => void>();
    private readonly linkFor: (endpointId: string) => Transport;

    constructor(linkFor: (endpointId: string) => Transport) {
        this.linkFor = linkFor;
    }

    /* `renewed` runs every time the daemon watches again after a lost link, since nothing was reported in between. */
    watch(endpointId: string, path: string, renewed?: () => void): HeldWatch {
        const key = endpointKey(endpointId, path);
        const link = this.linkFor(endpointId);
        const held = this.held.get(key) ?? { endpointId, path, count: 0, ready: this.request(link, path), renewed: new Set() };
        held.count += 1;
        this.held.set(key, held);
        this.follow(endpointId, link);
        // One of its own per call, so two readers handing in the same function each keep theirs.
        const reader = renewed === undefined ? null : (): void => renewed();
        if (reader !== null) {
            held.renewed.add(reader);
        }
        let released = false;
        return {
            ready: held.ready,
            release: () => {
                if (released) {
                    return;
                }
                released = true;
                if (reader !== null) {
                    held.renewed.delete(reader);
                }
                held.count -= 1;
                if (held.count > 0) {
                    return;
                }
                this.held.delete(key);
                // On the machine the watch was taken out on, never on the one that happens to be active now.
                void this.unask(link, path).catch(() => undefined);
                this.released(endpointId, path);
                if (this.heldOn(endpointId).length === 0) {
                    this.following.get(endpointId)?.();
                    this.following.delete(endpointId);
                }
            }
        };
    }

    protected abstract ask(link: Transport, path: string): Promise<unknown>;

    protected abstract unask(link: Transport, path: string): Promise<unknown>;

    /* After the last reader of a path let go. */
    protected released(_endpointId: string, _path: string): void {}

    /* Asks the daemon again for the paths held on one machine that `which` picks. */
    protected askAgain(endpointId: string, which: (path: string) => boolean): Held[] {
        const link = this.linkFor(endpointId);
        const asked = this.heldOn(endpointId).filter((held) => which(held.path));
        for (const held of asked) {
            held.ready = this.request(link, held.path);
        }
        return asked;
    }

    private heldOn(endpointId: string): Held[] {
        return [...this.held.values()].filter((held) => held.endpointId === endpointId);
    }

    private follow(endpointId: string, link: Transport): void {
        if (this.following.has(endpointId)) {
            return;
        }
        const off = link.subscribeStatus((status) => {
            if (status !== 'open') {
                return;
            }
            for (const held of this.askAgain(endpointId, () => true)) {
                void held.ready.then(() => {
                    for (const reader of [...held.renewed]) {
                        reader();
                    }
                });
            }
        });
        this.following.set(endpointId, off);
    }

    private request(link: Transport, path: string): Promise<void> {
        return this.ask(link, path).then(
            () => undefined,
            () => undefined
        );
    }
}

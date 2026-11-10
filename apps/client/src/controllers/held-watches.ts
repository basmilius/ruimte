import { endpointKey } from '@/state/keys';
import type { Transport } from '@/transport-api/transport';
import { fireAndForget } from '@/transport-api/transport';

interface Held<A> {
    endpointId: string;
    path: string;
    /* How many readers want this path; the daemon hears about the first and the last. */
    count: number;
    ready: Promise<void>;
    answer: Promise<A | undefined>;
    /* Refreshes each reader after its watch is registered again. */
    renewed: Set<() => void>;
}

export interface HeldWatch<A = unknown> {
    /* The current readiness barrier; re-registering a watch replaces it so reads cannot miss writes during startup. */
    ready: Promise<void>;
    /* What the daemon answered the call that opened the watch; undefined for a reader that joined one
       already open, since that answer may be long out of date. */
    answer: Promise<A | undefined>;
    release: () => void;
}

/*
 * Watches on a daemon, counted per machine and path. The daemon keeps one per client and per path
 * with no count of its own, so one reader letting go would leave another blind. It also forgets every
 * one of them with the socket, so a link that opens again is asked for all that are still held, and
 * their readers read once more for whatever changed while it was down.
 */
export abstract class HeldWatches<A = unknown> {
    private readonly held = new Map<string, Held<A>>();
    /* The link of each machine anything is held on, followed for as long as that lasts. */
    private readonly following = new Map<string, () => void>();
    private readonly linkFor: (endpointId: string) => Transport;

    constructor(linkFor: (endpointId: string) => Transport) {
        this.linkFor = linkFor;
    }

    /* Re-registration refreshes readers because changes during the gap were not reported. */
    watch(endpointId: string, path: string, renewed?: () => void): HeldWatch<A> {
        const key = endpointKey(endpointId, path);
        const link = this.linkFor(endpointId);
        const open = this.held.get(key);
        const held = open ?? { endpointId, path, count: 0, ...this.request(link, path), renewed: new Set() };
        held.count += 1;
        this.held.set(key, held);
        this.follow(endpointId, link);
        // One of its own per call, so two readers handing in the same function each keep theirs.
        const reader = renewed === undefined ? null : (): void => renewed();
        if (reader !== null) {
            held.renewed.add(reader);
        }
        if (open === undefined) {
            this.opened(endpointId, path);
        }
        let released = false;
        return {
            get ready() {
                return held.ready;
            },
            answer: open === undefined ? held.answer : Promise.resolve(undefined),
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
                void fireAndForget('unask', this.unask(link, path));
                this.released(endpointId, path);
                if (this.heldOn(endpointId).length === 0) {
                    this.following.get(endpointId)?.();
                    this.following.delete(endpointId);
                }
            }
        };
    }

    protected abstract ask(link: Transport, path: string): Promise<A>;

    protected abstract unask(link: Transport, path: string): Promise<unknown>;

    protected opened(_endpointId: string, _path: string): void {}

    /* After the last reader of a path let go. */
    protected released(_endpointId: string, _path: string): void {}

    /* Asks the daemon again for the paths held on one machine that `which` picks, and has their readers read once it watches again. */
    protected renew(endpointId: string, which: (path: string) => boolean): void {
        const link = this.linkFor(endpointId);
        for (const held of this.heldOn(endpointId).filter((entry) => which(entry.path))) {
            const next = this.request(link, held.path);
            held.ready = next.ready;
            held.answer = next.answer;
            void held.ready.then(() => {
                for (const reader of [...held.renewed]) {
                    reader();
                }
            });
        }
    }

    private heldOn(endpointId: string): Held<A>[] {
        return [...this.held.values()].filter((held) => held.endpointId === endpointId);
    }

    private follow(endpointId: string, link: Transport): void {
        if (this.following.has(endpointId)) {
            return;
        }
        const off = link.subscribeStatus((status) => {
            if (status === 'open') {
                this.renew(endpointId, () => true);
            }
        });
        this.following.set(endpointId, off);
    }

    private request(link: Transport, path: string): { ready: Promise<void>; answer: Promise<A | undefined> } {
        const asked = this.ask(link, path);
        return {
            ready: asked.then(
                () => undefined,
                () => undefined
            ),
            answer: asked.catch(() => undefined)
        };
    }
}

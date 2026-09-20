/* How many terminals may hold a WebGL renderer at the same time. A browser keeps about 16 live
   contexts per page and silently drops the oldest, so the budget stays well under that and leaves
   room for the browser nodes. */
export const DEFAULT_WEBGL_CONTEXTS = 10;

export interface SlotChange {
    granted: string[];
    revoked: string[];
}

interface Member {
    /* Stamp of the last focus, write or request; the ranking is this number, high to low. */
    seq: number;
    holding: boolean;
    /* The browser took this terminal's context away, so it stays out of the running until a focus. */
    blocked: boolean;
}

const nothing = (): SlotChange => ({ granted: [], revoked: [] });

/**
 * Hands a fixed number of WebGL contexts to the terminals that deserve them most, the focused one
 * first, then the ones most recently focused or written to. Knows nothing about xterm or the DOM;
 * the coordinator turns a `SlotChange` into addons that are loaded and disposed.
 */
export class WebglSlots {
    private readonly members = new Map<string, Member>();
    private cap: number;
    private focusedId: string | null = null;
    private stamp = 0;

    constructor(cap: number = DEFAULT_WEBGL_CONTEXTS) {
        this.cap = Math.max(1, cap);
    }

    /* The terminals holding a context, highest ranked first. */
    holders(): string[] {
        return this.ranked().filter((id) => this.holds(id));
    }

    holds(id: string): boolean {
        return this.members.get(id)?.holding === true;
    }

    /* The terminals that want a context and do not have one, highest ranked first. */
    waiting(): string[] {
        return this.ranked().filter((id) => !this.holds(id));
    }

    /* A terminal that just became visible asks for a context. */
    request(id: string): SlotChange {
        const member = this.members.get(id);
        if (member) {
            member.seq = ++this.stamp;
        } else {
            this.members.set(id, { seq: ++this.stamp, holding: false, blocked: false });
        }
        return this.reconcile();
    }

    /* A terminal that unmounts or falls back to its plate leaves the running for good. */
    release(id: string): SlotChange {
        if (!this.members.delete(id)) {
            return nothing();
        }
        if (this.focusedId === id) {
            this.focusedId = null;
        }
        return this.reconcile();
    }

    focus(id: string): SlotChange {
        this.focusedId = id;
        const member = this.members.get(id);
        if (!member) {
            return nothing();
        }
        member.seq = ++this.stamp;
        // Focusing is how a terminal that lost its context asks for a new one.
        member.blocked = false;
        return this.reconcile();
    }

    blur(id: string): SlotChange {
        if (this.focusedId !== id) {
            return nothing();
        }
        this.focusedId = null;
        return this.reconcile();
    }

    /* Output arrived, so this terminal is worth more than an idle one. */
    touch(id: string): SlotChange {
        const member = this.members.get(id);
        if (!member) {
            return nothing();
        }
        member.seq = ++this.stamp;
        // A holder that climbs stays a holder; only a waiter can change who holds what.
        return member.holding ? nothing() : this.reconcile();
    }

    /* The browser reported a context loss, free the slot and wait for a focus before asking again. */
    lost(id: string): SlotChange {
        const member = this.members.get(id);
        if (!member) {
            return nothing();
        }
        member.holding = false;
        member.blocked = true;
        return this.reconcile();
    }

    setCap(cap: number): SlotChange {
        this.cap = Math.max(1, cap);
        return this.reconcile();
    }

    private ranked(): string[] {
        return [...this.members.keys()].sort((a, b) => this.rankOf(b) - this.rankOf(a));
    }

    private rankOf(id: string): number {
        // The focused terminal is the one the person is looking at, whatever its last write says.
        if (id === this.focusedId) {
            return Number.MAX_SAFE_INTEGER;
        }
        return this.members.get(id)?.seq ?? -1;
    }

    private reconcile(): SlotChange {
        const eligible = this.ranked().filter((id) => this.members.get(id)?.blocked !== true);
        const target = new Set(eligible.slice(0, this.cap));
        const granted: string[] = [];
        const revoked: string[] = [];
        for (const [id, member] of this.members) {
            if (target.has(id) && !member.holding) {
                member.holding = true;
                granted.push(id);
            } else if (!target.has(id) && member.holding) {
                member.holding = false;
                revoked.push(id);
            }
        }
        return { granted, revoked };
    }
}

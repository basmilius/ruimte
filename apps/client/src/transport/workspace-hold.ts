import type { Endpoint } from '@/state/endpoints';

/* One hold on one machine at a time. A workspace takes it when it is built and drops it when it goes. */
export class LinkHold {
    private readonly take: (endpoint: Endpoint) => () => void;
    private heldId: string | null = null;
    private release: (() => void) | null = null;

    constructor(take: (endpoint: Endpoint) => () => void) {
        this.take = take;
    }

    get endpointId(): string | null {
        return this.heldId;
    }

    /* The machine to keep a link to, or null for none. A new hold is taken before the old one goes, so a move never closes a link both sides share. */
    set(endpoint: Endpoint | null): void {
        if ((endpoint?.id ?? null) === this.heldId) {
            return;
        }
        const before = this.release;
        this.release = endpoint ? this.take(endpoint) : null;
        this.heldId = endpoint?.id ?? null;
        before?.();
    }
}

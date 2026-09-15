import { ActiveTransport, type ActiveSource } from './active-transport';
import type { Transport } from './transport';

interface Followed {
    transport: Transport;
    target: string;
}

/*
 * One transport per machine that stays the same object while the pool opens, closes and opens its
 * link again, and never opens one itself. The clients of a workspace are built on it, so a machine
 * nobody uses can close without anything having to be rebuilt when it opens again.
 */
export class MachineTransports {
    private readonly source: ActiveSource;
    private readonly byId = new Map<string, Followed>();

    constructor(source: ActiveSource) {
        this.source = source;
    }

    of(endpointId: string): Transport {
        const existing = this.byId.get(endpointId);
        if (existing) {
            return existing.transport;
        }
        const followed: Followed = { transport: null as unknown as Transport, target: endpointId };
        followed.transport = new ActiveTransport({
            source: this.source,
            activeId: () => followed.target,
            subscribeActive: () => () => undefined
        });
        this.byId.set(endpointId, followed);
        return followed.transport;
    }

    /*
     * A row that learned its daemon id. Called before the pool moves the link: the pool's own word
     * about the move is what makes the transport look again, and by then the link is under the new
     * id, so the clients on it never see it close.
     */
    rekey(oldId: string, newId: string): void {
        const followed = this.byId.get(oldId);
        if (!followed || oldId === newId) {
            return;
        }
        followed.target = newId;
        this.byId.delete(oldId);
        if (!this.byId.has(newId)) {
            this.byId.set(newId, followed);
        }
    }
}

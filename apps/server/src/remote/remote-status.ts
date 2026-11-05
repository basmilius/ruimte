import type { RemoteStatusEvent } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import type { SessionSink } from '../wire.ts';

/*
 * Where the link to each machine this one works in stands, told to every client. A client that
 * subscribes hears the standing answer once, so a fresh socket needs no request for it.
 */
export class RemoteStatus {
    private readonly sinks = new ClientSinks();
    private readonly standing = new Map<string, RemoteStatusEvent>();

    subscribe(clientId: string, sink: SessionSink): () => void {
        const unsubscribe = this.sinks.subscribe(clientId, sink);
        for (const payload of this.standing.values()) {
            sink({ event: 'remote.status', payload });
        }
        return unsubscribe;
    }

    get(machineId: string): RemoteStatusEvent | null {
        return this.standing.get(machineId) ?? null;
    }

    /* Tells the clients only when something changed. */
    set(status: RemoteStatusEvent): void {
        const held = this.standing.get(status.machineId);
        if (
            held !== undefined &&
            held.state === status.state &&
            held.owed === status.owed &&
            held.nextAttemptAt === status.nextAttemptAt &&
            held.brokerUrl === status.brokerUrl &&
            JSON.stringify(held.unstartedNodeIds ?? []) === JSON.stringify(status.unstartedNodeIds ?? [])
        ) {
            return;
        }
        this.standing.set(status.machineId, status);
        this.sinks.emit({ event: 'remote.status', payload: status });
    }

    /* The link is shut and nothing waits on it: clients that heard of it are told once, and a client that comes later hears nothing. */
    forget(machineId: string): void {
        if (this.standing.delete(machineId)) {
            this.sinks.emit({ event: 'remote.status', payload: { machineId, state: 'closed', owed: 0 } });
        }
    }
}

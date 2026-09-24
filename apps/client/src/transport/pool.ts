import type { Endpoint } from '@/state/endpoints';
import type { ConnectionState, Transport, TransportStatus } from './transport';
import type { SocketAddress } from './link-transport';

/* How long a socket nobody holds stays up, so a switch there and back costs no round trip. */
const IDLE_CLOSE_MS = 30_000;

/* One object for "there is no socket", so a React store reading the pool gets a stable snapshot. */
const NO_SOCKET: ConnectionState = { status: 'closed', attempts: 0, retryAt: null, noLink: true };

/* What the pool needs of a socket on top of `Transport`: a way to move it and a way to end it. */
export interface PooledTransport extends Transport {
    switchTo(address: SocketAddress): void;
    retarget(address: SocketAddress): void;
    /* Drops the connection and opens a new one now; what a machine switched to or from a direct connection gets. */
    reconnect(): void;
    dispose(): void;
}

export interface TransportPoolOptions {
    /*
     * Opens a socket for an endpoint. The pool builds no addresses, which is what lets a test hand it
     * fakes. `currentId` is the id the entry is under right now, which a rekey changes.
     */
    open(endpoint: Endpoint, currentId: () => string): PooledTransport;
    idleMs?: number;
}

interface Entry {
    endpointId: string;
    transport: PooledTransport;
    /* How many callers need this socket up; at zero the idle countdown starts. */
    holds: number;
    idleTimer: ReturnType<typeof setTimeout> | null;
    offStatus: () => void;
}

/*
 * The sockets this client holds, one per daemon. A daemon is a socket, a socket is never shared,
 * and it never changes machines. Picking another machine picks another entry. Only a daemon that
 * answers on another address (a re-pair, a new port) moves the socket it already has.
 */
export class TransportPool {
    private readonly open: (endpoint: Endpoint, currentId: () => string) => PooledTransport;
    private readonly idleMs: number;
    private readonly byId = new Map<string, Entry>();
    private readonly listeners = new Set<() => void>();
    private readonly statusListeners = new Map<string, Set<(status: TransportStatus) => void>>();
    private snapshot: string[] = [];

    constructor(options: TransportPoolOptions) {
        this.open = options.open;
        this.idleMs = options.idleMs ?? IDLE_CLOSE_MS;
    }

    /* The socket if there is one; null when nothing holds this endpoint and its grace period ran out. Never opens one. */
    peek(endpointId: string): Transport | null {
        return this.byId.get(endpointId)?.transport ?? null;
    }

    /*
     * Takes a hold, opening the socket when there is none. This is the only way a socket opens. It
     * stays up until every holder releases it and the idle countdown after the last one runs out.
     */
    hold(endpoint: Endpoint): () => void {
        const entry = this.entryFor(endpoint);
        entry.holds += 1;
        this.arm(entry);
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            // A hold on a socket that was dropped or replaced since has nothing left to let go of.
            if (this.byId.get(entry.endpointId) !== entry) {
                return;
            }
            entry.holds -= 1;
            this.arm(entry);
        };
    }

    /* The endpoints this client has a socket for. The array only changes when the set does. */
    ids(): string[] {
        return this.snapshot;
    }

    /* The address of an endpoint changed (a re-pair, another port); move the socket it already has. */
    readdress(endpointId: string, address: SocketAddress): void {
        this.byId.get(endpointId)?.transport.switchTo(address);
    }

    /*
     * The daemon behind a row turned out to be one this client already knows under another id. The
     * socket stays up and only learns where to come back. The address it was opened with is about
     * the row it just left, and a reconnect would look for an endpoint that no longer exists.
     */
    rekey(oldId: string, newId: string, address: SocketAddress): void {
        const entry = this.byId.get(oldId);
        if (!entry || oldId === newId) {
            return;
        }
        const replaced = this.byId.get(newId);
        if (replaced) {
            this.retire(replaced);
        }
        this.byId.delete(oldId);
        this.byId.set(newId, entry);
        entry.endpointId = newId;
        entry.transport.retarget(address);
        entry.offStatus();
        entry.offStatus = entry.transport.subscribeStatus(() => this.emit(newId));
        this.resnapshot();
        this.emit(oldId);
        this.emit(newId);
    }

    /* The connection comes up again on what the row says now, keeping every holder and every client built on it. */
    reconnect(endpointId: string): void {
        this.byId.get(endpointId)?.transport.reconnect();
    }

    /* Closes the socket and forgets it; what a forgotten or revoked endpoint gets. */
    drop(endpointId: string): void {
        const entry = this.byId.get(endpointId);
        if (entry) {
            this.close(entry);
        }
    }

    statusOf(endpointId: string): ConnectionState {
        return this.byId.get(endpointId)?.transport.connection ?? NO_SOCKET;
    }

    /* One endpoint's status, for a row in a list of machines. */
    subscribeStatus(endpointId: string, handler: (status: TransportStatus) => void): () => void {
        let handlers = this.statusListeners.get(endpointId);
        if (!handlers) {
            handlers = new Set();
            this.statusListeners.set(endpointId, handlers);
        }
        handlers.add(handler);
        return () => {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.statusListeners.delete(endpointId);
            }
        };
    }

    /* Any endpoint's status changed, or the pool gained or lost one. */
    subscribe(handler: () => void): () => void {
        this.listeners.add(handler);
        return () => {
            this.listeners.delete(handler);
        };
    }

    private entryFor(endpoint: Endpoint): Entry {
        const existing = this.byId.get(endpoint.id);
        if (existing) {
            return existing;
        }
        const holder: { entry: Entry | null } = { entry: null };
        const transport = this.open(endpoint, () => holder.entry?.endpointId ?? endpoint.id);
        const entry: Entry = { endpointId: endpoint.id, transport, holds: 0, idleTimer: null, offStatus: () => undefined };
        holder.entry = entry;
        this.byId.set(endpoint.id, entry);
        entry.offStatus = transport.subscribeStatus(() => this.emit(endpoint.id));
        this.resnapshot();
        this.arm(entry);
        this.emit(endpoint.id);
        return entry;
    }

    /*
     * A socket nothing holds is on a countdown. It is not closed straight away because the reason
     * the last holder let go is usually a pane that closed or a switch, both of which come back.
     */
    private arm(entry: Entry): void {
        if (entry.idleTimer) {
            clearTimeout(entry.idleTimer);
            entry.idleTimer = null;
        }
        if (entry.holds > 0) {
            return;
        }
        entry.idleTimer = setTimeout(() => {
            entry.idleTimer = null;
            this.close(entry);
        }, this.idleMs);
    }

    /* By identity: the id may meanwhile name a newer socket, which is not this one to close. */
    private close(entry: Entry): void {
        if (this.byId.get(entry.endpointId) !== entry) {
            return;
        }
        this.byId.delete(entry.endpointId);
        this.retire(entry);
        this.resnapshot();
        this.emit(entry.endpointId);
    }

    /* Ends a socket that is out of the map, with nothing of it left to fire. */
    private retire(entry: Entry): void {
        if (entry.idleTimer) {
            clearTimeout(entry.idleTimer);
            entry.idleTimer = null;
        }
        entry.offStatus();
        entry.transport.dispose();
    }

    private resnapshot(): void {
        this.snapshot = [...this.byId.keys()];
    }

    private emit(endpointId: string): void {
        const status = this.statusOf(endpointId).status;
        for (const handler of [...(this.statusListeners.get(endpointId) ?? [])]) {
            handler(status);
        }
        for (const handler of [...this.listeners]) {
            handler();
        }
    }
}

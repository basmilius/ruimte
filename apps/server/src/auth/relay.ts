/*
 * A relay would make a daemon behind NAT reachable through a rendezvous server. Nothing here
 * does that yet; the seam exists so the rest of the daemon never learns how it is reached.
 */
export interface Relay {
    /* Announces where this daemon listens; answers the public address, if the relay gives one. */
    publish(local: { host: string; port: number }): Promise<string | null>;
    stop(): Promise<void>;
}

export class NoRelay implements Relay {
    async publish(): Promise<string | null> {
        return null;
    }

    async stop(): Promise<void> {
        // Nothing was started.
    }
}

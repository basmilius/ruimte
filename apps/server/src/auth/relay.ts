/*
 * How a daemon behind NAT is found: `BrokerRelay` (`src/pulsar/broker-relay.ts`) announces it to a
 * Pulsar broker, and `NoRelay` is a daemon started without one. The rest of the daemon never learns
 * which it is.
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

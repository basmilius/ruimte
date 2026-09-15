import type { IceServer } from '@ruimte/pulsar';

/*
 * How a daemon behind NAT is found: `BrokerRelay` (`src/pulsar/broker-relay.ts`) announces it to a
 * Pulsar broker, and `BrokerSwitch` (`src/pulsar/broker-switch.ts`) runs one for the broker the
 * machine is on, or none. The rest of the daemon never learns which it is.
 */
export interface Relay {
    /* Announces where this daemon listens; answers the public address, if the relay gives one. */
    publish(local: { host: string; port: number }): Promise<string | null>;
    stop(): Promise<void>;
    /* The ICE servers the relay handed out for a direct connection, TURN credentials included; none when it has none. */
    iceServers?(): IceServer[];
}

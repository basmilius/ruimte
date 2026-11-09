import { randomBytes } from 'node:crypto';
import { ClientSinks } from '../client-sinks.ts';
import type { ServerConfig } from '../config.ts';
import { connectLoopback } from '../ports/port-connect.ts';
import { PortGrants, portsStore } from '../ports/port-grants.ts';
import { PortStreams } from '../ports/port-streams.ts';

/* The development ports a person shared, and the streams through them. */
export interface PortsBundle {
    grants: PortGrants;
    streams: PortStreams;
    /* What every client hears: the list of shared ports moved. */
    sinks: ClientSinks;
}

export function wirePorts(config: ServerConfig, deniedPorts: () => readonly number[]): PortsBundle {
    const sinks = new ClientSinks();
    const grants = new PortGrants({
        store: portsStore(config.home),
        deniedPorts,
        random: (bytes) => randomBytes(bytes).toString('base64url'),
        now: Date.now,
        changed: () => sinks.emit({ event: 'port.changed', payload: {} })
    });
    const streams = new PortStreams({
        grants,
        connect: connectLoopback,
        timers: {
            after: (ms, fire) => {
                const timer = setTimeout(fire, ms);

                return () => clearTimeout(timer);
            }
        }
    });

    return { grants, streams, sinks };
}

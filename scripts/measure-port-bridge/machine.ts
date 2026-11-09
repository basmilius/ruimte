import { Dispatcher } from '../../apps/server/src/dispatcher.ts';
import { portsArea } from '../../apps/server/src/handlers/ports.ts';
import { connectLoopback } from '../../apps/server/src/ports/port-connect.ts';
import { PortGrants, portsStore } from '../../apps/server/src/ports/port-grants.ts';
import { PortStreams } from '../../apps/server/src/ports/port-streams.ts';
import type { ClientConnection } from '../../apps/server/src/wire.ts';

/*
 * The machine side of the port bridge measurement: the real dispatcher, grants and streams behind a WebSocket
 * on loopback, with half of `--rtt` added in each direction. It is a stand-in for the daemon, not for a network.
 *
 *   bun scripts/measure-port-bridge/machine.ts --rtt 100
 */
const rtt = Number(process.argv[process.argv.indexOf('--rtt') + 1] ?? 0) || 0;

let counter = 0;
const grants = new PortGrants({
    store: portsStore(undefined),
    deniedPorts: () => [],
    random: () => `grant-${++counter}`,
    now: Date.now,
    changed: () => undefined
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
const dispatcher = new Dispatcher();

portsArea({ grants, streams, changes: { subscribe: () => () => undefined } }).handlers?.(dispatcher);

function later(work: () => void): void {
    if (rtt === 0) {
        work();
    } else {
        setTimeout(work, rtt / 2);
    }
}

type Socket = Bun.ServerWebSocket<{ client: ClientConnection }>;

let nextClient = 1;
const server = Bun.serve<{ client: ClientConnection }>({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, server) {
        return server.upgrade(request, { data: { client: null as unknown as ClientConnection } }) ? undefined : new Response('upgrade', { status: 426 });
    },
    websocket: {
        open(ws: Socket) {
            const drains = new Set<() => void>();
            const client: ClientConnection = {
                id: `client-${nextClient++}`,
                access: { reachability: 'loopback', sessionId: null },
                send: (frame) => later(() => ws.send(JSON.stringify(frame))),
                bufferedAmount: () => ws.getBufferedAmount(),
                onDrain: (listener) => {
                    drains.add(listener);

                    return () => drains.delete(listener);
                }
            };

            ws.data.client = client;
            (ws as unknown as { drains: Set<() => void> }).drains = drains;
        },
        message(ws: Socket, message) {
            later(() => void dispatcher.handle(ws.data.client, message));
        },
        drain(ws: Socket) {
            for (const listener of (ws as unknown as { drains: Set<() => void> }).drains) {
                listener();
            }
        },
        close(ws: Socket) {
            streams.channelClosed(ws.data.client.id);
        }
    }
});

console.log(`READY ${server.port}`);

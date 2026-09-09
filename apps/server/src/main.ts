import type { ServerWebSocket } from 'bun';
import type { ServerFrame } from '@ruimte/contracts';
import pkg from '../package.json' with { type: 'json' };
import { parseServerArgs } from './config.ts';
import { Dispatcher, sendEvent, type ClientConnection } from './dispatcher.ts';
import { registerServerHandlers } from './handlers/server.ts';
import { registerSessionHandlers } from './handlers/session.ts';
import { BunPtyAdapter } from './pty/bun-pty.ts';
import { SessionManager } from './sessions/manager.ts';
import { SnapshotStore, scheduleSnapshots } from './sessions/snapshot-store.ts';

const config = parseServerArgs(process.argv.slice(2));
const version = pkg.version;

const snapshots = new SnapshotStore(config.home);
const manager = new SessionManager({ adapter: new BunPtyAdapter(), snapshots });
const snapshotSchedule = scheduleSnapshots(manager, snapshots);

const dispatcher = new Dispatcher();
registerServerHandlers(dispatcher, { version, home: config.home });
registerSessionHandlers(dispatcher, manager);

interface ConnectionState {
    client: ClientConnection;
    unsubscribe(): void;
}

const connections = new Map<ServerWebSocket<undefined>, ConnectionState>();
let nextClientId = 1;

const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch(request, server) {
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            if (request.method !== 'GET') {
                return new Response('Method not allowed', { status: 405 });
            }
            return Response.json({ ok: true, version });
        }

        if (url.pathname === '/ws') {
            if (server.upgrade(request)) {
                return undefined;
            }
            return new Response('Expected a WebSocket upgrade', { status: 426 });
        }

        return new Response('Not found', { status: 404 });
    },
    websocket: {
        open(ws) {
            const client: ClientConnection = {
                id: `client-${nextClientId++}`,
                send(frame: ServerFrame) {
                    ws.send(JSON.stringify(frame));
                }
            };
            const unsubscribe = manager.subscribe(client.id, ({ event, payload }) => sendEvent(client, event, payload));
            connections.set(ws, { client, unsubscribe });
        },
        message(ws, message) {
            const state = connections.get(ws);
            if (!state) {
                return;
            }
            void dispatcher.handle(state.client, message);
        },
        close(ws) {
            const state = connections.get(ws);
            if (!state) {
                return;
            }
            connections.delete(ws);
            // The sessions keep running; only this client's view of them goes.
            manager.detachAll(state.client.id);
            state.unsubscribe();
        }
    }
});

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    console.log(`ruimte server received ${signal}, writing snapshots`);
    snapshotSchedule.stop();
    try {
        await snapshotSchedule.flush();
    } catch (e) {
        console.error('Snapshot on shutdown failed', e);
    }
    manager.killAll();
    server.stop(true);
    process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

console.log(`ruimte server ${version} listening on ws://${server.hostname}:${server.port}/ws (home: ${config.home})`);

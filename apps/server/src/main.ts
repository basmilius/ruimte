import type { ServerWebSocket } from 'bun';
import type { ServerFrame } from '@ruimte/contracts';
import pkg from '../package.json' with { type: 'json' };
import { parseServerArgs } from './config.ts';
import { Dispatcher, type ClientConnection } from './dispatcher.ts';
import { registerServerHandlers } from './handlers/server.ts';
import { registerSessionHandlers } from './handlers/session.ts';

const config = parseServerArgs(process.argv.slice(2));
const version = pkg.version;

const dispatcher = new Dispatcher();
registerServerHandlers(dispatcher, { version, home: config.home });
registerSessionHandlers(dispatcher);

const connections = new Map<ServerWebSocket<undefined>, ClientConnection>();

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
            connections.set(ws, {
                send(frame: ServerFrame) {
                    ws.send(JSON.stringify(frame));
                }
            });
        },
        message(ws, message) {
            const client = connections.get(ws);
            if (!client) {
                return;
            }
            void dispatcher.handle(client, message);
        },
        close(ws) {
            connections.delete(ws);
        }
    }
});

console.log(`ruimte server ${version} listening on ws://${server.hostname}:${server.port}/ws (home: ${config.home})`);

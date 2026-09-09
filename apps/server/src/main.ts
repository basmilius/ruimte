import type { ServerWebSocket } from 'bun';
import type { ServerFrame } from '@ruimte/contracts';
import pkg from '../package.json' with { type: 'json' };
import { AgentStore } from './agents/agent-store.ts';
import { HOOKS_PATH, handleHookRequest } from './agents/hook-receiver.ts';
import { defaultHookPaths, installHooks } from './agents/install.ts';
import { ChatManager } from './chat/chat-manager.ts';
import { ChatStore } from './chat/chat-store.ts';
import { parseServerArgs } from './config.ts';
import { Dispatcher, sendEvent, type ClientConnection } from './dispatcher.ts';
import { registerChatHandlers } from './handlers/chat.ts';
import { registerFsHandlers } from './handlers/fs.ts';
import { registerProjectHandlers } from './handlers/project.ts';
import { registerServerHandlers } from './handlers/server.ts';
import { registerSessionHandlers } from './handlers/session.ts';
import { ProjectStore } from './projects/project-store.ts';
import { ProviderRegistry } from './providers/registry.ts';
import { BunPtyAdapter } from './pty/bun-pty.ts';
import { SessionManager } from './sessions/manager.ts';
import { SnapshotStore, scheduleSnapshots } from './sessions/snapshot-store.ts';

const config = parseServerArgs(process.argv.slice(2));
const version = pkg.version;

const snapshots = new SnapshotStore(config.home);
const manager = new SessionManager({ adapter: new BunPtyAdapter(), snapshots, agents: new AgentStore(config.home) });
const snapshotSchedule = scheduleSnapshots(manager, snapshots);
const providers = new ProviderRegistry();
const chats = new ChatManager({ providers, store: new ChatStore(config.home) });
const projects = new ProjectStore(config.home);

const dispatcher = new Dispatcher();
registerServerHandlers(dispatcher, { version, home: config.home });
registerSessionHandlers(dispatcher, manager);
registerChatHandlers(dispatcher, chats, providers);
registerProjectHandlers(dispatcher, projects);
registerFsHandlers(dispatcher);

if (config.installHooks) {
    for (const [kind, path] of Object.entries(defaultHookPaths())) {
        installHooks(path, kind as 'claude' | 'codex')
            .then((result) => {
                if (result === 'written') {
                    console.log(`Installed ${kind} status hooks in ${path}${kind === 'codex' ? ' (trust them once with /hooks in Codex)' : ''}`);
                }
            })
            .catch((e) => console.error(`Could not install ${kind} hooks`, e));
    }
}

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

        if (url.pathname.startsWith(`${HOOKS_PATH}/`)) {
            return handleHookRequest(request, url.pathname, manager);
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
            const sink = ({ event, payload }: Parameters<Parameters<typeof manager.subscribe>[1]>[0]): void => sendEvent(client, event, payload);
            const unsubscribeSessions = manager.subscribe(client.id, sink);
            const unsubscribeChats = chats.subscribe(client.id, sink);
            const unsubscribeProjects = projects.subscribe(client.id, sink);
            connections.set(ws, {
                client,
                unsubscribe() {
                    unsubscribeSessions();
                    unsubscribeChats();
                    unsubscribeProjects();
                }
            });
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
            chats.detachAll(state.client.id);
            state.unsubscribe();
        }
    }
});

// Hooks always POST to loopback, whatever interface the socket listens on.
manager.hookUrl = `http://127.0.0.1:${server.port}${HOOKS_PATH}`;

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
        await chats.shutdown();
    } catch (e) {
        console.error('Snapshot on shutdown failed', e);
    }
    manager.killAll();
    projects.closeAll();
    server.stop(true);
    process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

console.log(`ruimte server ${version} listening on ws://${server.hostname}:${server.port}/ws (home: ${config.home})`);

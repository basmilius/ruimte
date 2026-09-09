import { join, normalize, resolve } from 'node:path';
import type { ServerWebSocket } from 'bun';
import type { ServerFrame } from '@ruimte/contracts';
import pkg from '../package.json' with { type: 'json' };
import { hostname } from 'node:os';
import { AgentStore } from './agents/agent-store.ts';
import { decideAccess, isLoopbackAddress, reachabilityOf } from './auth/access.ts';
import { AuthStore } from './auth/auth-store.ts';
import { NoRelay, type Relay } from './auth/relay.ts';
import { HOOKS_PATH, handleHookRequest } from './agents/hook-receiver.ts';
import { defaultHookPaths, installHooks } from './agents/install.ts';
import { ChatManager } from './chat/chat-manager.ts';
import { CONTEXT_PATH, ContextStore } from './context/context-store.ts';
import { ChatStore } from './chat/chat-store.ts';
import { parseServerArgs } from './config.ts';
import { Dispatcher, sendEvent, type ClientAccess, type ClientConnection } from './dispatcher.ts';
import { PairPayloadSchema } from '@ruimte/contracts';
import { registerAuthHandlers } from './handlers/auth.ts';
import { registerChatHandlers } from './handlers/chat.ts';
import { registerFsHandlers } from './handlers/fs.ts';
import { registerGitHandlers } from './handlers/git.ts';
import { registerProjectHandlers } from './handlers/project.ts';
import { registerServerHandlers } from './handlers/server.ts';
import { registerSessionHandlers } from './handlers/session.ts';
import { Worktrees } from './git/worktrees.ts';
import { ProjectStore } from './projects/project-store.ts';
import { ProviderRegistry } from './providers/registry.ts';
import { BunPtyAdapter } from './pty/bun-pty.ts';
import { SessionManager } from './sessions/manager.ts';
import { SnapshotStore, scheduleSnapshots } from './sessions/snapshot-store.ts';

const config = parseServerArgs(process.argv.slice(2));
const version = pkg.version;

const pairingUrl = (host: string, port: number, token: string): string => {
    // A daemon bound to every interface is reached by the machine's name; the token rides in the fragment, which never hits a log.
    const reachableHost = host === '0.0.0.0' || host === '::' ? hostname() : host;
    return `http://${reachableHost}:${port}/pair#${token}`;
};

if (config.command === 'pair') {
    // Asks the daemon already running on this machine for a fresh pairing URL; tokens never travel as arguments.
    const response = await fetch(`http://127.0.0.1:${config.port}/auth/pairing-token`, { method: 'POST' }).catch(() => null);
    if (!response || !response.ok) {
        console.error(`No daemon answers on port ${config.port}; start one first.`);
        process.exit(1);
    }
    const { url } = (await response.json()) as { url: string };
    console.log(`Open this in the Ruimte app on the other machine within ten minutes:\n${url}`);
    process.exit(0);
}

// `ruimte-context` lives next to the daemon's source; it goes on the PATH of every shell and chat.
const binDir = resolve(import.meta.dir, '..', 'bin');
const contextUrl = `http://127.0.0.1:${config.port}${CONTEXT_PATH}`;

const auth = new AuthStore(config.home);
const relay: Relay = new NoRelay();
const access = { allowedOrigins: config.allowedOrigins, requireToken: config.requireToken };

const snapshots = new SnapshotStore(config.home);
const manager = new SessionManager({ adapter: new BunPtyAdapter(), snapshots, agents: new AgentStore(config.home), contextUrl, binDir });
const snapshotSchedule = scheduleSnapshots(manager, snapshots);
const providers = new ProviderRegistry();
const context: ContextStore = new ContextStore({
    terminalText: (sessionId) => manager.get(sessionId)?.plainText() ?? Promise.resolve(null),
    chatItems: (chatId) => chats.get(chatId)?.thread.list() ?? null,
    targetForToken: (token) => manager.sessionIdForToken(token) ?? chats.chatIdForToken(token)
});
const chats: ChatManager = new ChatManager({ providers, store: new ChatStore(config.home), contextUrl, binDir, hasContext: (chatId) => context.has(chatId) });
const projects = new ProjectStore(config.home);

const dispatcher = new Dispatcher();
registerServerHandlers(dispatcher, { version, home: config.home });
registerSessionHandlers(dispatcher, manager);
registerChatHandlers(dispatcher, chats, providers, context);
registerProjectHandlers(dispatcher, projects);
registerAuthHandlers(dispatcher, auth, { label: config.label, version });
registerFsHandlers(dispatcher);
registerGitHandlers(dispatcher, new Worktrees(config.home));

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

const connections = new Map<ServerWebSocket<ClientAccess>, ConnectionState>();
let nextClientId = 1;

const endpointInfo = (reachability: ClientAccess['reachability'], authenticated: boolean) => ({
    label: config.label,
    platform: process.platform,
    version,
    reachability,
    authenticated
});

const server = Bun.serve<ClientAccess>({
    hostname: config.host,
    port: config.port,
    async fetch(request, server) {
        const url = new URL(request.url);
        const remote = server.requestIP(request)?.address ?? '';

        if (url.pathname === '/health') {
            if (request.method !== 'GET') {
                return new Response('Method not allowed', { status: 405 });
            }
            return Response.json({ ok: true, version });
        }

        if (url.pathname === '/auth/pairing-token') {
            // Only something on this machine may mint a pairing URL; that is what `ruimte pair` is.
            if (request.method !== 'POST' || !isLoopbackAddress(remote)) {
                return new Response('Forbidden', { status: 403 });
            }
            return Response.json({ url: pairingUrl(config.host, server.port ?? config.port, auth.issuePairingToken()) });
        }

        if (url.pathname === '/auth/pair') {
            // A client on another origin pairs from its own page, so this one route answers preflights and opens CORS.
            const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' };
            if (request.method === 'OPTIONS') {
                return new Response(null, { status: 204, headers: cors });
            }
            if (request.method !== 'POST') {
                return new Response('Method not allowed', { status: 405, headers: cors });
            }
            const parsed = PairPayloadSchema.safeParse(await request.json().catch(() => null));
            if (!parsed.success) {
                return new Response('Bad pairing request', { status: 400, headers: cors });
            }
            const paired = await auth.pair(parsed.data.token, parsed.data.label);
            if (!paired) {
                return new Response('That pairing link is used up or stale; ask for a new one', { status: 401, headers: cors });
            }
            return Response.json({ sessionToken: paired.sessionToken, endpoint: endpointInfo(reachabilityOf(remote), true) }, { headers: cors });
        }

        if (url.pathname === '/ws') {
            const decision = await decideAccess(request, remote, auth, access);
            if (!decision.ok) {
                return new Response(decision.reason, { status: decision.status });
            }
            if (server.upgrade(request, { data: decision.access })) {
                return undefined;
            }
            return new Response('Expected a WebSocket upgrade', { status: 426 });
        }

        if (url.pathname.startsWith(`${HOOKS_PATH}/`)) {
            return handleHookRequest(request, url.pathname, manager);
        }

        if (url.pathname === CONTEXT_PATH || url.pathname.startsWith(`${CONTEXT_PATH}/`)) {
            return context.handle(request, url.pathname);
        }

        if (config.serve) {
            return serveClient(config.serve, url.pathname);
        }

        return new Response('Not found', { status: 404 });
    },
    websocket: {
        open(ws) {
            const client: ClientConnection = {
                id: `client-${nextClientId++}`,
                access: ws.data,
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

// Hooks and context always go over loopback, whatever interface the socket listens on.
manager.hookUrl = `http://127.0.0.1:${server.port}${HOOKS_PATH}`;
manager.contextUrl = `http://127.0.0.1:${server.port}${CONTEXT_PATH}`;

/* The built client from one directory; anything that is not a file falls back to the app shell. */
const serveClient = async (dir: string, pathname: string): Promise<Response> => {
    const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = Bun.file(join(dir, relative === '/' ? 'index.html' : relative));
    if (await file.exists()) {
        return new Response(file);
    }
    return new Response(Bun.file(join(dir, 'index.html')));
};

void relay.publish({ host: config.host, port: server.port ?? config.port });

if (!isLoopbackAddress(config.host) && config.host !== 'localhost') {
    console.log(
        `Pair another machine with:\n${pairingUrl(config.host, server.port ?? config.port, auth.issuePairingToken())}\n(or run \`bun src/main.ts pair\` later for a fresh one)`
    );
}

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
    await relay.stop();
    server.stop(true);
    process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

console.log(`ruimte server ${version} listening on ws://${server.hostname}:${server.port}/ws (home: ${config.home})`);

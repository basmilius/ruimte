import { dirname, join, normalize, resolve } from 'node:path';
import type { ServerWebSocket } from 'bun';
import { PairPayloadSchema, type AgentKind, type ServerFrame } from '@ruimte/contracts';
import { AgentStore } from './agents/agent-store.ts';
import { OutputGate } from './backpressure.ts';
import { decideAccess, isLoopbackAddress, reachabilityOf } from './auth/access.ts';
import { pairingUrl } from './cli/pairing.ts';
import { AuthStore } from './auth/auth-store.ts';
import { NoRelay, type Relay } from './auth/relay.ts';
import { HOOKS_PATH, handleHookRequest } from './agents/hook-receiver.ts';
import { defaultHookPaths, installHooks } from './agents/install.ts';
import { ATTACHMENTS_PATH, handleAttachmentRequest } from './chat/attachment-route.ts';
import { AttachmentStore } from './chat/attachment-store.ts';
import { ChatManager } from './chat/chat-manager.ts';
import { contextHint } from './context/context-note.ts';
import { CONTEXT_PATH, ContextStore } from './context/context-store.ts';
import { ChatStore } from './chat/chat-store.ts';
import type { ServerConfig } from './config.ts';
import { Dispatcher, sendEvent, type ClientAccess, type ClientConnection } from './dispatcher.ts';
import { VERSION } from './version.ts';
import { registerAuthHandlers } from './handlers/auth.ts';
import { registerChatHandlers } from './handlers/chat.ts';
import { FS_FILE_PATH, handleFsFileRequest } from './fs/file-route.ts';
import { FolderWatcher } from './fs/watch.ts';
import { registerFsHandlers } from './handlers/fs.ts';
import { registerGitHandlers } from './handlers/git.ts';
import { registerProjectHandlers } from './handlers/project.ts';
import { registerServerHandlers } from './handlers/server.ts';
import { registerSessionHandlers } from './handlers/session.ts';
import { Checkpoints } from './git/checkpoints.ts';
import { Worktrees } from './git/worktrees.ts';
import { handleProjectRequest, PROJECTS_PATH } from './projects/icon-route.ts';
import { ProjectStore } from './projects/project-store.ts';
import { ProviderRegistry } from './providers/registry.ts';
import { BunPtyAdapter } from './pty/bun-pty.ts';
import { SessionManager } from './sessions/manager.ts';
import { SnapshotStore, scheduleSnapshots } from './sessions/snapshot-store.ts';

// Inside a `bun build --compile` binary the sources live on a virtual file system, so paths next to the source mean nothing.
const compiled = import.meta.dir.startsWith('/$bunfs') || import.meta.dir.includes('~BUN');

/* Runs the daemon until a signal ends the process. */
export const startDaemon = async (config: ServerConfig): Promise<void> => {
    // `ruimte-context` lives next to the binary, or next to the source in dev; it goes on the PATH of every shell and chat.
    const binDir = compiled ? dirname(process.execPath) : resolve(import.meta.dir, '..', 'bin');
    const contextUrl = `http://127.0.0.1:${config.port}${CONTEXT_PATH}`;

    const auth = new AuthStore(config.home);
    const relay: Relay = new NoRelay();
    const access = { allowedOrigins: config.allowedOrigins, requireToken: config.requireToken };

    const snapshots = new SnapshotStore(config.home);
    const manager = new SessionManager({
        adapter: new BunPtyAdapter(),
        snapshots,
        agents: new AgentStore(config.home),
        contextUrl,
        binDir,
        contextFor: (sessionId) => context.list(sessionId)
    });
    const snapshotSchedule = scheduleSnapshots(manager, snapshots);
    const providers = new ProviderRegistry();
    const context: ContextStore = new ContextStore({
        terminalText: (sessionId) => manager.get(sessionId)?.plainText() ?? Promise.resolve(null),
        chatItems: (chatId) => chats.get(chatId)?.thread.list() ?? null,
        targetForToken: (token) => manager.sessionIdForToken(token) ?? chats.chatIdForToken(token)
    });
    const attachments = new AttachmentStore(config.home);
    const chats: ChatManager = new ChatManager({
        providers,
        store: new ChatStore(config.home, attachments),
        attachments,
        checkpoints: new Checkpoints(config.home),
        contextUrl,
        binDir,
        hasContext: (chatId) => context.has(chatId),
        contextSources: (chatId) => context.list(chatId)
    });
    const projects = new ProjectStore(config.home);
    const folders = new FolderWatcher();

    const dispatcher = new Dispatcher();
    registerServerHandlers(dispatcher, { version: VERSION, home: config.home });
    registerSessionHandlers(dispatcher, manager);
    registerChatHandlers(dispatcher, chats, providers, context);
    registerProjectHandlers(dispatcher, projects);
    registerAuthHandlers(dispatcher, auth, {
        label: config.label,
        version: VERSION,
        pairingUrl: () => pairingUrl(config.host, server.port ?? config.port, auth.issuePairingToken()),
        disconnect: (sessionId) => {
            for (const ws of connections.keys()) {
                if (ws.data.sessionId === sessionId) {
                    ws.close(4001, 'Access revoked');
                }
            }
        }
    });
    registerFsHandlers(dispatcher, folders);
    registerGitHandlers(dispatcher, new Worktrees(config.home));

    if (config.installHooks) {
        // Only the CLIs the daemon has a normalizer for are listed; the others run without status.
        for (const [kind, path] of Object.entries(defaultHookPaths())) {
            installHooks(path, kind as AgentKind)
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
        gate: OutputGate;
        unsubscribe(): void;
    }

    const connections = new Map<ServerWebSocket<ClientAccess>, ConnectionState>();
    let nextClientId = 1;

    const endpointInfo = (reachability: ClientAccess['reachability'], authenticated: boolean) => ({
        label: config.label,
        platform: process.platform,
        version: VERSION,
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
                return Response.json({ ok: true, version: VERSION });
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

            if (url.pathname.startsWith(`${ATTACHMENTS_PATH}/`)) {
                return handleAttachmentRequest(request, url, remote, auth, access, (chatId, id) => chats.attachment(chatId, id));
            }

            if (url.pathname.startsWith(`${PROJECTS_PATH}/`)) {
                return handleProjectRequest(request, url, remote, auth, access, projects);
            }

            if (url.pathname === FS_FILE_PATH) {
                return handleFsFileRequest(request, url, remote, auth, access);
            }

            if (url.pathname.startsWith(`${HOOKS_PATH}/`)) {
                return handleHookRequest(request, url.pathname, manager, (token) => {
                    const sessionId = manager.sessionIdForToken(token);
                    return sessionId ? contextHint(context.list(sessionId)) : null;
                });
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
                const clientId = `client-${nextClientId++}`;
                const gate = new OutputGate({
                    socket: ws,
                    screenOf: (sessionId) => {
                        const session = manager.get(sessionId);
                        // A session this client no longer watches needs no screen; its mark just goes.
                        return session?.isAttached(clientId) ? session.serializeScreen() : Promise.resolve(null);
                    }
                });
                const client: ClientConnection = {
                    id: clientId,
                    access: ws.data,
                    send(frame: ServerFrame) {
                        gate.send(frame);
                    }
                };
                const sink = ({ event, payload }: Parameters<Parameters<typeof manager.subscribe>[1]>[0]): void => sendEvent(client, event, payload);
                const unsubscribeSessions = manager.subscribe(client.id, sink);
                const unsubscribeChats = chats.subscribe(client.id, sink);
                const unsubscribeProjects = projects.subscribe(client.id, sink);
                const unsubscribeFolders = folders.subscribe(client.id, sink);
                connections.set(ws, {
                    client,
                    gate,
                    unsubscribe() {
                        unsubscribeSessions();
                        unsubscribeChats();
                        unsubscribeProjects();
                        unsubscribeFolders();
                    }
                });
            },
            drain(ws) {
                // The socket has room again: every session that lost output gets a fresh screen.
                connections.get(ws)?.gate.onDrain();
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
                folders.detachAll(state.client.id);
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
            `Pair another machine with:\n${pairingUrl(config.host, server.port ?? config.port, auth.issuePairingToken())}\n(or run \`ruimte pair\` later for a fresh one)`
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
        // Before anything is awaited: a `bun --watch` reload restarts the module during the first
        // await, so a turn in flight would otherwise never reach its file.
        chats.persistAllSync();
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

    console.log(`ruimte server ${VERSION} listening on ws://${server.hostname}:${server.port}/ws (home: ${config.home})`);
};

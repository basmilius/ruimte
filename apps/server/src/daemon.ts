import { dirname, join, normalize, resolve } from 'node:path';
import type { ServerWebSocket } from 'bun';
import { AuthTicketPayloadSchema, PairPayloadSchema, type AgentKind, type DiagramContent } from '@ruimte/contracts';
import { AgentStore } from './agents/agent-store.ts';
import { ClaudeTitleReader } from './agents/claude-title.ts';
import { CodexTitleReader } from './agents/codex-title.ts';
import { AgentLineageStore } from './agents/lineage.ts';
import { PendingPromptStore } from './agents/pending-prompts.ts';
import { connectionOpener, socketChannel, type ClientChannel, type OpenConnection, type SocketChannel } from './connection.ts';
import { authenticateChannel } from './pulsar/channel-auth.ts';
import { AUTHENTICATED_FRAME_CHARS } from './pulsar/data-channel.ts';
import { DirectPeers } from './pulsar/peers.ts';
import { registerDirectHandlers } from './handlers/direct.ts';
import { suggestChatTitle } from './chat/chat-title.ts';
import { decideAccess, isLoopbackAddress, mayInvite, reachabilityOf } from './auth/access.ts';
import { readOrCreateLocalSecret } from './auth/local-secret.ts';
import { pairingUrl } from './cli/pairing.ts';
import { AuthStore } from './auth/auth-store.ts';
import { Handshake } from './auth/handshake.ts';
import { NoRelay, type Relay } from './auth/relay.ts';
import { HOOKS_PATH, handleHookRequest } from './agents/hook-receiver.ts';
import { HOOK_EVENTS } from './agents/hooks.ts';
import { defaultHookPaths, installHooks } from './agents/install.ts';
import { ATTACHMENTS_PATH, handleAttachmentRequest } from './chat/attachment-route.ts';
import { AttachmentStore } from './chat/attachment-store.ts';
import { CANVAS_PATH, handleCanvasRequest } from './canvas/canvas-route.ts';
import { ChatManager } from './chat/chat-manager.ts';
import { hookContext } from './context/context-note.ts';
import { CONTEXT_PATH, ContextStore } from './context/context-store.ts';
import { deliverNotice, NoticeStore, renderNotice, type Notice } from './context/notices.ts';
import { ChatStore } from './chat/chat-store.ts';
import type { ServerConfig } from './config.ts';
import { Dispatcher, type ClientAccess } from './dispatcher.ts';
import { readOrCreateEndpointIdentity } from './endpoint-id.ts';
import { VERSION } from './version.ts';
import { registerAuthHandlers } from './handlers/auth.ts';
import { registerChatHandlers } from './handlers/chat.ts';
import { FS_FILE_PATH, handleFsFileRequest } from './fs/file-route.ts';
import { FolderWatcher } from './fs/watch.ts';
import { registerBytesHandlers } from './handlers/bytes.ts';
import { registerFsHandlers } from './handlers/fs.ts';
import { readMedia } from './fs/read.ts';
import { registerGitHandlers } from './handlers/git.ts';
import { registerDiagramHandlers } from './handlers/diagram.ts';
import { registerDrawingHandlers } from './handlers/drawing.ts';
import { registerProjectHandlers } from './handlers/project.ts';
import { registerServerHandlers } from './handlers/server.ts';
import { readMachineModel } from './machine-model.ts';
import { registerSessionHandlers } from './handlers/session.ts';
import { registerProcessHandlers } from './handlers/processes.ts';
import { registerUsageHandlers } from './handlers/usage.ts';
import { Checkpoints } from './git/checkpoints.ts';
import { GitStatusWatcher } from './git/status-watcher.ts';
import { Worktrees } from './git/worktrees.ts';
import { ProcessMonitor } from './processes/monitor.ts';
import { createSampler } from './processes/sampler.ts';
import { handleProjectRequest, PROJECTS_PATH } from './projects/icon-route.ts';
import { DiagramStore } from './projects/diagram-store.ts';
import { DrawingStore } from './projects/drawing-store.ts';
import { ProjectStore } from './projects/project-store.ts';
import { ProviderRegistry } from './providers/registry.ts';
import { BunPtyAdapter } from './pty/bun-pty.ts';
import { SessionManager } from './sessions/manager.ts';
import { SnapshotStore, scheduleSnapshots } from './sessions/snapshot-store.ts';
import { UsageMonitor } from './usage/limits/monitor.ts';
import { UsageService } from './usage/usage-service.ts';

// A client on another origin pairs and signs in from its own page, so the auth routes answer preflights and open CORS.
const AUTH_CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' };

// Inside a `bun build --compile` binary the sources live on a virtual file system, so paths next to the source mean nothing.
const compiled = import.meta.dir.startsWith('/$bunfs') || import.meta.dir.includes('~BUN');

/*
 * The policy the served client runs under, the twin of the `<meta http-equiv>` in
 * `apps/client/index.html` (which is what covers the Vite dev server). Without it an Electron
 * window has no policy at all, so `eval` and an inline script are free. `connect-src`, `img-src`
 * and `media-src` are wide because a paired endpoint is any host the person adds and its socket,
 * images, attachments and file bytes all come from there.
 */
const CLIENT_CSP =
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: http: https:; media-src 'self' data: blob: http: https:; font-src 'self' data:; connect-src 'self' ws: wss: http: https:; worker-src 'self' blob:";

/* Runs the daemon until a signal ends the process. */
export const startDaemon = async (config: ServerConfig): Promise<void> => {
    // `ruimte-context` lives next to the binary, or next to the source in dev; it goes on the PATH of every shell and chat.
    const binDir = compiled ? dirname(process.execPath) : resolve(import.meta.dir, '..', 'bin');
    const contextUrl = `http://127.0.0.1:${config.port}${CONTEXT_PATH}`;

    // `--label` and `RUIMTE_LABEL` are the name a machine nobody has named yet answers to; a name
    // typed in a client wins over both, or renaming from another machine would not survive a restart.
    const identity = await readOrCreateEndpointIdentity(config.home, config.label);
    const auth = new AuthStore(config.home);
    const handshake = new Handshake(auth, identity);
    const relay: Relay = new NoRelay();
    const access = { allowedOrigins: config.allowedOrigins, localSecret: await readOrCreateLocalSecret(config.home), tickets: handshake };

    const snapshots = new SnapshotStore(config.home);
    // Loaded before anything can take one: a node made just before a restart still starts on its prompt.
    const prompts = new PendingPromptStore(config.home);
    await prompts.load();
    // The same for the chain of agents that opened agents: a restart must not start the count over.
    const lineage = new AgentLineageStore(config.home);
    await lineage.load();
    // And for the messages one node left for another: they outlive the CLI they are waiting for.
    const notices = new NoticeStore(config.home);
    await notices.load();
    /* What a node hears the moment it can: taken here, so whichever channel gets there first is the
       only one that delivers it. */
    const messagesFor = (targetId: string): string[] => notices.take(targetId).map(renderNotice);
    // One reader for chats and terminals, so a transcript both look at is only read on from where either stopped.
    const claudeTitles = new ClaudeTitleReader();
    const manager = new SessionManager({
        adapter: new BunPtyAdapter(),
        snapshots,
        agents: new AgentStore(config.home),
        contextUrl,
        binDir,
        contextFor: (sessionId) => context.list(sessionId),
        firstPrompt: (sessionId) => prompts.take(sessionId),
        firstNotices: messagesFor,
        approvals: config.approvals,
        claudeTitles,
        codexTitles: new CodexTitleReader()
    });
    const snapshotSchedule = scheduleSnapshots(manager, snapshots);
    const providers = new ProviderRegistry();
    // A bearer token speaks for a terminal session or a chat, for reading context and for canvas verbs alike.
    const targetForToken = (token: string): string | null => manager.sessionIdForToken(token) ?? chats.chatIdForToken(token);
    const context: ContextStore = new ContextStore({
        sources: (targetId) => projects.index.sourcesFor(targetId),
        terminalText: (sessionId) => manager.get(sessionId)?.plainText() ?? Promise.resolve(null),
        chatItems: (chatId) => chats.get(chatId)?.thread.list() ?? null,
        drawingElements: (viewId) => drawings.elementsOf(viewId),
        diagramDocument: async (targetId, viewId) => {
            const place = projects.index.locate(targetId);
            return place ? diagrams.read(place.projectId, viewId) : null;
        },
        targetForToken
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
        contextSources: (chatId) => context.list(chatId),
        messages: messagesFor,
        firstPrompt: (chatId) => prompts.take(chatId),
        // A turn reports what is left of its plan in passing; that belongs to the machine's numbers.
        onLimits: (update) => limits.applyLive(update),
        claudeTitles,
        // One one-shot call per Codex chat, on whichever CLI here answers a single prompt.
        nameChat: (provider, input) => suggestChatTitle(providers, provider, input)
    });
    const projects = new ProjectStore(config.home);
    // A node deleted before anyone ran it takes its prompt with it, and a node that is gone frees the count its opener is held to.
    projects.index.onPlaces = (projectId, ids) => {
        void prompts.prune(projectId, ids).catch((e) => console.error('Pruning pending prompts failed', e));
        void lineage.prune(projectId, ids).catch((e) => console.error('Pruning agent lineage failed', e));
        void notices.prune(projectId, ids).catch((e) => console.error('Pruning waiting messages failed', e));
    };
    const drawings = new DrawingStore(projects);
    projects.attachDrawings(drawings);
    const diagrams = new DiagramStore(projects);
    projects.attachDiagrams(diagrams);
    // Before the socket answers, so an agent whose project nobody opened since the restart still reads its links.
    await projects.warmIndex();
    const folders = new FolderWatcher();
    const statuses = new GitStatusWatcher();
    const usage = new UsageService({ home: config.home, allowPriceFetch: config.priceFetch, knownProjects: () => projects.known() });
    const limits = new UsageMonitor({ providers });
    const processes = new ProcessMonitor({
        sampler: await createSampler(process.platform, config.home),
        sessions: () => manager.list().map((session) => ({ id: session.sessionId, pid: session.pid, exited: session.exited, agent: session.agent ?? null })),
        chats: () => chats.processTargets(),
        contextUrl: () => manager.contextUrl,
        // Without a SessionEnd a clean exit and a crash look the same, so only these CLIs can be missed.
        reportsEnd: (kind) => HOOK_EVENTS[kind]?.includes('SessionEnd') === true
    });
    manager.onProcessChange = (_sessionId, phase) => (phase === 'before-kill' ? processes.beforeKill() : processes.nudge());
    manager.isAgentGone = (sessionId) => processes.isAgentGone(sessionId);

    const worktrees = new Worktrees(config.home);
    const canvasHost = {
        locate: (id: string) => projects.index.locate(id),
        read: (projectId: string) => projects.read(projectId),
        mutate: projects.mutate.bind(projects),
        worktreePaths: (folder: string) =>
            worktrees
                .list(folder)
                .then((list) => list.map((worktree) => worktree.path))
                .catch(() => []),
        installedAgents: async () => (await providers.list()).filter((provider) => provider.installed).map((provider) => provider.kind),
        holdPrompt: (projectId: string, nodeId: string, prompt: string) => prompts.put(projectId, nodeId, prompt),
        depthOf: (nodeId: string) => lineage.depthOf(nodeId),
        openedCount: (callerId: string) => lineage.openedCount(callerId),
        recordMade: (record: { projectId: string; nodeId: string; openedBy: string; depth: number; agent: boolean }) => lineage.put(record),
        madeBy: (nodeId: string) => lineage.madeBy(nodeId),
        agentsDeleteAnyView: () => identity.agentsDeleteAnyView,
        showView: (projectId: string, viewId: string, by: string) => projects.showView(projectId, viewId, by),
        writeDiagram: (projectId: string, viewId: string, content: DiagramContent) => diagrams.write(projectId, viewId, content),
        /* A node that has never been shown has no session, and a canvas going down is not the place
           to fail over one, so an id neither manager knows is already ended as far as the verb goes. */
        endSession: async (kind: 'terminal' | 'chat', nodeId: string) => {
            await (kind === 'terminal' ? manager.kill(nodeId) : chats.kill(nodeId)).catch(() => undefined);
        },
        notify: (notice: Omit<Notice, 'createdAt'>) =>
            deliverNotice(
                notices,
                {
                    /* An exited session still lists its last screen, but nobody is reading it; its
                   message waits for the shell that takes the id over. */
                    terminal: (id) => {
                        const session = manager.get(id);
                        return session && !session.exited ? { agent: session.agent, notice: (text: string) => session.notice(text) } : null;
                    },
                    hasChat: (id) => chats.get(id) !== undefined
                },
                notice
            )
    };

    const dispatcher = new Dispatcher();
    registerServerHandlers(dispatcher, { version: VERSION, home: config.home, model: await readMachineModel() });
    registerSessionHandlers(dispatcher, manager);
    registerChatHandlers(dispatcher, chats, providers);
    registerProjectHandlers(dispatcher, projects);
    registerDrawingHandlers(dispatcher, drawings);
    registerDiagramHandlers(dispatcher, diagrams);
    registerAuthHandlers(dispatcher, auth, {
        identity,
        version: VERSION,
        pairingUrl: () => pairingUrl(config.host, server.port ?? config.port, auth.issuePairingToken()),
        disconnect: (sessionId) => {
            handshake.revoke(sessionId);
            for (const { channel, connection } of [...connections.values(), ...directConnections]) {
                if (connection.client.access?.sessionId === sessionId) {
                    channel.close(4001, 'Access revoked');
                }
            }
        }
    });
    registerFsHandlers(dispatcher, folders);
    registerBytesHandlers(dispatcher, {
        attachment: (chatId, id) => chats.attachment(chatId, id),
        projectIcon: (projectId, theme) => projects.iconFile(projectId, theme),
        media: readMedia
    });
    registerUsageHandlers(dispatcher, usage, limits);
    registerProcessHandlers(dispatcher, processes);
    registerGitHandlers(dispatcher, worktrees, statuses, providers);

    // A direct channel gets its access from its own handshake, never from the socket its signals came over.
    const peers = new DirectPeers({
        stunServers: config.stun,
        portRange: config.directPorts,
        hostAddresses: config.directHostAddresses,
        authenticate: (channel, binding, remoteAddress) =>
            authenticateChannel({
                channel,
                binding,
                handshake,
                daemonId: identity.id,
                localSecret: access.localSecret,
                reachability: reachabilityOf(remoteAddress ?? '')
            }),
        open: (channel, channelAccess) => {
            const state = { channel, connection: openConnection(channel, channelAccess) };
            directConnections.add(state);
            channel.receiveWith((frame) => state.connection.receive(frame), AUTHENTICATED_FRAME_CHARS);
            channel.onClose(() => directConnections.delete(state));
        }
    });
    registerDirectHandlers(dispatcher, peers);

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
        channel: SocketChannel;
        connection: OpenConnection;
    }

    const connections = new Map<ServerWebSocket<ClientAccess>, ConnectionState>();
    const directConnections = new Set<{ channel: ClientChannel; connection: OpenConnection }>();
    const openConnection = connectionOpener({
        dispatcher,
        sessions: manager,
        chats,
        identity,
        projects,
        drawings,
        diagrams,
        folders,
        statuses,
        usage,
        limits,
        processes
    });

    const endpointInfo = (reachability: ClientAccess['reachability'], authenticated: boolean) => ({
        id: identity.id,
        label: identity.label,
        nameSource: identity.nameSource,
        icon: identity.icon,
        agentsDeleteAnyView: identity.agentsDeleteAnyView,
        platform: process.platform,
        version: VERSION,
        reachability,
        authenticated,
        publicKey: identity.publicKey
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
                // `ruimte pair` sends the local secret as a bearer; the socket's `auth.pairingToken` asks the same `mayInvite`.
                if (request.method !== 'POST') {
                    return new Response('Method not allowed', { status: 405 });
                }
                const decision = await decideAccess(request, remote, auth, access);
                if (!decision.ok || !mayInvite(decision.access)) {
                    return new Response('Forbidden', { status: 403 });
                }
                return Response.json({ url: pairingUrl(config.host, server.port ?? config.port, auth.issuePairingToken()) });
            }

            if (url.pathname === '/auth/pair') {
                if (request.method === 'OPTIONS') {
                    return new Response(null, { status: 204, headers: AUTH_CORS });
                }
                if (request.method !== 'POST') {
                    return new Response('Method not allowed', { status: 405, headers: AUTH_CORS });
                }
                const parsed = PairPayloadSchema.safeParse(await request.json().catch(() => null));
                if (!parsed.success) {
                    return new Response('Bad pairing request', { status: 400, headers: AUTH_CORS });
                }
                const paired = await auth.pair(parsed.data.token, {
                    label: parsed.data.label,
                    ...(parsed.data.publicKey ? { publicKey: parsed.data.publicKey } : {})
                });
                if (!paired) {
                    return new Response('That pairing link is used or expired. Ask for a new one.', { status: 401, headers: AUTH_CORS });
                }
                return Response.json(
                    { ...(paired.sessionToken ? { sessionToken: paired.sessionToken } : {}), endpoint: endpointInfo(reachabilityOf(remote), true) },
                    { headers: AUTH_CORS }
                );
            }

            if (url.pathname === '/auth/challenge') {
                if (request.method === 'OPTIONS') {
                    return new Response(null, { status: 204, headers: AUTH_CORS });
                }
                if (request.method !== 'POST') {
                    return new Response('Method not allowed', { status: 405, headers: AUTH_CORS });
                }
                return Response.json(handshake.challenge(), { headers: AUTH_CORS });
            }

            if (url.pathname === '/auth/ticket') {
                if (request.method === 'OPTIONS') {
                    return new Response(null, { status: 204, headers: AUTH_CORS });
                }
                if (request.method !== 'POST') {
                    return new Response('Method not allowed', { status: 405, headers: AUTH_CORS });
                }
                const parsed = AuthTicketPayloadSchema.safeParse(await request.json().catch(() => null));
                if (!parsed.success) {
                    return new Response('Bad ticket request', { status: 400, headers: AUTH_CORS });
                }
                const ticket = await handshake.redeem(parsed.data);
                if (!ticket) {
                    return new Response('This machine does not recognize that signature. Pair again.', { status: 401, headers: AUTH_CORS });
                }
                return Response.json(ticket, { headers: AUTH_CORS });
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
                return handleHookRequest(
                    request,
                    url.pathname,
                    manager,
                    (token, event) => {
                        const sessionId = manager.sessionIdForToken(token);
                        if (!sessionId) {
                            return null;
                        }
                        // Asked on every event that can carry an answer, so the memory of what this
                        // agent was told keeps up with its turns even where nothing is printed.
                        const changed = context.changeSince(sessionId);
                        return hookContext(event, context.list(sessionId), { changed, messages: messagesFor(sessionId) });
                    },
                    (token, body, signal) => manager.holdApproval(token, body, signal)
                );
            }

            if (url.pathname.startsWith(`${CANVAS_PATH}/`)) {
                return handleCanvasRequest(request, url.pathname, { targetForToken, host: canvasHost });
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
                const channel = socketChannel(ws);
                connections.set(ws, { channel, connection: openConnection(channel, ws.data) });
            },
            drain(ws) {
                // The socket has room again: every session that lost output gets a fresh screen.
                connections.get(ws)?.channel.drained();
            },
            message(ws, message) {
                connections.get(ws)?.connection.receive(message);
            },
            close(ws) {
                const state = connections.get(ws);
                if (!state) {
                    return;
                }
                connections.delete(ws);
                state.channel.closed();
            }
        }
    });

    // The first read runs now, so a page opened straight after a start already has the plan on it.
    limits.start();
    processes.start();

    // Hooks and context always go over loopback, whatever interface the socket listens on.
    manager.hookUrl = `http://127.0.0.1:${server.port}${HOOKS_PATH}`;
    manager.contextUrl = `http://127.0.0.1:${server.port}${CONTEXT_PATH}`;

    /* The built client from one directory; anything that is not a file falls back to the app shell. */
    const serveClient = async (dir: string, pathname: string): Promise<Response> => {
        const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
        const file = Bun.file(join(dir, relative === '/' ? 'index.html' : relative));
        const headers = { 'content-security-policy': CLIENT_CSP };
        if (await file.exists()) {
            return new Response(file, { headers });
        }
        return new Response(Bun.file(join(dir, 'index.html')), { headers });
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
        usage.stop();
        limits.stop();
        processes.stop();
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
        drawings.closeAll();
        diagrams.closeAll();
        peers.closeAll();
        await relay.stop();
        server.stop(true);
        process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));

    console.log(`ruimte server ${VERSION} listening on ws://${server.hostname}:${server.port}/ws (home: ${config.home})`);
};

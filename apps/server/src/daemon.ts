import { PushService } from './push/service.ts';
import { registerPushHandlers } from './handlers/push.ts';
import { dirname, join, normalize, resolve } from 'node:path';
import type { ServerWebSocket } from 'bun';
import {
    AuthTicketPayloadSchema,
    PairPayloadSchema,
    PROTOCOL_PARAM,
    PROTOCOL_REFUSED_CLOSE_CODE,
    PROTOCOL_VERSION,
    acceptsOfferedProtocol,
    protocolRefusalReason,
    type AgentKind,
    type DiagramContent
} from '@ruimte/contracts';
import { AgentStore } from './agents/agent-store.ts';
import { ClaudeTitleReader } from './agents/claude-title.ts';
import { CodexTitleReader } from './agents/codex-title.ts';
import { AgentLineageStore } from './agents/lineage.ts';
import { PendingPromptStore } from './agents/pending-prompts.ts';
import { OutboxStore } from './outbox/outbox.ts';
import { OutboxWorker } from './outbox/outbox-worker.ts';
import { nodeMode, startAgentHandler, startAgentWork } from './outbox/start-agent.ts';
import { wireEndChildren } from './outbox/end-children.ts';
import { oweResume, resumeRunHandler, resumeRunParked } from './outbox/resume-run.ts';
import { TaskStore } from './tasks/task-store.ts';
import { wireTasks } from './tasks/wiring.ts';
import { registerTaskHandlers } from './handlers/tasks.ts';
import type { AgentStart } from './canvas/verb.ts';
import { connectionOpener, socketChannel, type ClientChannel, type OpenConnection, type SocketChannel } from './connection.ts';
import { authenticateChannel } from './pulsar/channel-auth.ts';
import { AUTHENTICATED_FRAME_CHARS } from './pulsar/data-channel.ts';
import { BrokerRelay } from './pulsar/broker-relay.ts';
import { BrokerSwitch } from './pulsar/broker-switch.ts';
import { StatementGate, TEST_STATEMENT_KEY_VARIABLE, trustedStatementKeys } from './pulsar/statement.ts';
import { DirectPeers } from './pulsar/peers.ts';
import { greetingLines } from './cli/greeting.ts';
import { guardWeriftTurn } from './pulsar/turn-guard.ts';
import { registerDirectHandlers } from './handlers/direct.ts';
import { suggestChatTitle } from './chat/chat-title.ts';
import { decideAccess, isLoopbackAddress, mayInvite, reachabilityOf } from './auth/access.ts';
import { readOrCreateLocalSecret } from './auth/local-secret.ts';
import { signLinkRequest, signRegistration } from './auth/registration.ts';
import { AccountSchema } from '@ruimte/pulsar';
import { z } from 'zod';
import { pairingUrl } from './cli/pairing.ts';
import { AuthStore } from './auth/auth-store.ts';
import { Handshake } from './auth/handshake.ts';
import type { Relay } from './auth/relay.ts';
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
import { SelfUpdater, buildFileOf, readBuildFile } from './service/self-update.ts';
import { childCounter, isIdle, workOf, type MachineWork } from './service/work.ts';
import { BUILD, COMPILED as compiled, VERSION } from './version.ts';
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
import { errorText } from './error-text.ts';

// A client on another origin pairs and signs in from its own page, so the auth routes answer preflights and open CORS.
// What would end if this daemon restarted, as counts; `service/work.ts` says what counts.
const MACHINE_WORK_PATH = '/machine/work';
// What `ruimte login` has the machine sign; local secret only, like the work.
const MACHINE_LINK_PATH = '/machine/link-request';
const MACHINE_REGISTRATION_PATH = '/machine/registration';
const RegistrationRequestSchema = z.object({ accountId: AccountSchema.shape.id });

const AUTH_CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' };

// Inside a `bun build --compile` binary the sources live on a virtual file system, so paths next to the source mean nothing.

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
    // And for the agents a verb made that the daemon still has to start.
    const outbox = new OutboxStore(config.home);
    await outbox.load();
    // And for the tasks a chat gave, whose results still have to wake it.
    const tasks = new TaskStore(config.home);
    await tasks.load();
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
        subagentItems: (chatId, toolUseId) => chats.subagentItems(chatId, toolUseId),
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
        nameChat: (provider, input) => suggestChatTitle(providers, provider, input),
        onInterruptedRun: oweResume({
            projectOf: (id) => projects.index.locate(id)?.projectId ?? null,
            entries: () => outbox.list(),
            enqueue: (...args) => outboxWorker.enqueue(...args)
        }),
        taskRows: (chatId) => tasks.ofParent(chatId),
        endedAt: (chatId) => lineage.endedAt(chatId)
    });
    const projects = new ProjectStore(config.home);
    const taskWiring = wireTasks({
        tasks,
        chats,
        placed: (nodeId) => projects.index.locate(nodeId) !== null,
        titleFor: (nodeId) => projects.index.titleFor(nodeId),
        madeBy: (nodeId) => lineage.madeBy(nodeId),
        enqueue: (...args) => outboxWorker.enqueue(...args),
        alert: (target, nodeId, title, body) => push.alert(target, nodeId, title, body),
        wake: (chatId) => outboxWorker.wake(chatId)
    });
    // Stopping or deleting a node ends the agents it opened, through the outbox so a restart in between still does.
    const endChildren = wireEndChildren({ lineage, outbox, tasks, chats, sessions: manager, enqueue: (...args) => outboxWorker.enqueue(...args) });
    // A node deleted before anyone ran it takes its prompt with it, and a node that is gone frees the count its opener is held to.
    projects.index.onPlaces = (projectId, ids) => {
        endChildren.places(projectId, ids);
        void prompts.prune(projectId, ids).catch((e) => console.error('Pruning pending prompts failed:', errorText(e)));
        void lineage.prune(projectId, ids).catch((e) => console.error('Pruning agent lineage failed:', errorText(e)));
        void notices.prune(projectId, ids).catch((e) => console.error('Pruning waiting messages failed:', errorText(e)));
        void outbox.prune(projectId, ids).catch((e) => console.error('Pruning the outbox failed:', errorText(e)));
        void taskWiring.prune(projectId, ids).catch((e) => console.error('Pruning tasks failed:', errorText(e)));
    };
    const drawings = new DrawingStore(projects);
    projects.attachDrawings(drawings);
    const diagrams = new DiagramStore(projects);
    projects.attachDiagrams(diagrams);
    // Before the socket answers, so an agent whose project nobody opened since the restart still reads its links.
    await projects.warmIndex();
    // Started once hooks have an address, and without waiting for any client: that is the whole point.
    const outboxWorker = new OutboxWorker({
        store: outbox,
        handlers: {
            'start-agent': startAgentHandler({
                placed: (nodeId) => projects.index.locate(nodeId) !== null,
                hasChat: (chatId) => chats.get(chatId) !== undefined,
                createChat: (payload) => chats.create(payload),
                composerPreference: (provider) => chats.composerPreferences.for(provider),
                killChat: (chatId) => chats.kill(chatId),
                hasSession: (sessionId) => manager.get(sessionId) !== undefined,
                createSession: (options) => manager.create(options),
                killSession: (sessionId) => manager.kill(sessionId),
                onGaveUp: taskWiring.onStartGaveUp
            }),
            'resume-run': resumeRunHandler(chats),
            'wake-parent': taskWiring.wakeParent,
            'end-children': endChildren.handler
        },
        onParked: (entry, error) => {
            resumeRunParked(chats)(entry, error);
            taskWiring.onParked(entry, error);
        }
    });
    const folders = new FolderWatcher();
    const statuses = new GitStatusWatcher();
    const usage = new UsageService({ home: config.home, allowPriceFetch: config.priceFetch, knownProjects: () => projects.known() });
    const limits = new UsageMonitor({ providers });
    const sampler = await createSampler(process.platform, config.home);
    const processes = new ProcessMonitor({
        sampler,
        sessions: () => manager.list().map((session) => ({ id: session.sessionId, pid: session.pid, exited: session.exited, agent: session.agent ?? null })),
        chats: () => chats.processTargets(),
        contextUrl: () => manager.contextUrl,
        // Without a SessionEnd a clean exit and a crash look the same, so only these CLIs can be missed.
        reportsEnd: (kind) => HOOK_EVENTS[kind]?.includes('SessionEnd') === true
    });
    /* One reading of the process table per question, taken only when a question is asked. */
    const machineWork = (): MachineWork => {
        let children: ((pid: number) => number) | null = null;
        try {
            children = sampler === null ? null : childCounter(sampler.sample().processes);
        } catch {
            children = null;
        }
        return workOf({ sessions: manager.list(), chats: chats.list(), children });
    };
    const selfUpdate = new SelfUpdater({
        underService: config.underService,
        running: BUILD,
        readOnDisk: () => readBuildFile(buildFileOf(process.execPath)),
        idle: () => isIdle(machineWork()),
        exit: () => void shutdown('a newer build on disk'),
        log: (line) => console.log(line)
    });
    manager.onProcessChange = (sessionId, phase) => {
        if (phase === 'before-kill') {
            processes.beforeKill();
            return;
        }
        processes.nudge();
        selfUpdate.nudge();
        if (manager.get(sessionId)?.exited !== false) {
            taskWiring.coordinator.terminalEnded(sessionId);
        }
    };
    manager.isAgentGone = (sessionId) => processes.isAgentGone(sessionId);

    const worktrees = new Worktrees(config.home);
    const modes = { chatMode: (id: string) => chats.get(id)?.info.runtimeMode, launch: (id: string) => manager.get(id)?.launch };
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
        startAgent: (start: AgentStart) => outboxWorker.enqueue(start.projectId, start.nodeId, startAgentWork(start, modes)),
        modeOf: nodeMode(modes),
        terminalModePreference: () => chats.composerPreferences.terminalMode(),
        branchesOf: (folder: string) => worktrees.branches(folder).catch(() => null),
        addWorktree: (folder: string, branch: string) => worktrees.add(folder, branch),
        removeWorktree: (folder: string, path: string) => worktrees.remove(folder, path),
        depthOf: (nodeId: string) => lineage.depthOf(nodeId),
        openedCount: (callerId: string) => lineage.openedCount(callerId),
        recordMade: (record: { projectId: string; nodeId: string; openedBy: string; depth: number; agent: boolean }) => lineage.put(record),
        madeBy: (nodeId: string) => lineage.madeBy(nodeId),
        agentsDeleteAnyView: () => identity.agentsDeleteAnyView,
        showView: (projectId: string, viewId: string, by: string) => projects.showView(projectId, viewId, by),
        writeDiagram: (projectId: string, viewId: string, content: DiagramContent) => diagrams.write(projectId, viewId, content),
        tasks: taskWiring.host,
        /* A node that has never been shown has no session, and a canvas going down is not the place
           to fail over one, so an id neither manager knows is already ended as far as the verb goes. */
        endSession: async (kind: 'terminal' | 'chat', nodeId: string) => {
            await endChildren.owe(nodeId);
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

    const push = new PushService({
        auth,
        attentionPath: join(config.home, 'push-attention.json'),
        identity,
        titleFor: (nodeId) => projects.index.titleFor(nodeId),
        machineName: () => identity.label,
        activityNodes: () => [
            ...manager.list().flatMap((session) =>
                !session.exited && session.agent
                    ? [
                          {
                              nodeId: session.sessionId,
                              target: 'terminal' as const,
                              title: session.agent.suggestedTitle ?? 'Terminal agent',
                              status: session.agent.status
                          }
                      ]
                    : []
            ),
            ...chats.list().map((chat) => ({ nodeId: chat.chatId, target: 'chat' as const, title: chat.suggestedTitle ?? 'AI chat', status: chat.status }))
        ],
        onError: (error) => console.error('Push delivery failed:', errorText(error))
    });
    manager.observe((event) => push.consume(event));
    manager.observe((event) => taskWiring.coordinator.sessionEvent(event));
    chats.observe((event) => push.consume(event));
    manager.offlineApprovals = () => push.hasOfflineApprovals();

    const dispatcher = new Dispatcher();
    registerPushHandlers(dispatcher, auth, () => push.synchronizeActivities(), push);
    registerServerHandlers(dispatcher, { version: VERSION, home: config.home, model: await readMachineModel() });
    registerSessionHandlers(dispatcher, manager, endChildren.owe);
    registerChatHandlers(dispatcher, chats, providers, endChildren.owe, endChildren.stopNode);
    registerTaskHandlers(dispatcher, tasks, endChildren.children);
    registerProjectHandlers(dispatcher, projects);
    registerDrawingHandlers(dispatcher, drawings);
    registerDiagramHandlers(dispatcher, diagrams);
    registerAuthHandlers(dispatcher, auth, {
        identity,
        version: VERSION,
        broker: () => brokerSwitch.describe(),
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

    // A TURN server that restarts under an allocation must not take the daemon with it.
    guardWeriftTurn(process);
    // A direct channel gets its access from its own handshake, never from the socket its signals came over.
    const peers = new DirectPeers({
        // The broker's TURN credentials are asked for per attempt, since they expire and the broker can change.
        iceServers: () => [...config.stun.map((urls) => ({ urls })), ...brokerSwitch.iceServers()],
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
    const statementKeys = trustedStatementKeys(process.env, compiled);
    if (statementKeys.length === 1 && statementKeys[0] === process.env[TEST_STATEMENT_KEY_VARIABLE]?.trim()) {
        console.warn(`Believing statements signed by the test key in ${TEST_STATEMENT_KEY_VARIABLE} instead of the address book`);
    }
    // What lets a key nobody paired in on a statement from the address book, when the machine takes them.
    const statements = new StatementGate({
        machineId: identity.id,
        trustedKeys: statementKeys,
        refusesStatements: () => identity.refuseStatements,
        store: auth
    });
    /* The broker is the second way a signal reaches `peers`, next to `direct.signal` on a socket. The
       switch follows the machine's setting, so a client that changes it needs no restart here. */
    const brokerSwitch = new BrokerSwitch({
        override: config.broker,
        advertise: config.brokerAdvertise,
        setting: () => identity.broker,
        relayFor: (url) =>
            new BrokerRelay({
                url,
                publicKey: identity.publicKey,
                sign: (message) => identity.sign(message),
                isPaired: async (publicKey) => (await auth.sessionForPublicKey(publicKey)) !== null,
                admitStatement: (publicKey, access) => statements.admit(publicKey, access),
                receive: (envelope, reply) => peers.receive(envelope, reply)
            })
    });
    identity.attachBroker(brokerSwitch);
    const relay: Relay = brokerSwitch;

    if (config.installHooks) {
        // Only the CLIs the daemon has a normalizer for are listed; the others run without status.
        for (const [kind, path] of Object.entries(defaultHookPaths())) {
            installHooks(path, kind as AgentKind)
                .then((result) => {
                    if (result === 'written') {
                        console.log(`Installed ${kind} status hooks in ${path}${kind === 'codex' ? ' (trust them once with /hooks in Codex)' : ''}`);
                    }
                })
                .catch((e) => console.error(`Could not install ${kind} hooks:`, errorText(e)));
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
        presence: push,
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
        processes,
        tasks
    });

    const endpointInfo = (reachability: ClientAccess['reachability'], authenticated: boolean) => ({
        id: identity.id,
        label: identity.label,
        nameSource: identity.nameSource,
        icon: identity.icon,
        agentsDeleteAnyView: identity.agentsDeleteAnyView,
        refuseStatements: identity.refuseStatements,
        platform: process.platform,
        version: VERSION,
        protocol: PROTOCOL_VERSION,
        reachability,
        authenticated,
        publicKey: identity.publicKey,
        broker: identity.broker,
        ...brokerSwitch.describe()
    });

    const server = Bun.serve<ClientAccess & { protocolRefused: boolean }>({
        hostname: config.host,
        port: config.port,
        async fetch(request, server) {
            const url = new URL(request.url);
            const remote = server.requestIP(request)?.address ?? '';

            if (url.pathname === '/health') {
                if (request.method !== 'GET') {
                    return new Response('Method not allowed', { status: 405 });
                }
                return Response.json({ ok: true, version: VERSION, build: BUILD, service: config.underService });
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

            if (url.pathname === MACHINE_WORK_PATH) {
                // Only for the local secret: the desktop app asks before it restarts the service, and nobody else needs to know.
                if (request.method !== 'GET') {
                    return new Response('Method not allowed', { status: 405 });
                }
                const decision = await decideAccess(request, remote, auth, access);
                if (!decision.ok || decision.access.sessionId !== null) {
                    return new Response('Forbidden', { status: 403 });
                }
                return Response.json(machineWork());
            }

            if (url.pathname === MACHINE_LINK_PATH || url.pathname === MACHINE_REGISTRATION_PATH) {
                // `ruimte login` on the local secret: the machine signs, the terminal talks to the address book.
                if (request.method !== 'POST') {
                    return new Response('Method not allowed', { status: 405 });
                }
                const decision = await decideAccess(request, remote, auth, access);
                if (!decision.ok || decision.access.sessionId !== null) {
                    return new Response('Forbidden', { status: 403 });
                }
                const { brokerUrl } = brokerSwitch.describe();
                if (url.pathname === MACHINE_LINK_PATH) {
                    return Response.json(signLinkRequest(identity, brokerUrl));
                }
                const parsed = RegistrationRequestSchema.safeParse(await request.json().catch(() => null));
                if (!parsed.success) {
                    return new Response('Expected an account id', { status: 400 });
                }
                return Response.json(signRegistration(identity, brokerUrl, parsed.data.accountId));
            }

            if (url.pathname === '/ws') {
                const decision = await decideAccess(request, remote, auth, access);
                if (!decision.ok) {
                    return new Response(decision.reason, { status: decision.status });
                }
                // Upgraded and then closed, since a browser reads the code and reason of a close but never the status of a refused upgrade.
                const protocolRefused = !acceptsOfferedProtocol(url.searchParams.get(PROTOCOL_PARAM));
                if (server.upgrade(request, { data: { ...decision.access, protocolRefused } })) {
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
                if (ws.data.protocolRefused) {
                    ws.close(PROTOCOL_REFUSED_CLOSE_CODE, protocolRefusalReason());
                    return;
                }
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
    outboxWorker.start();
    endChildren.start();
    // Beside the daemon answering: a turn a restart interrupted is taken up again without waiting for a client.
    void chats.recoverInterrupted().catch((e) => console.error('Resuming interrupted turns failed:', errorText(e)));

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
    const shutdown = async (reason: string): Promise<void> => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        console.log(`ruimte server stopping for ${reason}, writing snapshots`);
        selfUpdate.stop();
        outboxWorker.stop();
        taskWiring.coordinator.stop();
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
            console.error('Snapshot on shutdown failed:', errorText(e));
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
    selfUpdate.start();

    const greeting = greetingLines({
        version: VERSION,
        host: server.hostname ?? config.host,
        port: server.port ?? config.port,
        home: config.home,
        interactive: process.stdout.isTTY === true && !config.underService
    });
    for (const line of greeting) {
        console.log(line);
    }
};

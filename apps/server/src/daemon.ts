import { PushService } from './push/service.ts';
import { registerPushHandlers } from './handlers/push.ts';
import { dirname, join, normalize, resolve } from 'node:path';
import { cspString } from '@ruimte/csp';
import type { ServerWebSocket } from 'bun';
import {
    AuthTicketPayloadSchema,
    isIdle,
    MACHINE_HEALTH_PATH,
    MACHINE_WORK_PATH,
    PairPayloadSchema,
    PROTOCOL_PARAM,
    PROTOCOL_REFUSED_CLOSE_CODE,
    PROTOCOL_VERSION,
    acceptsOfferedProtocol,
    protocolRefusalReason,
    type AgentKind,
    type DiagramContent,
    type HealthResult,
    type MachineWork,
    type RuntimeMode
} from '@ruimte/contracts';
import { AgentStore } from './agents/agent-store.ts';
import { ClaudeTitleReader } from './agents/claude-title.ts';
import { CodexTitleReader } from './agents/codex-title.ts';
import { AgentLineageStore } from './agents/lineage.ts';
import { PendingPromptStore } from './agents/pending-prompts.ts';
import { OutboxStore } from './outbox/outbox.ts';
import { nodeMode, startAgentWork } from './outbox/start-agent.ts';
import { OutboxLink, wireOutbox } from './outbox/wiring.ts';
import { TaskStore } from './tasks/task-store.ts';
import { registerTaskHandlers } from './handlers/tasks.ts';
import { registerPlanHandlers } from './handlers/plan.ts';
import { PlanStore } from './plans/plan-store.ts';
import type { AgentStart, WorktreeWant } from './canvas/verb.ts';
import { addWanted } from './canvas/worktree.ts';
import { SOCKET_BACKPRESSURE_LIMIT } from './backpressure.ts';
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
import { decideAccess, handleLocalTicketRequest, isLoopbackAddress, mayInvite, reachabilityOf } from './auth/access.ts';
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
import { defaultCodexRulesPath, defaultHookPaths, installCodexRules, installHooks } from './agents/install.ts';
import { ATTACHMENTS_PATH, handleAttachmentRequest } from './chat/attachment-route.ts';
import { AttachmentStore } from './chat/attachment-store.ts';
import { CANVAS_PATH, handleCanvasRequest } from './canvas/canvas-route.ts';
import { ChatManager } from './chat/chat-manager.ts';
import { hookContext } from './context/context-note.ts';
import { handleContextRequest } from './context/context-route.ts';
import { CONTEXT_PATH, ContextStore } from './context/context-store.ts';
import { deliverNotice, noticeNote, NoticeStore, renderNotice, showNotices, type Notice } from './context/notices.ts';
import { turnFromMessage } from './context/deliver-message.ts';
import { ChatStore } from './chat/chat-store.ts';
import { BookmarkStore } from './chat/bookmark-store.ts';
import type { ServerConfig } from './config.ts';
import { Dispatcher, type ClientAccess } from './dispatcher.ts';
import { readOrCreateEndpointIdentity } from './endpoint-id.ts';
import { SelfUpdater, buildFileOf, readBuildFile } from './service/self-update.ts';
import { childCounter, workOf } from './service/work.ts';
import { BUILD, COMPILED as compiled, VERSION } from './version.ts';
import { registerAuthHandlers } from './handlers/auth.ts';
import { registerChatHandlers } from './handlers/chat.ts';
import { chatForkDeps, forkChat, readForkInfo } from './chat/fork.ts';
import { withForkOrigin } from './context/fork-origin.ts';
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
import { registerComputerHandlers } from './handlers/computer.ts';
import { ComputerUse } from './computer/computer-use.ts';
import { ComputerHelper, locateHelperApp } from './computer/helper.ts';
import { ComputerUseStore } from './computer/store.ts';
import { Checkpoints } from './git/checkpoints.ts';
import { GitStatusWatcher } from './git/status-watcher.ts';
import { worktreeAgents } from './git/worktree-agents.ts';
import { worktreeHost } from './git/worktree-host.ts';
import { agentStates } from './agents/agent-state.ts';
import { WorktreeMerge } from './git/worktree-merge.ts';
import { Worktrees } from './git/worktrees.ts';
import { ProcessMonitor } from './processes/monitor.ts';
import { createSampler } from './processes/sampler.ts';
import { handleProjectRequest, PROJECTS_PATH } from './projects/icon-route.ts';
import { DiagramStore } from './projects/diagram-store.ts';
import { DrawingStore } from './projects/drawing-store.ts';
import { isTrackedPath } from './git/ignore.ts';
import { ProjectStore } from './projects/project-store.ts';
import { takesNoteOnLine } from './providers/launch.ts';
import { ProviderRegistry } from './providers/registry.ts';
import { BunPtyAdapter } from './pty/bun-pty.ts';
import { SessionError, SessionManager } from './sessions/manager.ts';
import { CommandApprovals, commandsSet } from './sessions/command-approvals.ts';
import { startCwdGuard } from './canvas/project-paths.ts';
import { SnapshotStore, scheduleSnapshots } from './sessions/snapshot-store.ts';
import { UsageMonitor } from './usage/limits/monitor.ts';
import { UsageService } from './usage/usage-service.ts';
import { errorText } from './error-text.ts';
import { BrowserDriver } from './browser/drive.ts';
import { BrowserManager } from './browser/manager.ts';
import { BrowserPages } from './browser/pages.ts';
import { registerBrowserHandlers } from './handlers/browser.ts';
import { handleLiveStreamRequest, LIVE_STREAM_PATH } from './streams/http-stream.ts';
import { DeviceManager } from './devices/manager.ts';
import { IosPhysicalBackend } from './devices/ios-physical.ts';
import { IosSimulatorBackend } from './devices/ios-simulator.ts';
import { createDeviceHelperLauncher } from './devices/helper-source.ts';
import { createPhysicalStreamSourceFactory, physicalStreamHelperPath } from './devices/physical-stream-source.ts';
import { AndroidBackend } from './devices/android.ts';
import { ScrcpyServerFile, scrcpyServerDirectory } from './devices/scrcpy-server.ts';
import { adbScrcpyHost, ScrcpySource } from './devices/scrcpy-source.ts';
import { registerDeviceHandlers } from './handlers/device.ts';
import { LiveStreamHub } from './streams/live-stream.ts';

// What `ruimte login` has the machine sign; local secret only, like the work.
const MACHINE_LINK_PATH = '/machine/link-request';
const MACHINE_REGISTRATION_PATH = '/machine/registration';
const RegistrationRequestSchema = z.object({ accountId: AccountSchema.shape.id });

// Past anything a hook or a verb sends, and the ceiling on what an unauthenticated request can make the daemon buffer.
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;

// A client on another origin pairs and signs in from its own page, so the auth routes answer preflights and open CORS.
const AUTH_CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' };

// Inside a `bun build --compile` binary the sources live on a virtual file system, so paths next to the source mean nothing.

/* The policy the served client runs under, the same one the client's own `<meta http-equiv>` carries. */
const CLIENT_CSP = cspString();

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
    // And for the commands a person let a terminal type, which a node's first start asks about.
    const commandApprovals = new CommandApprovals(config.home);
    await commandApprovals.load();
    // And for whether agents may operate this machine's apps, and which ones a person let them into for good.
    const computerStore = new ComputerUseStore(config.home);
    await computerStore.load();
    const computer: ComputerUse = new ComputerUse({
        home: config.home,
        store: computerStore,
        helper: new ComputerHelper({
            home: config.home,
            appPath: locateHelperApp({ platform: process.platform, compiled, execPath: process.execPath, sourceDir: import.meta.dir })
        }),
        // A grant for this time ends with the shell or the CLI conversation it was given to.
        runOf: (id) => {
            const session = manager.get(id);
            if (session && !session.exited) {
                return `terminal:${session.hookToken}`;
            }
            const chat = chats.get(id);
            return chat ? `chat:${chat.info.agentSessionId ?? id}` : null;
        },
        describe: async (id) => {
            const place = projects.index.locate(id);
            const project = place === null ? undefined : (await projects.known()).find((known) => known.projectId === place.projectId);
            return {
                surface: manager.get(id) ? 'terminal' : 'chat',
                nodeTitle: projects.index.titleFor(id),
                projectId: place?.projectId ?? null,
                projectName: project?.name ?? null
            };
        }
    });
    await computer.start();
    const folderOf = (nodeId: string): string | null => projects.index.locate(nodeId)?.folder ?? null;
    const startCwd = startCwdGuard({
        madeByAgent: (nodeId) => lineage.madeBy(nodeId) !== null,
        folderOf,
        worktreePaths: (folder) => canvasHost.worktreePaths(folder)
    });
    /* What a node hears the moment it can: taken here, so whichever channel gets there first is the
       only one that delivers it. */
    const messagesFor = (targetId: string): string[] => notices.take(targetId).map(renderNotice);
    /* The other reader: what a chat has to show a person in its thread, which is never taken from the model. */
    const unshownFor = async (chatId: string): Promise<string[]> => (await notices.show(chatId)).map(noticeNote);
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
        depthOf: (sessionId) => lineage.depthOf(sessionId),
        computerUse: () => computer.enabled,
        // A node no project places yet has no folder to approve against, so its command waits for the save that adds it.
        commands: {
            approved: (sessionId, command) => {
                const folder = folderOf(sessionId);
                return folder !== null && commandApprovals.has(folder, sessionId, command);
            },
            approve: async (sessionId, command) => {
                const folder = folderOf(sessionId);
                if (folder === null) {
                    throw new SessionError('session-not-found', `No project this machine knows places ${sessionId}`);
                }
                await commandApprovals.approve(folder, sessionId, command);
            }
        },
        modeCeiling: (sessionId) => lineage.ceilingOf(sessionId),
        checkCwd: startCwd,
        approvals: config.approvals,
        claudeTitles,
        codexTitles: new CodexTitleReader()
    });
    const snapshotSchedule = scheduleSnapshots(manager, snapshots);
    const providers = new ProviderRegistry();
    // A bearer token speaks for a terminal session or a chat, for reading context and for canvas verbs alike.
    const targetForToken = (token: string): string | null => manager.sessionIdForToken(token) ?? chats.chatIdForToken(token);
    const context: ContextStore = new ContextStore({
        sources: (targetId) =>
            withForkOrigin(targetId, projects.index.sourcesFor(targetId), {
                forkedFrom: (id) => lineage.forkedFrom(id),
                forksOf: (id) => lineage.forksOf(id),
                locate: (id) => projects.index.locate(id),
                titleFor: (id) => projects.index.titleFor(id)
            }),
        terminalText: (sessionId) => manager.get(sessionId)?.plainText() ?? Promise.resolve(null),
        chatItems: (chatId) => chats.get(chatId)?.thread.list() ?? null,
        browserPage: (browserId) => browserDriver.read(browserId),
        devices: () => devices.list(),
        chatPlans: (chatId) => plans.read(chatId),
        subagentItems: (chatId, toolUseId) => chats.subagentItems(chatId, toolUseId),
        drawingElements: (viewId) => drawings.elementsOf(viewId),
        diagramDocument: async (targetId, viewId) => {
            const place = projects.index.locate(targetId);
            return place ? diagrams.read(place.projectId, viewId) : null;
        },
        canvasOf: (targetId) => projects.index.canvasOf(targetId)
    });
    const outboxLink = new OutboxLink({ outbox, projectOf: (id) => projects.index.locate(id)?.projectId ?? null });
    const attachments = new AttachmentStore(config.home);
    const checkpoints = new Checkpoints(config.home);
    const plans = new PlanStore(config.home);
    const bookmarks = new BookmarkStore(config.home);
    const chats: ChatManager = new ChatManager({
        providers,
        store: new ChatStore(config.home, attachments),
        attachments,
        checkpoints,
        contextUrl,
        binDir,
        depthOf: (chatId) => lineage.depthOf(chatId),
        computer: () => computer.enabled,
        modeCeiling: (chatId) => lineage.ceilingOf(chatId),
        checkCwd: startCwd,
        contextSources: (chatId) => context.list(chatId),
        standalone: (chatId) => projects.index.locate(chatId)?.canvasId === null,
        openingSelection: (chatId, provider) => {
            const entry = outbox.list().find((entry) => entry.kind === 'start-agent' && entry.target === chatId);
            return entry?.kind === 'start-agent' && entry.payload.provider === provider ? entry.payload.selection : undefined;
        },
        messages: messagesFor,
        unshownMessages: unshownFor,
        firstPrompt: (chatId) => prompts.take(chatId),
        // A turn reports what is left of its plan in passing; that belongs to the machine's numbers.
        onLimits: (update) => limits.applyLive(update),
        claudeTitles,
        // One one-shot call per Codex chat, on whichever CLI here answers a single prompt.
        nameChat: (provider, input) => suggestChatTitle(providers, provider, input),
        onInterruptedRun: outboxLink.onInterruptedRun,
        taskRows: (chatId) => tasks.ofParent(chatId),
        dropWakes: (chatId) => tasks.dropWake(chatId),
        endedAt: (chatId) => lineage.endedAt(chatId),
        plans,
        bookmarks
    });
    const projects = new ProjectStore(config.home);
    projects.attachTracked(isTrackedPath);
    const outboxWiring = wireOutbox({
        link: outboxLink,
        outbox,
        projects,
        lineage,
        prompts,
        notices,
        tasks,
        chats,
        sessions: manager,
        alert: (target, nodeId, title, body) => push.alert(target, nodeId, title, body),
        checkCwd: startCwd
    });
    const outboxWorker = outboxWiring.worker;
    const taskWiring = outboxWiring.tasks;
    const endChildren = outboxWiring.endChildren;
    const summaries = outboxWiring.summaries;
    projects.index.onPlaces = outboxWiring.places;
    /* A node that has never been shown has no session, and a project going down is not the place to
       fail over one, so an id neither manager knows is already ended as far as the caller goes. */
    const endSession = async (kind: 'terminal' | 'chat', nodeId: string): Promise<void> => {
        computer.nodeClosed(nodeId);
        await endChildren.owe(nodeId);
        await (kind === 'terminal' ? manager.kill(nodeId) : chats.kill(nodeId)).catch(() => undefined);
    };
    projects.attachSessionEnder(endSession);
    projects.attachSaveListener(async (folder, before, after) => {
        for (const { nodeId, command } of commandsSet(before, after)) {
            try {
                await commandApprovals.approve(folder, nodeId, command);
            } catch (e) {
                // Not approved is only asked again; the save itself already landed.
                console.error(`Approving the command of ${nodeId} failed:`, errorText(e));
                continue;
            }
            manager.runApproved(nodeId, command);
        }
    });
    const drawings = new DrawingStore(projects);
    projects.attachDrawings(drawings);
    const diagrams = new DiagramStore(projects);
    projects.attachDiagrams(diagrams);
    // Before the socket answers, so an agent whose project nobody opened since the restart still reads its links.
    await projects.warmIndex();
    const folders = new FolderWatcher();
    const liveStreams = new LiveStreamHub();
    const browsers = BrowserManager.withBun(config.home, liveStreams);
    // The pages the clients draw themselves, which this machine can only reach by asking them.
    const browserPages = new BrowserPages();
    const browserDriver = new BrowserDriver(config.home, browsers, browserPages);
    const deviceHelperCommand = compiled ? [process.execPath, 'device-helper'] : [process.execPath, resolve(import.meta.dir, 'main.ts'), 'device-helper'];
    const physicalStreamSource = createPhysicalStreamSourceFactory(physicalStreamHelperPath(compiled, process.execPath, resolve(import.meta.dir, '../..')));
    // A development checkout fetches the pinned screen server on first use; a build carries it.
    const scrcpyServer = new ScrcpyServerFile(scrcpyServerDirectory(compiled, process.execPath, resolve(import.meta.dir, '..')), !compiled);
    const android = new AndroidBackend({
        createSource: scrcpyServer.available ? (adb, serial) => new ScrcpySource(adbScrcpyHost(adb, serial), () => scrcpyServer.path()) : null
    });
    const devices = new DeviceManager(
        process.platform === 'darwin'
            ? [
                  new IosSimulatorBackend(undefined, createDeviceHelperLauncher(deviceHelperCommand)),
                  new IosPhysicalBackend(undefined, undefined, physicalStreamSource),
                  android
              ]
            : process.platform === 'linux'
              ? [android]
              : [],
        liveStreams
    );
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
    const merges = new WorktreeMerge(
        worktrees,
        worktreeAgents({ chats: () => chats.list(), sessions: () => manager.list(), stopNode: (nodeId, reason) => endChildren.stopNode(nodeId, reason) })
    );
    const modes = {
        chatMode: (id: string) => chats.get(id)?.info.runtimeMode,
        launch: (id: string) => manager.get(id)?.launch,
        reportedMode: (id: string) => manager.get(id)?.reportedMode
    };
    /* Where a message a person has not seen goes: the thread of the chat left under that node id. */
    const noticeChat = {
        has: (id: string) => chats.hasStored(id),
        note: (id: string, text: string) => chats.addNote(id, 'info', text)
    };
    const canvasHost = {
        locate: (id: string) => projects.index.locate(id),
        read: (projectId: string) => projects.read(projectId),
        revision: (projectId: string) => projects.revision(projectId),
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
        addWorktree: (folder: string, want: WorktreeWant, projectId: string) => addWanted(worktrees, folder, want, projectId),
        claimWorktree: (folder: string, path: string, nodeId: string) => worktrees.claim(folder, path, nodeId),
        removeWorktree: (folder: string, path: string) => worktrees.remove(folder, path),
        worktrees: worktreeHost(worktrees, merges),
        browsers: browserDriver,
        agents: agentStates({ outbox, lineage, chats, sessions: manager }),
        computer,
        context: {
            list: (targetId: string) => context.list(targetId),
            read: (targetId: string, sourceId: string, tail: number | null, subagent: string | null) => context.answer(targetId, sourceId, tail, subagent)
        },
        depthOf: (nodeId: string) => lineage.depthOf(nodeId),
        openedCount: (callerId: string) => lineage.openedCount(callerId),
        recordMade: (record: { projectId: string; nodeId: string; openedBy: string; depth: number; agent: boolean; ceiling?: RuntimeMode }) =>
            lineage.put(record),
        madeBy: (nodeId: string) => lineage.madeBy(nodeId),
        agentsDeleteAnyView: () => identity.agentsDeleteAnyView,
        showView: (projectId: string, viewId: string, by: string) => projects.showView(projectId, viewId, by),
        writeDiagram: (projectId: string, viewId: string, content: DiagramContent) => diagrams.write(projectId, viewId, content),
        tasks: taskWiring.host,
        plans,
        endSession,
        notify: async (notice: Omit<Notice, 'createdAt'>) => {
            const delivery = await deliverNotice(
                notices,
                {
                    /* An exited session still lists its last screen, but nobody is reading it; its
                   message waits for the shell that takes the id over. */
                    terminal: (id) => {
                        const session = manager.get(id);
                        return session && !session.exited ? { agent: session.agent, notice: (text: string) => session.notice(text) } : null;
                    },
                    chat: async (id) => {
                        const session = chats.get(id);
                        if (session) {
                            return session.info.activeTurnId === null ? 'idle' : 'running';
                        }
                        // A chat nobody has loaded is idle: the turn opens on the thread the daemon reads back from disk.
                        return (await chats.hasStored(id)) ? 'idle' : 'none';
                    },
                    fromMessage: (id) => {
                        const session = chats.get(id);
                        return session !== undefined && turnFromMessage(session.thread.list(), session.info.activeTurnId);
                    }
                },
                notice
            );
            /* A chat shows it to a person the moment it lands. Never in the way of the answer to the
               sender: the message is in the queue by now, so the model hears it whatever a thread does. */
            await showNotices(notices, noticeChat, notice.targetId).catch((e) =>
                console.error(`Showing a message in chat ${notice.targetId} failed:`, errorText(e))
            );
            /* After the line in the thread, so a person sees the message itself above the turn it opens. */
            if (delivery.wake) {
                await outboxWorker.enqueue(notice.projectId, notice.targetId, { kind: 'deliver-message', payload: { from: notice.from } });
            }
            return delivery;
        }
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
    manager.observe((event) => computer.observe(event));
    chats.observe((event) => computer.observe(event));
    manager.offlineApprovals = () => push.hasOfflineApprovals();

    const dispatcher = new Dispatcher();
    registerPushHandlers(dispatcher, auth, () => push.synchronizeActivities(), push);
    registerServerHandlers(dispatcher, { version: VERSION, home: config.home, model: await readMachineModel() });
    registerSessionHandlers(dispatcher, manager, endChildren.owe);
    registerBrowserHandlers(dispatcher, browsers, browserPages, () => identity.streamingAllowed);
    registerDeviceHandlers(dispatcher, devices, () => identity.streamingAllowed);
    const forkDeps = chatForkDeps({ chats, host: canvasHost, titleFor: (id) => projects.index.titleFor(id), lineage, worktrees, checkpoints });
    const beforeChatKill = (chatId: string): Promise<unknown> => {
        computer.nodeClosed(chatId);
        return endChildren.owe(chatId);
    };
    registerChatHandlers(dispatcher, chats, providers, beforeChatKill, endChildren.stopNode, {
        fork: (payload) => forkChat(forkDeps, payload),
        info: (payload) => readForkInfo(forkDeps, payload),
        summarize: (chatId) => summaries.summarize(chatId)
    });
    registerTaskHandlers(dispatcher, tasks, endChildren.children);
    registerPlanHandlers(dispatcher, plans);
    registerProjectHandlers(dispatcher, projects);
    registerDrawingHandlers(dispatcher, drawings);
    registerDiagramHandlers(dispatcher, diagrams);
    registerAuthHandlers(dispatcher, auth, {
        identity,
        version: VERSION,
        broker: () => brokerSwitch.describe(),
        pairingUrl: () => pairingUrl(config.host, server.port ?? config.port, auth.issuePairingToken()),
        streamingChanged: (allowed) => {
            if (!allowed) {
                browsers.closeAll();
                devices.closeAll();
            }
        },
        disconnect: (sessionId) => {
            handshake.revoke(sessionId);
            for (const { channel, connection } of [...connections.values(), ...directConnections]) {
                if (connection.client.access?.sessionId === sessionId) {
                    channel.close(4001, 'Access revoked');
                }
            }
        }
    });
    registerFsHandlers(dispatcher, folders, async (clientId) => ({
        folders: await projects.heldFolders(clientId),
        worktreesOf: canvasHost.worktreePaths,
        worktreesRoot: worktrees.root
    }));
    registerBytesHandlers(dispatcher, {
        attachment: (chatId, id) => chats.attachment(chatId, id),
        projectIcon: (projectId, theme) => projects.iconFile(projectId, theme),
        media: readMedia
    });
    registerUsageHandlers(dispatcher, usage, limits);
    registerProcessHandlers(dispatcher, processes);
    registerComputerHandlers(dispatcher, computer);
    registerGitHandlers(dispatcher, worktrees, merges, statuses, providers);

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
        const rulesPath = defaultCodexRulesPath();
        installCodexRules(rulesPath)
            .then((result) => {
                if (result === 'written') {
                    console.log(`Installed the codex rule for ruimte-context in ${rulesPath}`);
                }
            })
            .catch((e) => console.error('Could not install the codex rule:', errorText(e)));
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
        browsers,
        browserPages,
        devices,
        identity,
        projects,
        drawings,
        diagrams,
        folders,
        statuses,
        usage,
        limits,
        processes,
        tasks,
        worktrees,
        plans,
        computer
    });

    const endpointInfo = (reachability: ClientAccess['reachability'], authenticated: boolean) => ({
        id: identity.id,
        label: identity.label,
        nameSource: identity.nameSource,
        icon: identity.icon,
        agentsDeleteAnyView: identity.agentsDeleteAnyView,
        refuseStatements: identity.refuseStatements,
        streamingAllowed: identity.streamingAllowed,
        platform: process.platform,
        version: VERSION,
        protocol: PROTOCOL_VERSION,
        reachability,
        authenticated,
        publicKey: identity.publicKey,
        broker: identity.broker,
        ...brokerSwitch.describe()
    });

    const server = Bun.serve<ClientAccess & { protocolRefused: boolean; ticket: string | null }>({
        hostname: config.host,
        port: config.port,
        maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
        async fetch(request, server) {
            const url = new URL(request.url);
            const remote = server.requestIP(request)?.address ?? '';

            if (url.pathname === MACHINE_HEALTH_PATH) {
                if (request.method !== 'GET') {
                    return new Response('Method not allowed', { status: 405 });
                }
                return Response.json({ ok: true, version: VERSION, build: BUILD, service: config.underService } satisfies HealthResult);
            }

            if (url.pathname === '/auth/pairing-token') {
                // `ruimte pair` sends the local secret as a bearer; the socket's `auth.pairingToken` asks the same `mayInvite`.
                if (request.method !== 'POST') {
                    return new Response('Method not allowed', { status: 405 });
                }
                const decision = await decideAccess(request, remote, auth, access, 'local');
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

            if (url.pathname === '/auth/local-ticket') {
                return handleLocalTicketRequest(request, access, handshake);
            }

            if (url.pathname === MACHINE_WORK_PATH) {
                // Only for the local secret: the desktop app asks before it restarts the service, and nobody else needs to know.
                if (request.method !== 'GET') {
                    return new Response('Method not allowed', { status: 405 });
                }
                const decision = await decideAccess(request, remote, auth, access, 'local');
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
                const decision = await decideAccess(request, remote, auth, access, 'local');
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
                const decision = await decideAccess(request, remote, auth, access, 'socket');
                if (!decision.ok) {
                    return new Response(decision.reason, { status: decision.status });
                }
                // Upgraded and then closed, since a browser reads the code and reason of a close but never the status of a refused upgrade.
                const protocolRefused = !acceptsOfferedProtocol(url.searchParams.get(PROTOCOL_PARAM));
                if (server.upgrade(request, { data: { ...decision.access, protocolRefused, ticket: decision.ticket ?? null } })) {
                    return undefined;
                }
                if (decision.ticket !== undefined) {
                    handshake.socketClosed(decision.ticket);
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

            if (url.pathname.startsWith(`${LIVE_STREAM_PATH}/`)) {
                return handleLiveStreamRequest(request, url, remote, auth, access, liveStreams, () => identity.streamingAllowed);
            }

            if (url.pathname.startsWith(`${HOOKS_PATH}/`)) {
                return handleHookRequest(
                    request,
                    url.pathname,
                    manager,
                    (token, event, kind) => {
                        const sessionId = manager.sessionIdForToken(token);
                        if (!sessionId) {
                            return null;
                        }
                        // Asked on every event that can carry an answer, so the memory of what this
                        // agent was told keeps up with its turns even where nothing is printed.
                        const changed = context.changeSince(sessionId);
                        // A CLI the node launched got the verbs on its line; one typed by hand in the shell did not.
                        const verbs = !(takesNoteOnLine(kind) && manager.get(sessionId)?.launch?.kind === kind);
                        return hookContext(event, context.list(sessionId), {
                            changed,
                            messages: messagesFor(sessionId),
                            depth: lineage.depthOf(sessionId),
                            verbs,
                            computer: computer.enabled
                        });
                    },
                    (token, body, signal) => manager.holdApproval(token, body, signal)
                );
            }

            if (url.pathname.startsWith(`${CANVAS_PATH}/`)) {
                return handleCanvasRequest(request, url.pathname, { targetForToken, host: canvasHost });
            }

            if (url.pathname === CONTEXT_PATH || url.pathname.startsWith(`${CONTEXT_PATH}/`)) {
                return handleContextRequest(request, url.pathname, { targetForToken, host: canvasHost });
            }

            if (config.serve) {
                return serveClient(config.serve, url.pathname);
            }

            return new Response('Not found', { status: 404 });
        },
        websocket: {
            backpressureLimit: SOCKET_BACKPRESSURE_LIMIT,
            closeOnBackpressureLimit: true,
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
                if (ws.data.ticket !== null) {
                    handshake.socketClosed(ws.data.ticket);
                }
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
    // Only once `hookUrl` is set: a terminal the worker starts before that runs without hooks for good.
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
        summaries.coordinator.stop();
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
        await computer.stop();
        manager.killAll();
        browsers.closeAll();
        devices.closeAll();
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

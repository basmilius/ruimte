import { PushService } from './push/service.ts';
import { registerPushHandlers } from './handlers/push.ts';
import { SnoozeStore } from './push/snoozes.ts';
import { registerSnoozeHandlers } from './handlers/snooze.ts';
import { dirname, join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import type { Server, ServerWebSocket } from 'bun';
import {
    isIdle,
    MACHINE_HEALTH_PATH,
    MACHINE_PROOF_PATH,
    MACHINE_STATUS_PATH,
    MACHINE_WORK_PATH,
    PROTOCOL_PARAM,
    PROTOCOL_REFUSED_CLOSE_CODE,
    acceptsOfferedProtocol,
    protocolRefusalReason,
    type AgentKind,
    type DiagramContent,
    type HealthResult,
    type MachineStatus,
    type MachineWork,
    type RuntimeMode,
    type VisualAppearance,
    type VisualHeight
} from '@ruimte/contracts';
import { AgentStore } from './agents/agent-store.ts';
import { ClaudeTitleReader } from '@adecore/agents/chat/claude-title';
import { CodexTitleReader } from './agents/codex-title.ts';
import { AgentLineageStore } from '@adecore/agents/lineage';
import { PendingPromptStore } from './agents/pending-prompts.ts';
import { OutboxStore } from './outbox/outbox.ts';
import { nodeAccount, nodeMode, startAgentWork } from './outbox/start-agent.ts';
import { OutboxLink, wireOutbox } from './outbox/wiring.ts';
import { restartBackgroundLimits } from '@adecore/agents/tasks/background-limit';
import { TaskStore } from '@adecore/agents/tasks/task-store';
import { registerTaskHandlers } from './handlers/tasks.ts';
import { registerPlanHandlers } from './handlers/plan.ts';
import { registerProvenanceHandlers } from './handlers/provenance.ts';
import { isPlanFileName, PlanStore } from './plans/plan-store.ts';
import { provenanceChat } from './provenance/chat-facts.ts';
import { ProvenanceService } from './provenance/provenance-service.ts';
import type { AgentStart, WorktreeWant } from './canvas/verb.ts';
import { addWanted } from './canvas/worktree.ts';
import { SOCKET_BACKPRESSURE_LIMIT } from './backpressure.ts';
import { connectionOpener, socketChannel, type ClientChannel, type OpenConnection, type SocketChannel } from './connection.ts';
import { authenticateChannel } from './pulsar/channel-auth.ts';
import { AUTHENTICATED_FRAME_CHARS } from './pulsar/data-channel.ts';
import { BrokerRelay } from './pulsar/broker-relay.ts';
import { BrokerSwitch } from './pulsar/broker-switch.ts';
import { lanAddresses } from './pulsar/lan-addresses.ts';
import { LanDoor } from './pulsar/lan-door.ts';
import { SignalGate } from './pulsar/signal-gate.ts';
import { StatementGate, TEST_STATEMENT_KEY_VARIABLE, trustedStatementKeys } from './pulsar/statement.ts';
import { DirectPeers } from './pulsar/peers.ts';
import { greetingLines } from './cli/greeting.ts';
import { guardWeriftTurn } from './pulsar/turn-guard.ts';
import { registerDirectHandlers } from './handlers/direct.ts';
import { suggestChatTitle } from '@adecore/agents/chat/chat-title';
import { crossOriginHeaders, decideAccess, handleLocalTicketRequest, isOwner, preflightHeaders, reachabilityOf, withHeaders } from './auth/access.ts';
import { handleLocalProofRequest } from './auth/local-proof.ts';
import { readOrCreateLocalSecret } from './auth/local-secret.ts';
import { MachineAccountError, signForAccount, signLinkRequest } from './auth/registration.ts';
import { AccountSchema } from '@ruimte/pulsar';
import { z } from 'zod';
import { AuthStore } from './auth/auth-store.ts';
import { Handshake } from './auth/handshake.ts';
import type { Relay } from './auth/relay.ts';
import { HOOKS_PATH, handleHookRequest } from './agents/hook-receiver.ts';
import { HOOK_EVENTS } from './agents/hooks.ts';
import { defaultCodexRulesPath, defaultHookPaths, installCodexRules, installHooks, installInFolder } from './agents/install.ts';
import { ATTACHMENTS_PATH, handleAttachmentRequest } from './chat/attachment-route.ts';
import { AttachmentStore } from '@adecore/agents/chat/attachment-store';
import { CANVAS_PATH, CANVAS_REQUEST_TIMEOUT_S, handleCanvasRequest } from './canvas/canvas-route.ts';
import { ChatManager } from './chat/chat-manager.ts';
import { hookContext } from './context/context-note.ts';
import { handleContextRequest } from './context/context-route.ts';
import { CONTEXT_PATH, ContextStore } from './context/context-store.ts';
import { chatNoticeTargets, showNotices } from '@adecore/agents/messages/deliver-notice';
import { NoticeNotes, unshownNotes } from '@adecore/agents/messages/notice-notes';
import { NoticeStore, type Notice } from '@adecore/agents/messages/notice-store';
import { deliverNotice, MESSAGE_WORDS, renderNotice } from './context/notices.ts';
import { ChatStore } from '@adecore/agents/chat/chat-store';
import { BookmarkStore } from '@adecore/agents/chat/bookmark-store';
import { VisualStore } from '@adecore/agents/chat/visual-store';
import { childLauncher, previewVisual, renderCommand, VisualRenderer } from './visuals/renderer.ts';
import type { ServerConfig } from './config.ts';
import { Dispatcher, type ClientAccess } from './dispatcher.ts';
import { readOrCreateEndpointIdentity } from './endpoint-id.ts';
import { SelfUpdater, buildFileOf, readBuildFile } from './service/self-update.ts';
import { childCounter, workOf } from './service/work.ts';
import { KeepAwake, agentsWorking } from './power/keep-awake.ts';
import { ClosedLid } from './power/closed-lid.ts';
import { macClosedLidSystem } from './power/closed-lid-system.ts';
import { MachineUpdates, workEndedByInstall } from './power/machine-update.ts';
import { BUILD, COMPILED as compiled, VERSION } from './version.ts';
import { PAIRING_REMOVED, registerAuthHandlers } from './handlers/auth.ts';
import { registerChatHandlers } from './handlers/chat.ts';
import { continueOn } from './chat/continue-on.ts';
import { chatForkDeps, forkChat, readForkInfo } from './chat/fork.ts';
import { withForkOrigin } from './context/fork-origin.ts';
import { openedChildSource } from './context/opened-child.ts';
import { referencedChats } from './context/chat-references.ts';
import { FS_FILE_PATH, handleFsFileRequest } from './fs/file-route.ts';
import { MachineHome } from './fs/machine-home.ts';
import { FolderWatcher } from './fs/watch.ts';
import { registerBytesHandlers } from './handlers/bytes.ts';
import { registerFsHandlers } from './handlers/fs.ts';
import { readServedFile } from './fs/read.ts';
import { registerGitHandlers } from './handlers/git.ts';
import { registerDiagramHandlers } from './handlers/diagram.ts';
import { registerDatabaseHandlers } from './handlers/database.ts';
import { DatabaseConnectionStore } from './database/connection-store.ts';
import { DatabaseService } from './database/database-service.ts';
import { registerLaunchHandlers } from './handlers/launches.ts';
import { registerLanguageHandlers } from './handlers/language.ts';
import { registerOnDeviceHandlers } from './handlers/ondevice.ts';
import { OnDeviceModel } from './ondevice/model.ts';
import { LanguageHost } from './language/host.ts';
import { NativePolicy, phpLanguageServerCheckout } from './language/native.ts';
import { agentLaunches } from './launches/agent-host.ts';
import { LaunchRunner } from './launches/runner.ts';
import { managerSessions } from './launches/sessions.ts';
import { LaunchStore } from './launches/store.ts';
import { registerDrawingHandlers } from './handlers/drawing.ts';
import { registerProjectHandlers } from './handlers/project.ts';
import { registerServerHandlers } from './handlers/server.ts';
import { readMachineModel } from './machine-model.ts';
import { registerSessionHandlers } from './handlers/session.ts';
import { registerProcessHandlers } from './handlers/processes.ts';
import { registerUsageHandlers } from './handlers/usage.ts';
import { registerProviderAccountHandlers } from './handlers/accounts.ts';
import { registerComputerHandlers } from './handlers/computer.ts';
import { ComputerUse } from './computer/computer-use.ts';
import { ComputerHelper, locateHelperApp } from './computer/helper.ts';
import { ComputerUseStore } from './computer/store.ts';
import { Checkpoints } from './git/checkpoints.ts';
import { GitStatusWatcher } from './git/status-watcher.ts';
import { worktreeAgents } from './git/worktree-agents.ts';
import { worktreeHost } from './git/worktree-host.ts';
import { agentStates } from './agents/agent-state.ts';
import { chatRequests } from '@adecore/agents/tasks/waiting-child';
import { WorktreeMerge } from './git/worktree-merge.ts';
import { Worktrees } from './git/worktrees.ts';
import { foregroundGroup, holdsForeground } from './processes/foreground.ts';
import { ProcessMonitor } from './processes/monitor.ts';
import { createSampler } from './processes/sampler.ts';
import { handleProjectRequest, PROJECTS_PATH } from './projects/icon-route.ts';
import { DiagramStore } from './projects/diagram-store.ts';
import { DrawingStore } from './projects/drawing-store.ts';
import { isTrackedPath } from './git/ignore.ts';
import { ProjectStore } from './projects/project-store.ts';
import { openedAgentCount } from './agents/hidden-agents.ts';
import { dropEmptyMark } from './projects/scratch-project.ts';
import { probeCodexNoDaemon, takesNoteOnLine } from './providers/launch.ts';
import { ModelCatalogFeed } from './providers/model-catalogs.ts';
import { ProviderRegistry } from './providers/registry.ts';
import { ProviderAccountsService } from '@adecore/agents/providers/accounts/service';
import { BunPtyAdapter } from './pty/bun-pty.ts';
import { SessionError, SessionManager } from './sessions/manager.ts';
import { CommandApprovals, commandsSet } from './sessions/command-approvals.ts';
import { ModeApprovals, modesSet, personModeOf } from './sessions/mode-approvals.ts';
import { checkCwd, startCwdGuard } from './canvas/project-paths.ts';
import { SnapshotStore, scheduleSnapshots } from './sessions/snapshot-store.ts';
import { limitAccountsOf, usageAccountsOf, usageRootsOf } from '@adecore/agents/usage/accounts';
import { sessionAccountsOf } from './usage/session-accounts.ts';
import { RUIMTE_ACCOUNTS_HOST } from './providers/accounts-host.ts';
import { RUIMTE_CODEX_CLIENT } from './providers/codex-provider.ts';
import { UsageMonitor } from '@adecore/agents/usage/limits/monitor';
import { UsageService } from '@adecore/agents/usage/usage-service';
import { errorText } from './error-text.ts';
import { BrowserDriver } from './browser/drive.ts';
import { BrowserManager } from './browser/manager.ts';
import { BrowserPages } from './browser/pages.ts';
import { registerBrowserHandlers } from './handlers/browser.ts';
import { handleLiveStreamRequest, LIVE_STREAM_PATH } from './streams/http-stream.ts';
import { DeviceManager } from './devices/manager.ts';
import { DeviceDriver } from './devices/agent-driver.ts';
import { DeviceControl } from './devices/control.ts';
import { IosPhysicalBackend } from './devices/ios-physical.ts';
import { IosSimulatorBackend } from './devices/ios-simulator.ts';
import { createDeviceHelperLauncher } from './devices/helper-source.ts';
import { createPhysicalStreamSourceFactory, physicalStreamHelperPath } from './devices/physical-stream-source.ts';
import { createTreeLauncher, SimulatorTreeReader } from './devices/simulator-tree.ts';
import { AndroidBackend } from './devices/android.ts';
import { ScrcpyServerFile, scrcpyServerDirectory } from './devices/scrcpy-server.ts';
import { adbScrcpyHost, ScrcpySource } from './devices/scrcpy-source.ts';
import { registerDeviceControlHandlers, registerDeviceHandlers } from './handlers/device.ts';
import { LiveStreamHub } from './streams/live-stream.ts';

// What `ruimte login` has the machine sign; local secret only, like the work.
const MACHINE_LINK_PATH = '/machine/link-request';
const MACHINE_REGISTRATION_PATH = '/machine/registration';
// What `ruimte logout` asks: the machine leaves its account, as `endpoint.leaveAccount` does for the app.
const MACHINE_LEAVE_ACCOUNT_PATH = '/machine/leave-account';
// Where a client of before account-only paired and signed for a ticket over HTTP; each answers that pairing links are gone.
const LEGACY_PAIRING_PATHS = new Set(['/auth/pair', '/auth/pairing-token', '/auth/challenge', '/auth/ticket']);
const RegistrationRequestSchema = z.object({ accountId: AccountSchema.shape.id });

// Past anything a hook or a verb sends, a visual of 16 MiB with its JSON escaping included, and the ceiling on what an unauthenticated request can make the daemon buffer.
const MAX_REQUEST_BODY_BYTES = 24 * 1024 * 1024;

// Inside a `bun build --compile` binary the sources live on a virtual file system, so paths next to the source mean nothing.

/* Runs the daemon until a signal ends the process. */
export async function startDaemon(config: ServerConfig): Promise<void> {
    // `ruimte-context` lives next to the binary, or next to the source in dev; it goes on the PATH of every shell and chat.
    const binDir = compiled ? dirname(process.execPath) : resolve(import.meta.dir, '..', 'bin');
    const contextUrl = `http://127.0.0.1:${config.port}${CONTEXT_PATH}`;

    // `--label` and `RUIMTE_LABEL` are the name a machine nobody has named yet answers to; a name
    // typed in a client wins over both, or renaming from another machine would not survive a restart.
    const identity = await readOrCreateEndpointIdentity(config.home, config.label);
    const auth = new AuthStore(config.home);
    const handshake = new Handshake(auth, identity);
    const access = { localSecret: await readOrCreateLocalSecret(config.home), tickets: handshake };

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
    await restartBackgroundLimits(outbox, Date.now());
    // And for the tasks a chat gave, whose results still have to wake it.
    const tasks = new TaskStore(config.home);
    await tasks.load();
    // And for the commands a person let a terminal type, which a node's first start asks about.
    const commandApprovals = new CommandApprovals(config.home);
    await commandApprovals.load();
    // And for the mode a person gave each terminal agent, which an edit of the project file cannot widen.
    const modeApprovals = new ModeApprovals(config.home);
    await modeApprovals.load();
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
    /* What a terminal's agent hears the moment it can: taken here, so whichever channel gets there first
       is the only one that delivers it. */
    const messagesFor = (targetId: string): string[] => notices.take(targetId).map(renderNotice);
    const providers = new ProviderRegistry({ appleEnabled: () => identity.appleFoundationEnabled, onList: () => void modelCatalogs.refresh() });
    const modelCatalogs = new ModelCatalogFeed({
        home: config.home,
        allowFetch: config.modelFetch,
        catalogs: { claude: providers.catalogFor('claude'), codex: providers.catalogFor('codex') }
    });
    await modelCatalogs.load();
    void modelCatalogs.refresh();
    // Before the managers, which start every CLI under the account its node or chat names.
    const providerAccounts = new ProviderAccountsService({
        home: config.home,
        host: RUIMTE_ACCOUNTS_HOST,
        client: RUIMTE_CODEX_CLIENT,
        providers,
        install: config.installHooks
            ? async (kind, folder) => {
                  for (const { path, result } of await installInFolder(kind, folder)) {
                      if (result === 'written') {
                          console.log(`Installed ${kind} status hooks in ${path}`);
                      }
                  }
              }
            : undefined
    });
    await providerAccounts.load();
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
        computerUse: () => computer.usable,
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
        personMode: (sessionId) => {
            const folder = folderOf(sessionId);
            return personModeOf(folder === null ? null : modeApprovals.modeOf(folder, sessionId), chats.composerPreferences.terminalMode());
        },
        checkCwd: startCwd,
        claudeTitles,
        codexTitles: new CodexTitleReader(),
        accounts: providerAccounts,
        preferredAccount: (kind) => chats.composerPreferences.for(kind).account
    });
    const snapshotSchedule = scheduleSnapshots(manager, snapshots);
    void probeCodexNoDaemon();
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
        referenced: (targetId) => referencedChats(chats.get(targetId)?.thread.list() ?? [], (id) => projects.index.chatTitleBeside(targetId, id)),
        opened: (targetId, sourceId) =>
            openedChildSource(targetId, sourceId, { startedBy: (id) => lineage.startedBy(id), agentSource: (id) => projects.index.agentSource(id) }),
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
    const visuals = new VisualStore(config.home, attachments);
    const chats: ChatManager = new ChatManager({
        providers,
        store: new ChatStore(config.home, { attachments, isSidecar: isPlanFileName }),
        attachments,
        checkpoints,
        contextUrl,
        binDir,
        depthOf: (chatId) => lineage.depthOf(chatId),
        computer: () => computer.usable,
        visualReplies: () => identity.visualReplies,
        modeCeiling: (chatId) => lineage.ceilingOf(chatId),
        checkCwd: startCwd,
        contextSources: (chatId) => context.list(chatId),
        chatTitle: (chatId, id) => projects.index.chatTitleBeside(chatId, id),
        standalone: (chatId) => projects.index.locate(chatId)?.canvasId === null,
        inlineChat: (chatId) => projects.index.isHiddenChat(chatId),
        openingSelection: (chatId, provider) => {
            const entry = outbox.list().find((entry) => entry.kind === 'start-agent' && entry.target === chatId);
            return entry?.kind === 'start-agent' && entry.payload.provider === provider ? entry.payload.selection : undefined;
        },
        messageNotes: (chatId) => new NoticeNotes(notices, chatId, MESSAGE_WORDS),
        // The other reader: what a chat has to show a person in its thread, which is never taken from the model.
        unshownMessages: (chatId) => unshownNotes(notices, chatId, MESSAGE_WORDS),
        firstPrompt: (chatId) => prompts.take(chatId),
        // A turn reports what is left of its plan in passing; that belongs to the machine's numbers.
        onLimits: (update) => limits.applyLive(update),
        claudeTitles,
        // One one-shot call per Codex chat, on whichever CLI here answers a single prompt.
        nameChat: (provider, input) => suggestChatTitle(providers, provider, input),
        onInterruptedRun: outboxLink.onInterruptedRun,
        taskRows: (chatId) => tasks.ofParent(chatId),
        dropWakes: (chatId) => tasks.dropWake(chatId),
        endChildren: (chatId) => endChildren.stopNode(chatId, 'a person cleared this chat'),
        endedAt: (chatId) => lineage.endedAt(chatId),
        plans,
        bookmarks,
        visuals,
        limitResume: {
            allowed: () => identity.resumeAtReset,
            now: () => Date.now(),
            owe: (chatId, turnId, at) => outboxLink.oweLimitResume(chatId, turnId, at),
            lapse: (chatId) => outboxLink.lapseLimitResume(chatId),
            owed: (chatId) => outboxLink.owesLimitResume(chatId)
        },
        accounts: providerAccounts
    });
    const projects = new ProjectStore(config.home);
    await projects.hiddenAgents.load();
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
        checkCwd: startCwd,
        resumeAtReset: () => identity.resumeAtReset
    });
    const outboxWorker = outboxWiring.worker;
    const taskWiring = outboxWiring.tasks;
    const endChildren = outboxWiring.endChildren;
    const summaries = outboxWiring.summaries;
    const snoozes = new SnoozeStore({ path: join(config.home, 'snoozes.json') });
    projects.index.onPlaces = (projectId, ids) => {
        outboxWiring.places(projectId, ids);
        snoozes.places(projectId, ids);
    };
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
        for (const { nodeId, mode } of modesSet(before, after)) {
            // Not written down narrows the node to the mode its person picks for new terminals, which is safe to retry.
            await modeApprovals.approve(folder, nodeId, mode).catch((e: unknown) => console.error(`Approving the mode of ${nodeId} failed:`, errorText(e)));
        }
    });
    const drawings = new DrawingStore(projects);
    projects.attachDrawings(drawings);
    const diagrams = new DiagramStore(projects);
    projects.attachDiagrams(diagrams);
    const launchStore = new LaunchStore({
        projects: { folderOf: (projectId) => projects.index.folderOf(projectId), worktreePaths: (folder) => canvasHost.worktreePaths(folder) },
        approvals: commandApprovals
    });
    const launches = new LaunchRunner({
        store: launchStore,
        sessions: managerSessions(manager, foregroundGroup),
        checkCwd: (folder, cwd) => checkCwd(folder, cwd, (inside) => canvasHost.worktreePaths(inside))
    });
    projects.attachLaunches({
        opened: (projectId) => void launches.opened(projectId),
        running: (projectId) => launches.running(projectId),
        end: (projectId) => launches.end(projectId)
    });
    // Before the socket answers, so an agent whose project nobody opened since the restart still reads its links.
    await projects.warmIndex();
    const folders = new FolderWatcher();
    const liveStreams = new LiveStreamHub();
    const browsers = BrowserManager.withBun(config.home, liveStreams);
    // The pages the clients draw themselves, which this machine can only reach by asking them.
    const browserPages = new BrowserPages();
    const browserDriver = new BrowserDriver(config.home, browsers, browserPages);
    const deviceHelperCommand = compiled ? [process.execPath, 'device-helper'] : [process.execPath, resolve(import.meta.dir, 'main.ts'), 'device-helper'];
    // Visuals are rendered in children with a Chrome of their own, never in the one above, whose profile holds a person's cookies.
    const visualRenderer = new VisualRenderer(childLauncher(renderCommand(compiled, process.execPath, process.execArgv, import.meta.dir)));
    const deviceBridge = physicalStreamHelperPath(compiled, process.execPath, resolve(import.meta.dir, '../..'));
    const physicalStreamSource = createPhysicalStreamSourceFactory(deviceBridge);
    const treeLauncher = createTreeLauncher(deviceBridge);
    // A development checkout fetches the pinned screen server on first use; a build carries it.
    const scrcpyServer = new ScrcpyServerFile(scrcpyServerDirectory(compiled, process.execPath, resolve(import.meta.dir, '..')), !compiled);
    const android = new AndroidBackend({
        createSource: scrcpyServer.available ? (adb, serial) => new ScrcpySource(adbScrcpyHost(adb, serial), () => scrcpyServer.path()) : null
    });
    const devices = new DeviceManager(
        process.platform === 'darwin'
            ? [
                  new IosSimulatorBackend(
                      undefined,
                      createDeviceHelperLauncher(deviceHelperCommand),
                      undefined,
                      treeLauncher === null ? null : (udid) => new SimulatorTreeReader(udid, treeLauncher)
                  ),
                  new IosPhysicalBackend(undefined, undefined, physicalStreamSource),
                  android
              ]
            : process.platform === 'linux'
              ? [android]
              : [],
        liveStreams
    );
    const deviceControl = new DeviceControl();
    const deviceDriver = new DeviceDriver({ home: config.home, manager: devices, gate: deviceControl });
    const statuses = new GitStatusWatcher();
    const nameOfCli = (kind: AgentKind): string => providers.get(kind).name;
    const usage = new UsageService({
        home: config.home,
        allowPriceFetch: config.priceFetch,
        knownProjects: () => projects.known(),
        roots: () => usageRootsOf(providerAccounts),
        sessionAccounts: () =>
            sessionAccountsOf(
                chats.list(),
                manager.list().map(({ sessionId }) => ({ agent: manager.get(sessionId)?.agent ?? null, launch: manager.get(sessionId)?.launch ?? null }))
            ),
        accounts: () => usageAccountsOf(providerAccounts, nameOfCli)
    });
    const limits = new UsageMonitor({ providers, accounts: limitAccountsOf(providerAccounts, nameOfCli, process.env), client: RUIMTE_CODEX_CLIENT });
    providerAccounts.listen(() => limits.accountsChanged());
    const sampler = await createSampler(process.platform, config.home);
    const processes = new ProcessMonitor({
        sampler,
        sessions: () =>
            manager.list().map((session) => ({
                id: session.sessionId,
                pid: session.pid,
                exited: session.exited,
                agent: session.agent ?? null,
                label: launches.labelOf(session.sessionId) ?? manager.labelOf(session.sessionId) ?? undefined
            })),
        chats: () => chats.processTargets(),
        contextUrl: () => manager.contextUrl,
        projectOf: (nodeId) => projects.index.locate(nodeId)?.projectId ?? null,
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
        const sessions = manager.list().map((session) => ({ ...session, launch: launches.labelOf(session.sessionId) !== null }));
        return workOf({ sessions, chats: chats.list(), children });
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
            taskWiring.terminals.ended(sessionId);
        }
    };
    manager.isAgentGone = (sessionId) => processes.isAgentGone(sessionId);
    manager.holdsForeground = holdsForeground;

    const worktrees = new Worktrees(config.home);
    const merges = new WorktreeMerge(
        worktrees,
        worktreeAgents({ chats: () => chats.list(), sessions: () => manager.list(), stopNode: (nodeId, reason) => endChildren.stopNode(nodeId, reason) })
    );
    const modes = {
        chatMode: (id: string) => chats.get(id)?.info.runtimeMode,
        launch: (id: string) => manager.get(id)?.launch,
        reportedMode: (id: string) => manager.get(id)?.reportedMode,
        ceiling: (id: string) => lineage.ceilingOf(id)
    };
    /* Where a message a person has not seen goes: the thread of the chat left under that node id. */
    const noticeChat = {
        has: (id: string) => chats.hasStored(id),
        note: (id: string, text: string) => chats.addNote(id, 'info', text)
    };
    const canvasHost = {
        hiddenAgents: projects.hiddenAgents,
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
        accountOf: nodeAccount({ chat: (id) => chats.get(id)?.info, session: (id) => manager.get(id) }),
        terminalModePreference: () => chats.composerPreferences.terminalMode(),
        branchesOf: (folder: string) => worktrees.branches(folder).catch(() => null),
        addWorktree: (folder: string, want: WorktreeWant, projectId: string) => addWanted(worktrees, folder, want, projectId),
        claimWorktree: (folder: string, path: string, nodeId: string) => worktrees.claim(folder, path, nodeId),
        removeWorktree: (folder: string, path: string) => worktrees.remove(folder, path),
        worktrees: worktreeHost(worktrees, merges),
        browsers: browserDriver,
        devices: deviceDriver,
        agents: agentStates({ outbox, lineage, chats, sessions: manager }),
        requests: chatRequests(chats),
        computer,
        launches: agentLaunches(launchStore, launches, (sessionId) => manager.get(sessionId)?.plainText() ?? Promise.resolve(null)),
        visuals: {
            enabled: () => identity.visualReplies,
            publish: (chatId: string, input: { title: string; html: string; maxHeight?: number; heights?: VisualHeight[] }) =>
                chats.publishVisual(chatId, input),
            list: (chatId: string) => chats.listVisuals(chatId),
            remove: (chatId: string, visualId: string) => chats.removeVisual(chatId, visualId),
            preview: (input: { html: string; width: number; appearance: VisualAppearance }) => previewVisual(visualRenderer, config.home, input),
            measure: (html: string) => visualRenderer.measure(html)
        },
        context: {
            list: (targetId: string) => context.list(targetId),
            read: (targetId: string, sourceId: string, tail: number | null, subagent: string | null) => context.answer(targetId, sourceId, tail, subagent)
        },
        depthOf: (nodeId: string) => lineage.depthOf(nodeId),
        openedCount: (callerId: string) =>
            openedAgentCount({ lineage, hiddenAgents: projects.hiddenAgents, tasks, outbox, chats, sessions: manager }, callerId),
        recordMade: (record: { projectId: string; nodeId: string; openedBy: string; depth: number; agent: boolean; ceiling?: RuntimeMode }) =>
            lineage.put(record),
        madeBy: (nodeId: string) => lineage.madeBy(nodeId),
        agentsDeleteAnyView: () => identity.agentsDeleteAnyView,
        showView: (projectId: string, viewId: string, by: string) => projects.showView(projectId, viewId, by),
        writeDiagram: (projectId: string, viewId: string, content: DiagramContent) => diagrams.write(projectId, viewId, content),
        tasks: taskWiring.host,
        plans,
        endSession,
        alert: (nodeId: string, text: string) => {
            const place = projects.index.locate(nodeId);
            if (!place) {
                throw new Error('The notifying session is no longer in a project');
            }
            push.notify(chats.get(nodeId) ? 'chat' : 'terminal', nodeId, projects.index.titleFor(nodeId) ?? 'Agent', text, {
                projectId: place.projectId,
                viewId: place.canvasId ?? nodeId
            });
        },
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
                    ...chatNoticeTargets(chats)
                },
                notice
            );
            /* A chat shows it to a person the moment it lands. Never in the way of the answer to the
               sender: the message is in the queue by now, so the model hears it whatever a thread does. */
            await showNotices(notices, noticeChat, MESSAGE_WORDS, notice.targetId).catch((e) =>
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
        projectOf: (nodeId) => projects.index.locate(nodeId)?.projectId ?? null,
        targetOf: (nodeId) => (chats.get(nodeId) ? 'chat' : 'terminal'),
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
        onError: (error) => console.error('Push delivery failed:', errorText(error)),
        snoozes
    });
    manager.observe((event) => push.consume(event));
    manager.observe((event) => taskWiring.terminals.sessionEvent(event));
    chats.observe((event) => push.consume(event));
    processes.observeAlerts((alerts) => push.processAlerts(alerts));
    // Held by the daemon, so the machine stays awake with no window open and for a daemon from npm.
    const keepAwake = new KeepAwake({
        platform: process.platform,
        pid: process.pid,
        setting: () => identity.keepAwake,
        work: () => ({ sessions: manager.list(), chats: chats.list() }),
        spawn: (command) => Bun.spawn(command, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }),
        log: (line) => console.log(line)
    });
    const uid = process.getuid?.() ?? -1;
    // Beside the block, for a closed lid; it never holds root, only a sudoers rule a person installed.
    const closedLid = new ClosedLid({
        platform: process.platform,
        uid,
        user: userInfo().username,
        setting: () => identity.keepAwake,
        working: () => agentsWorking({ sessions: manager.list(), chats: chats.list() }),
        system: macClosedLidSystem(config.home, uid),
        // A rule that went takes the switch with it, so a new rule never turns sleep off on a choice made before it.
        ruleChanged: (present) => {
            if (!present && identity.keepAwake.lidClosed) {
                void identity
                    .setSwitches({ keepAwakeLidClosed: false })
                    .catch((e: unknown) => console.error('Turning the closed-lid switch off failed:', errorText(e)));
                return;
            }
            identity.announce();
        },
        log: (line) => console.log(line)
    });
    identity.attachClosedLid({ describe: () => ({ keepAwakeLidRule: closedLid.ruleInstalled }) });
    const checkAwake = (): void => {
        keepAwake.check();
        closedLid.check();
    };
    manager.observe((event) => {
        if (event.event === 'session.status' || event.event === 'session.exit' || event.event === 'session.list-changed') {
            checkAwake();
        }
    });
    chats.observe((event) => {
        if (event.event === 'chat.event' && (event.payload.event.type === 'info' || event.payload.event.type === 'reset')) {
            checkAwake();
        }
    });
    const updates = new MachineUpdates();
    manager.observe((event) => computer.observe(event));
    chats.observe((event) => computer.observe(event));
    chats.observe((event) => {
        if (event.event === 'chat.event' && event.payload.event.type === 'item' && event.payload.event.item.kind === 'user') {
            dropEmptyMark(projects, event.payload.chatId).catch((e: unknown) => console.error('Listing a written chat failed:', errorText(e)));
        }
    });

    const dispatcher = new Dispatcher();
    registerPushHandlers(dispatcher, auth, () => push.synchronizeActivities(), push);
    registerSnoozeHandlers(dispatcher, snoozes, (nodeId) => projects.index.locate(nodeId));
    registerServerHandlers(dispatcher, { version: VERSION, home: config.home, model: await readMachineModel() });
    registerSessionHandlers(dispatcher, manager, endChildren.owe, { commandOf: (kind) => providers.get(kind).home?.loginCommand, nameOf: nameOfCli });
    registerBrowserHandlers(dispatcher, browsers, browserPages, () => identity.streamingAllowed);
    registerDeviceHandlers(dispatcher, devices, () => identity.streamingAllowed);
    registerDeviceControlHandlers(dispatcher, deviceControl);
    const forkDeps = chatForkDeps({ chats, host: canvasHost, titleFor: (id) => projects.index.titleFor(id), lineage, worktrees, checkpoints });
    const beforeChatKill = (chatId: string): Promise<unknown> => {
        computer.nodeClosed(chatId);
        return endChildren.owe(chatId);
    };
    registerChatHandlers(dispatcher, chats, providers, beforeChatKill, endChildren.stopNode, {
        fork: (payload) => forkChat(forkDeps, payload),
        info: (payload) => readForkInfo(forkDeps, payload),
        summarize: (chatId) => summaries.summarize(chatId),
        continueOn: (payload) => continueOn({ chats, fork: (fork) => forkChat(forkDeps, fork) }, payload)
    });
    registerTaskHandlers(dispatcher, tasks, endChildren.children);
    registerPlanHandlers(dispatcher, plans);
    registerProjectHandlers(dispatcher, projects, async (chatId) => (await chats.readChat(chatId))?.items.some((item) => item.kind === 'user') ?? false, {
        start: (payload) => chats.create(payload),
        // Loaded first: a chat nobody opened since a restart has no session to end, only a record to remove.
        end: async (chatId) => {
            await chats.create({ chatId }).catch(() => undefined);
            await endSession('chat', chatId);
        },
        worktreePaths: (folder) => canvasHost.worktreePaths(folder)
    });
    registerDrawingHandlers(dispatcher, drawings);
    registerDiagramHandlers(dispatcher, diagrams);
    registerLaunchHandlers(dispatcher, launchStore, launches);
    // Revoking must take effect now, not at the next connection, so a session's sockets and channels close here.
    const disconnectSession = (sessionId: string): void => {
        handshake.revoke(sessionId);
        for (const { channel, connection } of [...connections.values(), ...directConnections]) {
            if (connection.client.access?.sessionId === sessionId) {
                channel.close(4001, 'Access revoked');
            }
        }
    };
    registerAuthHandlers(dispatcher, auth, {
        identity,
        version: VERSION,
        broker: () => brokerSwitch.describe(),
        lanDoor: () => describeLanDoor(),
        streamingChanged: (allowed) => {
            if (!allowed) {
                browsers.closeAll();
                devices.closeAll();
            }
        },
        appleFoundationChanged: async (on) => {
            providers.invalidate('apple');
            if (!on) {
                await Promise.all(
                    chats
                        .list()
                        .filter((chat) => chat.provider === 'apple')
                        .map((chat) => chats.stop(chat.chatId, 'Apple Foundation Models was turned off in Settings.'))
                );
            }
            await providerAccounts.refresh();
        },
        keepAwake: { available: keepAwake.available, changed: checkAwake },
        closedLid: {
            available: closedLid.available,
            rule: () => closedLid.refreshRule(),
            setRule: (install, prompt) => closedLid.setRule(install, prompt)
        },
        updates: {
            state: () => updates.state(),
            report: (clientId, report) => updates.report(clientId, report),
            requestInstall: () => updates.requestInstall(),
            ending: () => workEndedByInstall(config.underService, machineWork())
        },
        resumeChanged: (on) => {
            chats.resumeSettingChanged();
            // A chat nobody loaded owes a resume only on disk, so turning the switch off drops those there.
            if (!on) {
                void outboxLink.lapseLimitResume().catch((e: unknown) => console.error('Dropping the resumes after a limit failed:', errorText(e)));
            }
        },
        disconnect: disconnectSession
    });
    const machineHome = new MachineHome(config.home);
    const language = new LanguageHost({
        root: join(config.home, 'language-servers'),
        folderOf: (projectId) => projects.index.folderOf(projectId),
        holders: (projectId) => projects.holdersOf(projectId),
        machineHome,
        // A compiled daemon ignores local PHP sources and installs the pinned native release.
        native: new NativePolicy({ checkout: phpLanguageServerCheckout(compiled) })
    });
    await language.load();
    projects.attachLanguage(language);
    registerLanguageHandlers(dispatcher, language);
    const onDevice = new OnDeviceModel();
    registerOnDeviceHandlers(dispatcher, onDevice);
    const provenance = new ProvenanceService({
        home: config.home,
        locate: (chatId) => projects.index.locate(chatId),
        folderOf: (projectId) => projects.index.folderOf(projectId),
        holders: (projectId) => projects.holdersOf(projectId),
        chat: (chatId) => provenanceChat(chats, chatId)
    });
    chats.observe((event) => provenance.consume(event));
    projects.attachProvenance(provenance);
    registerProvenanceHandlers(dispatcher, provenance, machineHome);
    const databases = new DatabaseService({ machineHome });
    const databaseConnections = new DatabaseConnectionStore({
        projects: { folderOf: (projectId) => projects.index.folderOf(projectId), holdersOf: (projectId) => projects.holdersOf(projectId) }
    });
    projects.attachDatabases(databaseConnections);
    registerDatabaseHandlers(dispatcher, databases, databaseConnections);
    registerFsHandlers(
        dispatcher,
        folders,
        async (clientId) => ({
            folders: await projects.heldFolders(clientId),
            worktreesOf: canvasHost.worktreePaths,
            worktreesRoot: worktrees.root
        }),
        machineHome,
        language
    );
    registerBytesHandlers(
        dispatcher,
        {
            attachment: (chatId, id) => chats.findAttachment(chatId, id),
            projectIcon: (projectId, theme) => projects.iconFile(projectId, theme),
            file: readServedFile
        },
        machineHome
    );
    registerUsageHandlers(dispatcher, usage, limits);
    registerProviderAccountHandlers(dispatcher, providerAccounts);
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
        machinePublicKey: identity.publicKey,
        trustedKeys: statementKeys,
        store: auth
    });
    // One gate for the broker and the door on the local network, so an attempt belongs to the key that offered it on both.
    const gate = new SignalGate({
        publicKey: identity.publicKey,
        isPaired: async (publicKey) => (await auth.sessionForPublicKey(publicKey)) !== null,
        admitStatement: (publicKey, statementAccess) => statements.admit(publicKey, statementAccess),
        receive: (envelope, reply) => peers.receive(envelope, reply)
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
                gate
            })
    });
    identity.attachBroker(brokerSwitch);
    const relay: Relay = brokerSwitch;

    /* The door on the local network, open unless a person closed it or `--no-lan` keeps it closed. The
       addresses are read per answer, so a machine that moved to another network says so without a timer. */
    const lanDoor = new LanDoor({
        port: config.lanPort,
        identity: { machineId: identity.id, publicKey: identity.publicKey, sign: (message) => identity.sign(message) },
        gate
    });
    const lanDoorWanted = (): boolean => !config.lanDoorOff && identity.lanDoor;
    const describeLanDoor = () => {
        const port = lanDoor.port;
        return { lan: port === null ? null : { port, addresses: lanAddresses() }, lanDoorFixed: config.lanDoorOff };
    };
    identity.attachLanDoor({
        apply: () => {
            if (lanDoorWanted()) {
                lanDoor.start();
            } else {
                lanDoor.stop();
            }
        },
        describe: describeLanDoor
    });

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
        snoozes,
        sessions: manager,
        chats,
        browsers,
        browserPages,
        devices,
        deviceControl,
        identity,
        updates,
        projects,
        drawings,
        diagrams,
        launchStore,
        launches,
        databases,
        databaseConnections,
        language,
        folders,
        statuses,
        usage,
        limits,
        providerAccounts,
        processes,
        tasks,
        worktrees,
        plans,
        provenance,
        computer
    });

    type SocketData = ClientAccess & { protocolRefused: boolean; ticket: string | null };

    // Every HTTP route and the upgrade, before the cross-origin headers the desktop app's page needs.
    const route = async (request: Request, server: Server<SocketData>): Promise<Response | undefined> => {
        const url = new URL(request.url);
        const remote = server.requestIP(request)?.address ?? '';

        if (url.pathname === MACHINE_HEALTH_PATH) {
            if (request.method !== 'GET') {
                return new Response('Method not allowed', { status: 405 });
            }
            return Response.json({ ok: true, version: VERSION, build: BUILD, service: config.underService } satisfies HealthResult);
        }

        if (url.pathname === MACHINE_PROOF_PATH) {
            return handleLocalProofRequest(request, { localSecret: access.localSecret, port: server.port ?? config.port });
        }

        // todo(bas): drop with `PAIRING_REMOVED` one release after pairing links went.
        if (LEGACY_PAIRING_PATHS.has(url.pathname)) {
            return new Response(PAIRING_REMOVED, { status: 410 });
        }

        if (url.pathname === '/auth/local-ticket') {
            return handleLocalTicketRequest(request, access, handshake);
        }

        if (url.pathname === MACHINE_WORK_PATH) {
            // Only for the local secret: the desktop app asks before it restarts the service, and nobody else needs to know.
            if (request.method !== 'GET') {
                return new Response('Method not allowed', { status: 405 });
            }
            const decision = await decideAccess(request, remote, access, 'local');
            if (!decision.ok || decision.access.sessionId !== null) {
                return new Response('Forbidden', { status: 403 });
            }
            return Response.json(machineWork());
        }

        if (url.pathname === MACHINE_LEAVE_ACCOUNT_PATH) {
            if (request.method !== 'POST') {
                return new Response('Method not allowed', { status: 405 });
            }
            const decision = await decideAccess(request, remote, access, 'local');
            if (!decision.ok || !isOwner(decision.access)) {
                return new Response('Forbidden', { status: 403 });
            }
            const revoked = await auth.leaveAccount();
            revoked.forEach(disconnectSession);
            return Response.json({ revoked: revoked.length });
        }

        if (url.pathname === MACHINE_STATUS_PATH) {
            // `ruimte status` on the local secret; a client sees the same through `endpoint.info`.
            if (request.method !== 'GET') {
                return new Response('Method not allowed', { status: 405 });
            }
            const decision = await decideAccess(request, remote, access, 'local');
            if (!decision.ok || !isOwner(decision.access)) {
                return new Response('Forbidden', { status: 403 });
            }
            const binding = await auth.accountBinding();
            return Response.json({
                version: VERSION,
                service: config.underService,
                label: identity.label,
                onAccount: binding !== undefined && binding !== null,
                broker: { url: brokerSwitch.describe().brokerUrl, connected: brokerSwitch.isReady },
                ...describeLanDoor(),
                keepAwake: {
                    mode: identity.keepAwake.mode,
                    onBattery: identity.keepAwake.onBattery,
                    holding: keepAwake.holding,
                    lid: closedLid.available ? { on: identity.keepAwake.lidClosed, rule: await closedLid.refreshRule(), holding: closedLid.holding } : null
                }
            } satisfies MachineStatus);
        }

        if (url.pathname === MACHINE_LINK_PATH || url.pathname === MACHINE_REGISTRATION_PATH) {
            // `ruimte login` on the local secret: the machine signs, the terminal talks to the address book.
            if (request.method !== 'POST') {
                return new Response('Method not allowed', { status: 405 });
            }
            const decision = await decideAccess(request, remote, access, 'local');
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
            try {
                return Response.json(await signForAccount(auth, identity, brokerUrl, parsed.data.accountId, disconnectSession));
            } catch (e) {
                if (e instanceof MachineAccountError) {
                    return Response.json({ code: e.code, message: e.message }, { status: 409 });
                }
                throw e;
            }
        }

        if (url.pathname === '/ws') {
            const decision = await decideAccess(request, remote, access, 'socket');
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
            return handleAttachmentRequest(request, url, remote, access, (chatId, id) => chats.findAttachment(chatId, id));
        }

        if (url.pathname.startsWith(`${PROJECTS_PATH}/`)) {
            return handleProjectRequest(request, url, remote, access, projects);
        }

        if (url.pathname === FS_FILE_PATH) {
            return handleFsFileRequest(request, url, remote, access, machineHome);
        }

        if (url.pathname.startsWith(`${LIVE_STREAM_PATH}/`)) {
            return handleLiveStreamRequest(request, url, remote, access, liveStreams, () => identity.streamingAllowed);
        }

        if (url.pathname.startsWith(`${HOOKS_PATH}/`)) {
            return handleHookRequest(request, url.pathname, manager, (token, event, kind) => {
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
                    computer: computer.usable
                });
            });
        }

        if (url.pathname.startsWith(`${CANVAS_PATH}/`)) {
            server.timeout(request, CANVAS_REQUEST_TIMEOUT_S);
            return handleCanvasRequest(request, url.pathname, { targetForToken, host: canvasHost });
        }

        if (url.pathname === CONTEXT_PATH || url.pathname.startsWith(`${CONTEXT_PATH}/`)) {
            return handleContextRequest(request, url.pathname, { targetForToken, host: canvasHost });
        }

        return new Response('Not found', { status: 404 });
    };

    const server = Bun.serve<SocketData>({
        hostname: config.host,
        port: config.port,
        maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
        async fetch(request, server) {
            const cors = crossOriginHeaders(request);
            if (cors !== null && request.method === 'OPTIONS') {
                return new Response(null, { status: 204, headers: preflightHeaders(cors) });
            }
            const response = await route(request, server);
            return cors === null || response === undefined ? response : withHeaders(response, cors);
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
    providerAccounts.start();
    processes.start();

    // Hooks and context always go over loopback, whatever interface the socket listens on.
    manager.hookUrl = `http://127.0.0.1:${server.port}${HOOKS_PATH}`;
    manager.contextUrl = `http://127.0.0.1:${server.port}${CONTEXT_PATH}`;
    // Only once `hookUrl` is set: a terminal the worker starts before that runs without hooks for good.
    await taskWiring.recover();
    outboxWorker.start();
    endChildren.start();
    // Beside the daemon answering: a turn a restart interrupted is taken up again without waiting for a client.
    void chats.recoverInterrupted().catch((e) => console.error('Resuming interrupted turns failed:', errorText(e)));

    void relay.publish({ host: config.host, port: server.port ?? config.port });

    let shuttingDown = false;
    const shutdown = async (reason: string): Promise<void> => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        console.log(`ruimte server stopping for ${reason}, writing snapshots`);
        selfUpdate.stop();
        keepAwake.stop();
        closedLid.stop();
        snoozes.stop();
        outboxWorker.stop();
        taskWiring.coordinator.stop();
        taskWiring.waiting.stop();
        summaries.coordinator.stop();
        snapshotSchedule.stop();
        usage.stop();
        limits.stop();
        providerAccounts.stop();
        processes.stop();
        // Before anything is awaited: a `bun --watch` reload restarts the module during the first
        // await, so a turn in flight would otherwise never reach its file.
        chats.persistAllSync();
        // Each on its own: a step that fails must not keep the chats' CLIs, and what they started, running past the daemon.
        const step = async (what: string, run: () => Promise<void>): Promise<void> => {
            try {
                await run();
            } catch (e) {
                console.error(`${what} on shutdown failed:`, errorText(e));
            }
        };
        await step('Settling tasks', () => taskWiring.coordinator.settled());
        await step('Writing terminal snapshots', () => snapshotSchedule.flush());
        await step('Writing chats', () => chats.shutdown());
        await computer.stop();
        manager.killAll();
        browsers.closeAll();
        await step('Stopping visual previews', () => visualRenderer.stop());
        deviceDriver.releaseAll();
        deviceControl.stop();
        devices.closeAll();
        projects.closeAll();
        drawings.closeAll();
        diagrams.closeAll();
        launches.close();
        launchStore.closeAll();
        databaseConnections.closeAll();
        await step('Stopping the database helper', () => databases.dispose());
        await step('Stopping language servers', () => language.close());
        await step('Stopping the on-device helper', () => onDevice.dispose());
        peers.closeAll();
        lanDoor.stop();
        await relay.stop();
        server.stop(true);
        process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    selfUpdate.start();
    // `always` holds from the start, before any agent has moved.
    keepAwake.check();
    // Puts back what a daemon before this one left, and only then decides for the lid.
    void closedLid.start();

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
    // After the greeting, so a person who just ran `npx ruimte` reads what runs before where it is reachable.
    if (lanDoorWanted()) {
        lanDoor.start();
    }
}

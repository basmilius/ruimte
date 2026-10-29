import { AgentLineageStore, NoticeNotes, NoticeStore, TaskStore, restartBackgroundLimits, unshownNotes } from '@adecore/agents/coordination';
import { AttachmentStore, BookmarkStore, ChatStore, ClaudeTitleReader, VisualStore, suggestChatTitle } from '@adecore/agents/chat';
import { AgentStore } from '../agents/agent-store.ts';
import { CodexTitleReader } from '../agents/codex-title.ts';
import { PendingPromptStore } from '../agents/pending-prompts.ts';
import { startCwdGuard } from '../canvas/project-paths.ts';
import { ChatManager } from '../chat/chat-manager.ts';
import { ruimteUiSources } from '../chat/ui-sources.ts';
import { restartConnectPeers } from '../remote/connect-peer.ts';
import { OneShotPlace } from '../peering/one-shot-place.ts';
import { projectAccountChooser } from '../projects/project-accounts.ts';
import { ProjectProposals } from '../projects/project-proposals.ts';
import { UntrustedFolders } from '../peering/untrusted.ts';
import type { ComputerUse } from '../computer/computer-use.ts';
import { ComputerUseStore } from '../computer/store.ts';
import { referenced } from '../context/references.ts';
import { ContextStore } from '../context/context-store.ts';
import { withForkOrigin } from '../context/fork-origin.ts';
import { MESSAGE_WORDS, renderNotice } from '../context/notices.ts';
import { openedChildSource } from '../context/opened-child.ts';
import { hasDatabaseConnections } from '../database/connection-store.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import { Checkpoints } from '../git/checkpoints.ts';
import { readLog } from '../git/log.ts';
import { OutboxStore } from '../outbox/outbox.ts';
import { agentChatOpening } from '../outbox/start-agent.ts';
import { OutboxLink } from '../outbox/wiring.ts';
import { isPlanFileName, PlanStore } from '../plans/plan-store.ts';
import { BunPtyAdapter } from '../pty/bun-pty.ts';
import { CommandApprovals } from '../sessions/command-approvals.ts';
import { SessionError, SessionManager } from '../sessions/manager.ts';
import { ModeApprovals, personModeOf } from '../sessions/mode-approvals.ts';
import { prepareShellIntegration, type ShellEnvironment } from '../sessions/shell-integration.ts';
import { SnapshotStore, scheduleSnapshots, type SnapshotSchedule } from '../sessions/snapshot-store.ts';
import { MoveJournal } from '../projects/move-journal.ts';
import type { AgentWorkBundle } from './agent-work.ts';
import type { DatabasesBundle } from './databases.ts';
import type { DevicesBundle } from './devices.ts';
import type { GitBundle } from './git.ts';
import type { LaunchesBundle } from './launches.ts';
import type { ArtifactsBundle } from './artifacts.ts';
import { artifactReport } from '../artifacts/artifact-report.ts';
import { routineReport } from '../routines/routine-report.ts';
import type { RoutinesBundle } from './routines.ts';
import type { ProjectsBundle } from './projects.ts';
import type { ProvidersBundle } from './providers.ts';
import type { DaemonRuntime } from './runtime.ts';
import type { UsageBundle } from './usage.ts';

const CHAT_UNLOAD_AFTER_MS = 10 * 60_000;

/* What the daemon keeps for agents across a restart, loaded before anything can take from it. */
export interface AgentStores {
    shellEnvironment: ShellEnvironment;
    snapshots: SnapshotStore;
    prompts: PendingPromptStore;
    lineage: AgentLineageStore;
    notices: NoticeStore;
    outbox: OutboxStore;
    tasks: TaskStore;
    commandApprovals: CommandApprovals;
    modeApprovals: ModeApprovals;
    computerStore: ComputerUseStore;
    /* The chat moves under way, which the next start finishes. */
    chatMoves: MoveJournal;
}

export async function loadAgentStores(home: string): Promise<AgentStores> {
    // Loaded before anything can take from them, so a restart keeps a node's first prompt, the count of
    // agents an agent opened, a waiting message, an owed start, a task's wake, an approval and a chat move.
    const snapshots = new SnapshotStore(home);
    const prompts = new PendingPromptStore(home);
    const lineage = new AgentLineageStore(home);
    const notices = new NoticeStore(home);
    const outbox = new OutboxStore(home);
    const tasks = new TaskStore(home);
    const commandApprovals = new CommandApprovals(home);
    const modeApprovals = new ModeApprovals(home);
    const computerStore = new ComputerUseStore(home);
    const chatMoves = new MoveJournal(home);
    // Each store reads a file of its own, so they load side by side.
    const [shellEnvironment] = await Promise.all([
        prepareShellIntegration(home),
        prompts.load(),
        lineage.load(),
        notices.load(),
        outbox.load().then(async () => {
            await restartBackgroundLimits(outbox, Date.now());
            await restartConnectPeers(outbox, Date.now());
        }),
        tasks.load(),
        commandApprovals.load(),
        modeApprovals.load(),
        computerStore.load(),
        chatMoves.load()
    ]);
    return { shellEnvironment, snapshots, prompts, lineage, notices, outbox, tasks, commandApprovals, modeApprovals, computerStore, chatMoves };
}

/* What the agents reach that is wired after them, asked only once a session or a chat runs. */
interface AgentsLater {
    projects(): ProjectsBundle;
    git(): GitBundle;
    devices(): DevicesBundle;
    databases(): DatabasesBundle;
    launches(): LaunchesBundle;
    usage(): UsageBundle;
    work(): AgentWorkBundle;
    artifacts(): ArtifactsBundle;
    routines(): RoutinesBundle;
}

interface AgentsInput {
    runtime: DaemonRuntime;
    identity: EndpointIdentity;
    stores: AgentStores;
    providers: ProvidersBundle;
    computer: ComputerUse;
    /* Runs beside boot; only Codex terminal commands need its result. */
    codexProbe: Promise<void>;
    later: AgentsLater;
}

/* The terminals and chats, and what an agent in one of them reads. */
export interface AgentsBundle {
    sessions: SessionManager;
    snapshotSchedule: SnapshotSchedule;
    chats: ChatManager;
    context: ContextStore;
    outboxLink: OutboxLink;
    attachments: AttachmentStore;
    checkpoints: Checkpoints;
    plans: PlanStore;
    bookmarks: BookmarkStore;
    visuals: VisualStore;
    /* What came from another machine, which never runs on the configuration of the files it sent. */
    untrusted: UntrustedFolders;
    /* The suggestions of agents in Chats to become a project, which a person answers. */
    proposals: ProjectProposals;
    /* Where a one-shot CLI run works, so a folder from another machine never lends it its configuration. */
    oneShot: OneShotPlace;
    /* Refuses a directory an agent node may not start in, at every start. */
    startCwd(nodeId: string, cwd: string): Promise<void>;
    /* A bearer token speaks for a terminal session or a chat, for reading context and for agent commands alike. */
    targetForToken(token: string): string | null;
    /* What a terminal's agent hears the moment it can: taken here, so whichever channel gets there first is the only one that delivers it. */
    messagesFor(targetId: string): string[];
}

export async function wireAgents({ runtime, identity, stores, providers, computer, codexProbe, later }: AgentsInput): Promise<AgentsBundle> {
    const { config } = runtime;
    const { snapshots, prompts, lineage, notices, outbox, tasks, commandApprovals, modeApprovals } = stores;
    const index = () => later.projects().store.index;
    const folderOf = (nodeId: string): string | null => index().locate(nodeId)?.folder ?? null;
    const projectAccount = projectAccountChooser({
        projectOf: (id) => index().locate(id)?.projectId ?? null,
        accountsOf: (projectId) => index().accountsOf(projectId),
        providerAccounts: providers.accounts,
        limits: () => later.usage().limits.snapshot(),
        now: () => Date.now()
    });
    const startCwd = startCwdGuard({
        madeByAgent: (nodeId) => lineage.madeBy(nodeId) !== null,
        folderOf,
        worktreePaths: (folder) => later.git().checkouts.paths(folder)
    });
    const untrusted = new UntrustedFolders({
        lineage,
        folders: () => later.projects().store.peers.worktreeFolders(),
        cwdOf: (nodeId) => chats.get(nodeId)?.info.cwd ?? sessions.get(nodeId)?.cwd ?? null
    });
    const oneShot = new OneShotPlace(config.home, untrusted);
    const proposals = new ProjectProposals({
        chats: { hold: (chatId, key) => void chats.holdForPerson(chatId, key), release: (chatId, key) => chats.releaseHold(chatId, key) }
    });
    const messagesFor = (targetId: string): string[] => notices.take(targetId).map(renderNotice);
    // One reader for chats and terminals, so a transcript both look at is only read on from where either stopped.
    const claudeTitles = new ClaudeTitleReader();
    const sessions = new SessionManager({
        adapter: new BunPtyAdapter(),
        shellEnvironment: stores.shellEnvironment,
        snapshots,
        agents: new AgentStore(config.home),
        contextUrl: runtime.contextUrl,
        binDir: runtime.binDir,
        contextFor: (sessionId) => context.list(sessionId),
        // Only a chat starts with a brief, which a routine run gives; a terminal hears the prompt alone.
        firstPrompt: async (sessionId) => (await prompts.take(sessionId))?.prompt ?? null,
        firstNotices: messagesFor,
        depthOf: (sessionId) => lineage.depthOf(sessionId),
        standalone: (sessionId) => index().locate(sessionId)?.canvasId === null,
        computerUse: () => computer.usable,
        reachOpenProjects: () => identity.reachOpenProjects,
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
        accounts: providers.accounts,
        openingAccount: (sessionId, kind, named) => projectAccount(sessionId, kind, named)?.account ?? named ?? providers.accounts.defaultFor(kind),
        prepareAgent: (kind) => (kind === 'codex' ? codexProbe : Promise.resolve())
    });
    const snapshotSchedule = scheduleSnapshots(sessions, snapshots);
    const targetForToken = (token: string): string | null => sessions.sessionIdForToken(token) ?? chats.chatIdForToken(token);
    const context: ContextStore = new ContextStore({
        sources: (targetId) =>
            withForkOrigin(targetId, index().sourcesFor(targetId), {
                forkedFrom: (id) => lineage.forkedFrom(id),
                forksOf: (id) => lineage.forksOf(id),
                locate: (id) => index().locate(id),
                titleFor: (id) => index().titleFor(id),
                viewsOf: (projectId) => index().viewsOf(projectId)
            }),
        referenced: (targetId) => referenced(chats.get(targetId)?.thread.list() ?? [], (id) => index().referenceBeside(targetId, id)),
        opened: (targetId, sourceId) =>
            openedChildSource(targetId, sourceId, { startedBy: (id) => lineage.startedBy(id), agentSource: (id) => index().agentSource(id) }),
        terminalText: (sessionId) => sessions.get(sessionId)?.plainText() ?? Promise.resolve(null),
        chatItems: (chatId) => chats.get(chatId)?.thread.list() ?? null,
        chatInfo: (chatId) => chats.get(chatId)?.info ?? null,
        now: Date.now,
        browserPage: (browserId) => later.devices().browserDriver.read(browserId),
        devices: () => later.devices().devices.list(),
        chatPlans: (chatId) => plans.read(chatId),
        subagentItems: (chatId, toolUseId) => chats.subagentItems(chatId, toolUseId),
        drawingElements: (viewId) => later.projects().drawings.elementsOf(viewId),
        diagramDocument: async (targetId, viewId, projectId) => {
            const project = projectId ?? index().locate(targetId)?.projectId;
            return project ? later.projects().diagrams.read(project, viewId) : null;
        },
        canvasOf: (targetId) => index().canvasOf(targetId),
        artifactReport: async (targetId, artifact, projectId) => {
            const project = projectId ?? index().locate(targetId)?.projectId;
            return project ? artifactReport(later.artifacts().artifacts, project, artifact) : null;
        },
        routineReport: async (targetId, routineId, projectId) => {
            const project = projectId ?? index().locate(targetId)?.projectId;
            return project ? routineReport(later.routines().routines, project, routineId) : null;
        }
    });
    const outboxLink = new OutboxLink({ outbox, projectOf: (id) => index().locate(id)?.projectId ?? null });
    const attachments = new AttachmentStore(config.home);
    const checkpoints = new Checkpoints(config.home);
    const plans = new PlanStore(config.home);
    const bookmarks = new BookmarkStore(config.home);
    const visuals = new VisualStore(config.home, attachments);
    const chats: ChatManager = new ChatManager({
        providers: providers.providers,
        projectAccount,
        intelligentUi: ruimteUiSources({
            place: (chatId) => index().locate(chatId),
            node: (id) => {
                const place = index().locate(id);
                return !place || index().isHiddenChat(id)
                    ? null
                    : {
                          projectId: place.projectId,
                          canvasId: place.canvasId,
                          title: index().titleFor(id) ?? id,
                          hidden: later.projects().store.hiddenAgents.get(id) !== undefined
                      };
            },
            worktreePaths: (folder) => later.git().checkouts.paths(folder),
            gitStatus: (cwd) => later.git().statuses.status(cwd),
            gitLog: readLog,
            launches: (projectId) => later.launches().agentHost.list(projectId),
            tasks: (chatId) => tasks.ofParent(chatId),
            databases: () => later.databases().agents
        }),
        store: new ChatStore(config.home, { attachments, isSidecar: isPlanFileName }),
        // A chat no window shows and whose CLI is gone holds its whole thread for nobody; its record has it.
        unloadAfterMs: CHAT_UNLOAD_AFTER_MS,
        attachments,
        checkpoints,
        contextUrl: runtime.contextUrl,
        binDir: runtime.binDir,
        depthOf: (chatId) => lineage.depthOf(chatId),
        computer: () => computer.usable,
        reachOpenProjects: () => identity.reachOpenProjects,
        visualReplies: () => identity.visualReplies,
        databases: (chatId) => {
            const folder = index().locate(chatId)?.folder;
            return folder !== undefined && hasDatabaseConnections(folder);
        },
        modeCeiling: (chatId) => lineage.ceilingOf(chatId),
        peerChat: (chatId) => untrusted.node(chatId),
        checkCwd: startCwd,
        holdsProject: async (chatId, clientId) => {
            const place = index().locate(chatId);
            return place !== null && (await later.projects().store.heldFolders(clientId)).includes(place.folder);
        },
        contextSources: (chatId) => context.list(chatId),
        reference: (chatId, id) => index().referenceBeside(chatId, id),
        standalone: (chatId) => index().locate(chatId)?.canvasId === null,
        inlineChat: (chatId) => index().isHiddenChat(chatId),
        design: (chatId) => index().designOf(chatId),
        turnEnded: (chatId) => {
            if (index().designOf(chatId) !== null) {
                void later.projects().store.settleDesignsAfterTurn(chatId);
            }
        },
        openingAgent: agentChatOpening(outbox, (provider) => chats.composerPreferences.for(provider)),
        messageNotes: (chatId) => new NoticeNotes(notices, chatId, MESSAGE_WORDS),
        // The other reader: what a chat has to show a person in its thread, which is never taken from the model.
        unshownMessages: (chatId) => unshownNotes(notices, chatId, MESSAGE_WORDS),
        firstPrompt: (chatId) => prompts.take(chatId),
        // A turn reports what is left of its plan in passing; that belongs to the machine's numbers.
        onLimits: (update) => later.usage().limits.applyLive(update),
        claudeTitles,
        // One one-shot call per Codex chat, on whichever CLI here answers a single prompt.
        nameChat: async (provider, input) => suggestChatTitle(providers.providers, provider, { ...input, cwd: await oneShot.cwdFor(input.cwd) }),
        onInterruptedRun: outboxLink.onInterruptedRun,
        taskRows: (chatId) => tasks.ofParent(chatId),
        dropWakes: (chatId) => tasks.dropWake(chatId),
        endChildren: (chatId) => later.work().endChildren.stopNode(chatId, 'a person cleared this chat'),
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
        accounts: providers.accounts
    });
    return {
        sessions,
        snapshotSchedule,
        chats,
        context,
        outboxLink,
        attachments,
        checkpoints,
        plans,
        bookmarks,
        visuals,
        untrusted,
        oneShot,
        proposals,
        startCwd,
        targetForToken,
        messagesFor
    };
}

import { nodeSessionFs } from '@adecore/agents/chat';
import { usageRootsOf } from '@adecore/agents/usage';
import type { CanvasHost } from '../canvas/verb.ts';
import { continueOn } from '../chat/continue-on.ts';
import { ExternalChatSessions, ownSessionSources } from '../chat/external.ts';
import { chatForkDeps, forkChat, readForkInfo, readHandoff } from '../chat/fork.ts';
import { ChatImageFiles } from '../chat/image-files.ts';
import { chatsLocatedIn, chatsOfViews, ProjectChatSearch } from '../chat/project-search.ts';
import type { Dispatcher } from '../dispatcher.ts';
import { errorText } from '../error-text.ts';
import { readServedFile } from '../fs/read.ts';
import type { WriteBoundary } from '../fs/write.ts';
import { readArchiveEntry } from '../archive/archive.ts';
import { registerAuthHandlers } from '../handlers/auth.ts';
import { registerBrowserHandlers } from '../handlers/browser.ts';
import { registerArchiveHandlers } from '../handlers/archive.ts';
import { registerBytesHandlers } from '../handlers/bytes.ts';
import { registerChatHandlers } from '../handlers/chat.ts';
import { registerChatImageHandlers } from '../handlers/chat-image.ts';
import { registerChatSearchHandlers } from '../handlers/chat-search.ts';
import { registerComputerHandlers } from '../handlers/computer.ts';
import { registerDatabaseHandlers } from '../handlers/database.ts';
import { registerDeviceControlHandlers, registerDeviceHandlers } from '../handlers/device.ts';
import { registerDiagramHandlers } from '../handlers/diagram.ts';
import { registerDrawingHandlers } from '../handlers/drawing.ts';
import { registerFsHandlers } from '../handlers/fs.ts';
import { registerGitHandlers } from '../handlers/git.ts';
import { registerLanguageHandlers } from '../handlers/language.ts';
import { registerAgentServerHandlers } from '../handlers/agent-servers.ts';
import { registerProviderDetectHandler } from '../handlers/provider-detect.ts';
import { registerLaunchHandlers } from '../handlers/launches.ts';
import { registerOnDeviceHandlers } from '../handlers/ondevice.ts';
import { registerPeerHandlers } from '../handlers/peer.ts';
import { registerPeerTaskHandlers } from '../handlers/peer-tasks.ts';
import { registerPlanHandlers } from '../handlers/plan.ts';
import { registerRemoteHandlers } from '../handlers/remote.ts';
import { trustedStatementKeys } from '../pulsar/statement.ts';
import type { RemoteBundle } from './remote.ts';
import type { UsageStatsBundle } from './usage-stats.ts';
import { registerProcessHandlers } from '../handlers/processes.ts';
import { registerProjectHandlers } from '../handlers/project.ts';
import { registerProvenanceHandlers } from '../handlers/provenance.ts';
import { registerProviderAccountHandlers } from '../handlers/accounts.ts';
import { registerPushHandlers } from '../handlers/push.ts';
import { registerProposalHandlers } from '../handlers/project-proposals.ts';
import { registerSecretHandlers } from '../handlers/secrets.ts';
import { registerServerHandlers } from '../handlers/server.ts';
import { registerSessionHandlers } from '../handlers/session.ts';
import { registerSessionPortHandlers } from '../handlers/session-ports.ts';
import { registerSnoozeHandlers } from '../handlers/snooze.ts';
import { registerTaskHandlers } from '../handlers/tasks.ts';
import { projectTerminalPrepareHost, registerTerminalPrepareHandlers } from '../handlers/terminal-prepare.ts';
import { registerUsageHandlers } from '../handlers/usage.ts';
import { readMachineModel } from '../machine-model.ts';
import { workEndedByInstall } from '../power/machine-update.ts';
import type { PushService } from '../push/service.ts';
import { PrepareTerminal, shellSyntax } from '../sessions/prepare-terminal.ts';
import { VERSION } from '../version.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { AgentWorkBundle } from './agent-work.ts';
import { chatMoveHandlers } from './chat-move.ts';
import type { ClientsBundle } from './clients.ts';
import type { DatabasesBundle } from './databases.ts';
import type { DevicesBundle } from './devices.ts';
import type { GitBundle } from './git.ts';
import type { LanguageBundle } from './language.ts';
import type { LaunchesBundle } from './launches.ts';
import type { MachineBundle } from './machine.ts';
import type { NetworkBundle } from './network.ts';
import type { PowerBundle } from './power.ts';
import type { ProjectsBundle } from './projects.ts';
import type { ProvidersBundle } from './providers.ts';
import type { DaemonRuntime } from './runtime.ts';
import type { ProcessesBundle } from './processes.ts';
import type { UsageBundle } from './usage.ts';

export interface HandlersInput {
    runtime: DaemonRuntime;
    machine: MachineBundle;
    stores: AgentStores;
    providers: ProvidersBundle;
    agents: AgentsBundle;
    projects: ProjectsBundle;
    work: AgentWorkBundle;
    launches: LaunchesBundle;
    git: GitBundle;
    devices: DevicesBundle;
    processes: ProcessesBundle;
    power: PowerBundle;
    push: PushService;
    canvasHost: CanvasHost;
    remote: RemoteBundle;
    stats: UsageStatsBundle;
    later: {
        network(): NetworkBundle;
        clients(): ClientsBundle;
    };
}

/* What a client asks of sessions, chats, projects and the machine itself. */
export async function registerHandlers(dispatcher: Dispatcher, input: HandlersInput): Promise<void> {
    const { runtime, machine, stores, providers, agents, projects, work, launches, git, devices, processes, power, push, canvasHost, remote, stats, later } =
        input;
    const { config } = runtime;
    const { identity } = machine;
    const { sessions, chats } = agents;
    const store = projects.store;
    registerPushHandlers(dispatcher, machine.auth, () => push.synchronizeActivities(), push);
    registerSnoozeHandlers(dispatcher, work.snoozes, (nodeId) => store.index.locate(nodeId));
    registerServerHandlers(dispatcher, { version: VERSION, home: config.home, model: await readMachineModel() });
    registerSessionHandlers(
        dispatcher,
        sessions,
        work.endChildren.owe,
        {
            commandOf: (kind) => providers.providers.get(kind).home?.loginCommand,
            nameOf: providers.nameOfCli
        },
        (nodeId) => store.machineOfNode(nodeId)
    );
    registerTerminalPrepareHandlers(
        dispatcher,
        new PrepareTerminal({
            machineId: identity.id,
            machine: identity.label,
            sessions,
            syntax: shellSyntax,
            ...projectTerminalPrepareHost(store.index, chats)
        })
    );
    registerBrowserHandlers(dispatcher, devices.browsers, devices.browserPages, () => identity.streamingAllowed);
    registerDeviceHandlers(dispatcher, devices.devices, () => identity.streamingAllowed, config.home);
    registerDeviceControlHandlers(dispatcher, devices.deviceControl);
    const forkDeps = chatForkDeps({
        chats,
        host: canvasHost,
        titleFor: (id) => store.index.titleFor(id),
        lineage: stores.lineage,
        worktrees: git.worktrees,
        checkpoints: agents.checkpoints
    });
    const beforeChatKill = (chatId: string): Promise<unknown> => {
        devices.computer.nodeClosed(chatId);
        launches.secrets.nodeClosed(chatId);
        agents.proposals.forget(chatId);
        return work.endChildren.owe(chatId);
    };
    registerChatHandlers(
        dispatcher,
        chats,
        providers.providers,
        beforeChatKill,
        work.endChildren.stopNode,
        {
            fork: (payload) => forkChat(forkDeps, payload),
            info: (payload) => readForkInfo(forkDeps, payload),
            handoff: (payload) => readHandoff(forkDeps, payload),
            summarize: (chatId) => work.summaries.summarize(chatId),
            continueOn: (payload) => continueOn({ chats, fork: (fork) => forkChat(forkDeps, fork) }, payload)
        },
        (chatId) => work.prWatches.stop(chatId),
        chatMoveHandlers({
            chats,
            store,
            lineage: stores.lineage,
            tasks: stores.tasks,
            outbox: stores.outbox,
            notices: stores.notices,
            prWatches: work.prWatches,
            machineHome: machine.machineHome,
            journal: stores.chatMoves,
            snoozes: work.snoozes,
            proposals: agents.proposals
        }),
        (nodeId) => store.machineOfNode(nodeId),
        (chatId) => stores.lineage.peerOf(chatId) !== null && stores.outbox.list().some((entry) => entry.kind === 'start-agent' && entry.target === chatId)
    );
    registerTaskHandlers(dispatcher, stores.tasks, work.endChildren.children);
    registerChatImageHandlers(
        dispatcher,
        new ChatImageFiles({
            project: async (chatId, clientId) => {
                const place = store.index.locate(chatId);
                if (place === null || place.folder === store.scratchFolder || !(await store.heldFolders(clientId)).includes(place.folder)) {
                    return null;
                }
                const project = (await store.known()).find((entry) => entry.projectId === place.projectId);
                return project === undefined ? null : { folder: place.folder, name: project.name };
            },
            attachment: (chatId, attachmentId) => chats.findAttachment(chatId, attachmentId),
            refusePath: (path) => machine.machineHome.refuse(path)
        })
    );
    const clientHoldsProject = async (clientId: string, projectId: string): Promise<boolean> => {
        const folder = store.index.folderOf(projectId);
        return folder !== null && (await store.heldFolders(clientId)).includes(folder);
    };
    registerChatSearchHandlers(
        dispatcher,
        new ProjectChatSearch({
            holds: clientHoldsProject,
            // The same rule holdsProject applies: a chat id written into this project's file may be another project's chat.
            chatsOf: (projectId) => chatsLocatedIn(chatsOfViews(store.index.viewsOf(projectId) ?? []), projectId, (chatId) => store.index.locate(chatId)),
            loadedItems: (chatId) => chats.get(chatId)?.thread.list() ?? null,
            readStored: async (chatId) => (await chats.readChat(chatId))?.items ?? null
        }),
        new ExternalChatSessions({
            holds: clientHoldsProject,
            folderOf: (projectId) => store.index.folderOf(projectId),
            roots: () => usageRootsOf(providers.accounts),
            ownSessionIds: async (projectId) => {
                const { chatIds, resumes } = ownSessionSources(
                    store.index.viewsOf(projectId) ?? [],
                    store.hiddenAgents.inProject(projectId).map((agent) => agent.node)
                );
                const own = new Set(resumes);
                for (const chatId of chatIds) {
                    const sessionId = (await chats.readChat(chatId))?.info.agentSessionId;
                    if (sessionId !== null && sessionId !== undefined) {
                        own.add(sessionId);
                    }
                }
                return own;
            },
            fs: await nodeSessionFs()
        })
    );
    registerPlanHandlers(dispatcher, agents.plans);
    registerProjectHandlers(dispatcher, store, async (chatId) => (await chats.readChat(chatId))?.items.some((item) => item.kind === 'user') ?? false, {
        start: (payload) => chats.create(payload),
        // Loaded first: a chat nobody opened since a restart has no session to end, only a record to remove.
        end: async (chatId) => {
            await chats.create({ chatId }).catch(() => undefined);
            await projects.endSession('chat', chatId);
        },
        worktreePaths: (folder) => git.checkouts.paths(folder)
    });
    registerPeerHandlers(dispatcher, {
        links: store.peers,
        lineage: stores.lineage,
        tasks: work.peerTasks,
        projects: store,
        endSession: projects.endSession,
        worktreePaths: (folder) => git.checkouts.paths(folder),
        attestedUntil: (machineId) => machine.auth.attestedUntil(machineId)
    });
    registerPeerTaskHandlers(dispatcher, store.peers, work.peerTasks);
    registerRemoteHandlers(dispatcher, store.remote, store, {
        machineId: identity.id,
        machinePublicKey: identity.publicKey,
        peerPublicKey: () => machine.peerKey.publicKey(),
        pending: machine.pendingAdmissions,
        machines: remote.machines,
        connections: remote.connections,
        trustedKeys: trustedStatementKeys(process.env, runtime.compiled),
        accountBinding: () => machine.auth.accountBinding(),
        lapse: (machineId) => work.reconnect.lapse(machineId, (entryId) => stores.outbox.remove(entryId)),
        now: () => Date.now()
    });
    registerDrawingHandlers(dispatcher, projects.drawings);
    registerDiagramHandlers(dispatcher, projects.diagrams);
    registerLaunchHandlers(dispatcher, launches.store, launches.runner);
    registerAuthHandlers(dispatcher, machine.auth, {
        identity,
        peerKey: machine.peerKey,
        home: config.home,
        version: VERSION,
        broker: () => later.network().brokerSwitch.describe(),
        lanDoor: () => later.network().describeLanDoor(),
        streamingChanged: (allowed) => {
            if (!allowed) {
                devices.browsers.closeAll();
                devices.devices.closeAll();
            }
        },
        usageStatsChanged: (on) => stats.changed(on),
        appleFoundationChanged: async (on) => {
            providers.providers.invalidate('apple');
            if (!on) {
                await Promise.all(
                    chats
                        .list()
                        .filter((chat) => chat.provider === 'apple')
                        .map((chat) => chats.stop(chat.chatId, 'Apple Foundation Models was turned off in Settings.'))
                );
            }
            await providers.accounts.refresh();
        },
        agentIntegrations: {
            summary: () => providers.integrations.summary(),
            files: () => providers.integrations.files(),
            set: (kind, on) => providers.integrations.set(kind, on)
        },
        keepAwake: { available: power.keepAwake.available, changed: power.checkAwake },
        closedLid: {
            available: power.closedLid.available,
            rule: () => power.closedLid.refreshRule(),
            setRule: (install, prompt) => power.closedLid.setRule(install, prompt)
        },
        updates: {
            state: () => power.updates.state(),
            report: (clientId, report) => power.updates.report(clientId, report),
            requestInstall: () => power.updates.requestInstall(),
            ending: () => workEndedByInstall(config.underService, processes.machineWork())
        },
        resumeChanged: (on) => {
            chats.resumeSettingChanged();
            // A chat nobody loaded owes a resume only on disk, so turning the switch off drops those there.
            if (!on) {
                void agents.outboxLink.lapseLimitResume().catch((e: unknown) => console.error('Dropping the resumes after a limit failed:', errorText(e)));
            }
        },
        disconnect: (sessionId) => later.clients().disconnectSession(sessionId)
    });
}

export interface EditorHandlersInput {
    machine: MachineBundle;
    providers: ProvidersBundle;
    projects: ProjectsBundle;
    work: AgentWorkBundle;
    launches: LaunchesBundle;
    git: GitBundle;
    devices: DevicesBundle;
    databases: DatabasesBundle;
    usage: UsageBundle;
    processes: ProcessesBundle;
    language: LanguageBundle;
    agents: AgentsBundle;
}

/* What a client asks of a project's files: languages, databases, git, and what runs on the machine meanwhile. */
export function registerEditorHandlers(dispatcher: Dispatcher, input: EditorHandlersInput): void {
    const { machine, providers, projects, work, launches, git, devices, databases, usage, processes, language, agents } = input;
    const store = projects.store;
    registerLanguageHandlers(dispatcher, language.host);
    registerAgentServerHandlers(dispatcher, providers.servers);
    registerProviderDetectHandler(dispatcher, providers.providers, providers.accounts);
    registerOnDeviceHandlers(dispatcher, language.onDevice);
    registerProvenanceHandlers(dispatcher, language.provenance, machine.machineHome);
    registerDatabaseHandlers(dispatcher, databases.service, databases.connections, databases.agents, databases.sqlAnalysis);
    const boundaryOf = async (clientId: string): Promise<WriteBoundary> => ({
        folders: await store.heldFolders(clientId),
        worktreesOf: git.checkouts.paths,
        worktreesRoot: git.worktrees.root,
        registeredWorktrees: (folder) => git.worktrees.registeredPaths(folder)
    });
    registerFsHandlers(dispatcher, git.folders, boundaryOf, machine.machineHome, language.host);
    registerArchiveHandlers(dispatcher, boundaryOf, machine.machineHome, language.host);
    registerBytesHandlers(
        dispatcher,
        {
            attachment: (chatId, id) => agents.chats.findAttachment(chatId, id),
            projectIcon: (projectId, theme) => store.iconFile(projectId, theme),
            file: readServedFile,
            archiveEntry: readArchiveEntry,
            bundle: (id) => git.bundles.made(id),
            bundleRead: (id) => git.bundles.discard(id)
        },
        machine.machineHome
    );
    registerUsageHandlers(dispatcher, usage.usage, usage.limits);
    registerProviderAccountHandlers(dispatcher, providers.accounts);
    registerProcessHandlers(dispatcher, processes.processes);
    registerSessionPortHandlers(dispatcher, processes.sessionPorts);
    registerComputerHandlers(dispatcher, devices.computer);
    registerSecretHandlers(dispatcher, launches.secrets);
    registerProposalHandlers(dispatcher, agents.proposals);
    registerGitHandlers(
        dispatcher,
        git.worktrees,
        git.merges,
        git.statuses,
        providers.providers,
        work.prWatches,
        (id) => store.index.locate(id),
        machine.machineHome,
        {
            bundles: git.bundles,
            checkpoints: git.checkpoints,
            folderOf: async (projectId) => (await store.known()).find((project) => project.projectId === projectId)?.folder ?? null,
            untrusted: (path) => agents.untrusted.inFolder(path),
            untrustFolder: (path, branch) => store.peers.untrustFolder(path, branch)
        },
        agents.oneShot
    );
}

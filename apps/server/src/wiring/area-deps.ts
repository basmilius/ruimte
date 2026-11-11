import type { SessionFs } from '@adecore/agents/chat';
import { usageRootsOf } from '@adecore/agents/usage';
import { readArchiveEntry } from '../archive/archive.ts';
import { ArtifactImporter } from '../artifacts/artifact-import.ts';
import { bestEffort } from '../best-effort.ts';
import { continueOn } from '../chat/continue-on.ts';
import { ExternalChatSessions, ownSessionSources } from '../chat/external.ts';
import { chatForkDeps, forkChat, readForkInfo, readHandoff } from '../chat/fork.ts';
import { ChatImageFiles } from '../chat/image-files.ts';
import { chatsLocatedIn, chatsOfViews, ProjectChatSearch } from '../chat/project-search.ts';
import { readServedFile } from '../fs/read.ts';
import type { WriteBoundary } from '../fs/write.ts';
import type { ArchiveDeps } from '../handlers/archive.ts';
import type { AuthDeps } from '../handlers/auth.ts';
import type { BytesDeps } from '../handlers/bytes.ts';
import type { ChatImageDeps } from '../handlers/chat-image.ts';
import type { ChatSearchDeps } from '../handlers/chat-search.ts';
import type { ChatDeps } from '../handlers/chat.ts';
import type { DesignDeps } from '../handlers/design.ts';
import type { FsDeps } from '../handlers/fs.ts';
import type { GitDeps } from '../handlers/git.ts';
import type { ProjectDeps } from '../handlers/project.ts';
import type { SessionDeps } from '../handlers/session.ts';
import { projectTerminalPrepareHost, type TerminalPrepareDeps } from '../handlers/terminal-prepare.ts';
import type { RemoteDeps } from '../peer/giver/area.ts';
import type { PeerLinksDeps } from '../peer/worker/area-links.ts';
import { workEndedByInstall } from '../power/machine-update.ts';
import { trustedStatementKeys } from '../pulsar/statement.ts';
import { PrepareTerminal, shellSyntax } from '../sessions/prepare-terminal.ts';
import { VERSION } from '../version.ts';
import type { DaemonBundles } from './bundles.ts';
import type { Later } from './later.ts';
import type { DaemonRuntime } from './runtime.ts';

/* What the list of areas is made of: every bundle but the clients, which exist only once the areas do, and what the daemon read before them. */
export interface AreaInput extends Omit<DaemonBundles, 'clients'> {
    runtime: DaemonRuntime;
    machineModel: string | null;
    sessionFs: SessionFs;
}

export type AreaLater = Later<Pick<DaemonBundles, 'clients'>>;

/* What a client may write: the folders it holds, and the worktrees of their repositories. */
function boundaryOf({ projects, git }: AreaInput): (clientId: string) => Promise<WriteBoundary> {
    return async (clientId) => ({
        folders: await projects.store.heldFolders(clientId),
        worktreesOf: git.checkouts.paths,
        worktreesRoot: git.worktrees.root,
        registeredWorktrees: (folder) => git.worktrees.registeredPaths(folder)
    });
}

export function authDeps(input: AreaInput, later: AreaLater): AuthDeps {
    const { runtime, machine, providers, processes, power, agents, connected } = input;
    const { config } = runtime;

    return {
        store: machine.auth,
        identity: machine.identity,
        peerKey: machine.peerKey,
        home: config.home,
        version: VERSION,
        announce: (clientId, payload) => connected.announce(clientId, payload),
        validateTextModel: (choice) => agents.textModels.validate(choice),
        agentIntegrations: {
            summary: () => providers.integrations.summary(),
            files: () => providers.integrations.files(),
            set: (kind, on) => providers.integrations.set(kind, on)
        },
        keepAwake: { available: power.keepAwake.available },
        closedLid: {
            available: power.closedLid.available,
            rule: () => power.closedLid.refreshRule(),
            setRule: (install, prompt) => power.closedLid.setRule(install, prompt)
        },
        updates: {
            subscribe: (clientId, sink) => power.updates.subscribe(clientId, sink),
            state: () => power.updates.state(),
            report: (clientId, report) => power.updates.report(clientId, report),
            requestInstall: () => power.updates.requestInstall(),
            ending: () => workEndedByInstall(config.underService, processes.machineWork())
        },
        disconnect: (sessionId) => later.clients().disconnectSession(sessionId)
    };
}

export function sessionDeps({ agents, providers, stores, projects }: AreaInput): SessionDeps {
    return {
        manager: agents.sessions,
        beforeKill: (sessionId) => stores.lifecycle.emit('closed', sessionId),
        logins: {
            commandOf: (kind) => providers.providers.get(kind).home?.loginCommand,
            nameOf: providers.nameOfCli
        },
        machineOf: (nodeId) => projects.store.machineOfNode(nodeId)
    };
}

export function chatDeps(input: AreaInput): ChatDeps {
    const { agents, providers, stores, projects, work, git, canvasHost, chatMover } = input;
    const { chats, chatManager } = agents;
    const store = projects.store;
    const forkDeps = chatForkDeps({
        chats: chatManager,
        host: canvasHost,
        titleFor: (id) => store.index.titleFor(id),
        lineage: stores.lineage,
        worktrees: git.worktrees,
        checkpoints: agents.checkpoints
    });

    return {
        manager: chats,
        providers: providers.providers,
        beforeKill: (chatId) => stores.lifecycle.emit('closed', chatId),
        stopNode: work.endChildren.stopNode,
        forks: {
            fork: (payload) => forkChat(forkDeps, payload),
            info: (payload) => readForkInfo(forkDeps, payload),
            handoff: (payload) => readHandoff(forkDeps, payload),
            summarize: (chatId) => work.summaries.summarize(chatId),
            continueOn: (payload) => continueOn({ chats: chatManager, fork: (fork) => forkChat(forkDeps, fork) }, payload)
        },
        killed: (chatId) => work.prWatches.stop(chatId),
        moves: chatMover,
        machineOf: (nodeId) => store.machineOfNode(nodeId),
        starting: (chatId) => stores.lineage.peerOf(chatId) !== null && stores.outbox.owes('start-agent', chatId)
    };
}

export function chatImageDeps({ projects, agents, machine }: AreaInput): ChatImageDeps {
    const store = projects.store;

    return {
        images: new ChatImageFiles({
            project: async (chatId, clientId) => {
                const place = store.index.locate(chatId);
                if (place === null || !(await store.holdsFolder(clientId, place.folder, { refuseScratch: true }))) {
                    return null;
                }
                const project = (await store.known()).find((entry) => entry.projectId === place.projectId);
                return project === undefined ? null : { folder: place.folder, name: project.name };
            },
            attachment: (chatId, attachmentId) => agents.chatManager.findAttachment(chatId, attachmentId),
            refusePath: (path) => machine.machineHome.refuse(path)
        })
    };
}

export function chatSearchDeps({ projects, agents, providers, sessionFs }: AreaInput): ChatSearchDeps {
    const store = projects.store;
    const { chats } = agents;
    const holds = async (clientId: string, projectId: string): Promise<boolean> => {
        const folder = store.index.folderOf(projectId);
        return folder !== null && store.holdsFolder(clientId, folder);
    };

    return {
        search: new ProjectChatSearch({
            holds,
            // The same rule holdsProject applies: a chat id written into this project's file may be another project's chat.
            chatsOf: (projectId) => chatsLocatedIn(chatsOfViews(store.index.viewsOf(projectId) ?? []), projectId, (chatId) => store.index.locate(chatId)),
            loadedItems: (chatId) => chats.get(chatId)?.thread.list() ?? null,
            readStored: async (chatId) => (await chats.readChat(chatId))?.items ?? null
        }),
        external: new ExternalChatSessions({
            holds,
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
            fs: sessionFs
        })
    };
}

export function terminalPrepareDeps({ machine, agents, projects }: AreaInput): TerminalPrepareDeps {
    return {
        prepare: new PrepareTerminal({
            machineId: machine.identity.id,
            machine: machine.identity.label,
            sessions: agents.sessions,
            syntax: shellSyntax,
            ...projectTerminalPrepareHost(projects.store.index, agents.chats)
        })
    };
}

export function artifactImporter({ machine, artifacts, projects, remote }: AreaInput): ArtifactImporter {
    const store = projects.store;

    return new ArtifactImporter({
        store: artifacts.store,
        machineId: machine.identity.id,
        known: () => store.known(),
        remoteProjectOf: (projectId, machineId) => store.remote.linksOf(projectId).find((link) => link.machineId === machineId)?.remoteProjectId ?? null,
        connect: (machineId) => remote.connections.connect(machineId)
    });
}

export function projectDeps({ machine, agents, projects, git }: AreaInput): ProjectDeps {
    const { chats } = agents;

    return {
        store: projects.store,
        scratch: { written: async (chatId) => (await chats.readChat(chatId))?.items.some((item) => item.kind === 'user') ?? false },
        inline: {
            start: (payload) => chats.create(payload),
            // Loaded first: a chat nobody opened since a restart has no session to end, only a record to remove.
            end: async (chatId) => {
                await bestEffort('chats.create', chats.create({ chatId }));
                await projects.endSession('chat', chatId);
            },
            worktreePaths: (folder) => git.checkouts.paths(folder)
        },
        reachOpenProjects: () => machine.identity.reachOpenProjects
    };
}

export function peerLinksDeps({ machine, stores, projects, work, git }: AreaInput): PeerLinksDeps {
    return {
        links: projects.store.peers,
        lineage: stores.lineage,
        tasks: work.peerTasks,
        projects: projects.store,
        endSession: projects.endSession,
        worktreePaths: (folder) => git.checkouts.paths(folder),
        attestedUntil: (machineId) => machine.auth.attestedUntil(machineId)
    };
}

export function remoteDeps({ runtime, machine, stores, projects, work, remote }: AreaInput): RemoteDeps {
    const { identity } = machine;

    return {
        remote: projects.store.remote,
        projects: projects.store,
        status: remote.status,
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
    };
}

export function fsDeps(input: AreaInput): FsDeps {
    return { watcher: input.git.folders, boundaryOf: boundaryOf(input), machineHome: input.machine.machineHome, language: input.language.host };
}

export function archiveDeps(input: AreaInput): ArchiveDeps {
    return { boundaryOf: boundaryOf(input), machineHome: input.machine.machineHome, language: input.language.host };
}

export function bytesDeps({ agents, projects, git, artifacts, machine }: AreaInput): BytesDeps {
    return {
        sources: {
            attachment: (chatId, id) => agents.chatManager.findAttachment(chatId, id),
            projectIcon: (projectId, theme) => projects.store.iconFile(projectId, theme),
            file: readServedFile,
            archiveEntry: readArchiveEntry,
            bundle: (id) => git.bundles.made(id),
            bundleRead: (id) => git.bundles.discard(id),
            artifact: async (artifactId, versionId, file) => artifacts.artifacts.file(artifactId, versionId, file),
            designPage: (clientId, pageId) => projects.designPages.bytesOf(clientId, pageId),
            designPageSent: (clientId, pageId, offset, length) => projects.designPages.sent(clientId, pageId, offset, length)
        },
        machineHome: machine.machineHome
    };
}

export function designDeps({ projects }: AreaInput): DesignDeps {
    const { store } = projects;

    return {
        projectOf: async (clientId, projectId) => {
            const folder = (await store.known()).find((project) => project.projectId === projectId)?.folder;
            if (folder === undefined || !(await store.holdsFolder(clientId, folder, { refuseScratch: true }))) {
                return null;
            }
            const { views, shared } = await store.place(projectId);
            return { folder, views, shared };
        },
        pages: projects.designPages
    };
}

export function gitDeps({ machine, providers, projects, work, git, agents }: AreaInput): GitDeps {
    const store = projects.store;

    return {
        worktrees: git.worktrees,
        merges: git.merges,
        statuses: git.statuses,
        providers: providers.providers,
        prWatches: work.prWatches,
        placeOf: (id) => store.index.locate(id),
        machineHome: machine.machineHome,
        bundles: git.bundles,
        checkpoints: git.checkpoints,
        folderOf: async (projectId) => (await store.known()).find((project) => project.projectId === projectId)?.folder ?? null,
        untrusted: (path) => agents.untrusted.inFolder(path),
        untrustFolder: (path, branch) => store.peers.untrustFolder(path, branch),
        oneShotPlace: agents.oneShot,
        textModels: agents.textModels
    };
}

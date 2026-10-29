import { chatRequests } from '@adecore/agents/coordination';
import { agentStates } from '../agents/agent-state.ts';
import { openedAgentCount } from '../agents/hidden-agents.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import type { ChatManager } from '../chat/chat-manager.ts';
import { chatForkDeps, forkForAgent } from '../chat/fork.ts';
import { agentMessages } from '../context/agent-messages.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import { worktreeHost } from '../git/worktree-host.ts';
import { AgentLanguage } from '../language/agent-language.ts';
import type { LanguageHost } from '../language/host.ts';
import { agentStartHost } from '../outbox/start-agent.ts';
import type { PushService } from '../push/service.ts';
import { agentRoutines } from '../routines/agent-host.ts';
import type { SessionManager } from '../sessions/manager.ts';
import { agentVisuals } from '../visuals/agent-host.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { ArtifactsBundle } from './artifacts.ts';
import type { AgentWorkBundle } from './agent-work.ts';
import type { DatabasesBundle } from './databases.ts';
import type { DevicesBundle } from './devices.ts';
import type { GitBundle } from './git.ts';
import type { LaunchesBundle } from './launches.ts';
import type { ProjectsBundle } from './projects.ts';
import type { ProvidersBundle } from './providers.ts';
import { chatIsInChats } from './chat-move.ts';
import type { RemoteBundle } from './remote.ts';
import type { RoutinesBundle } from './routines.ts';
import type { TemplatesBundle } from './templates.ts';
import type { UsageBundle } from './usage.ts';

interface CanvasHostInput {
    identity: EndpointIdentity;
    stores: AgentStores;
    providers: ProvidersBundle;
    agents: AgentsBundle;
    projects: ProjectsBundle;
    work: AgentWorkBundle;
    launches: LaunchesBundle;
    git: GitBundle;
    devices: DevicesBundle;
    databases: DatabasesBundle;
    remote: RemoteBundle;
    usage: UsageBundle;
    artifacts: ArtifactsBundle;
    routines: RoutinesBundle;
    templates: TemplatesBundle;
    later: {
        language(): LanguageHost;
        push(): PushService;
    };
}

/* How a verb reads and prompts chats and asks which agent a terminal runs. */
export function chatAccess(chats: ChatManager, sessions: SessionManager): Pick<CanvasHost, 'chatThreads' | 'chatPrompts' | 'terminals'> {
    return {
        // A chat nobody opened since a restart is read from its record, which starts no CLI.
        chatThreads: {
            items: async (chatId) => chats.get(chatId)?.thread.list() ?? (await chats.readChat(chatId))?.items ?? null,
            info: async (chatId) => chats.get(chatId)?.info ?? (await chats.readChat(chatId))?.info ?? null
        },
        chatPrompts: {
            running: (chatId) => chats.get(chatId) !== undefined,
            send: (chatId, text, delivery) => chats.send(chatId, text, delivery === undefined ? {} : { delivery }),
            clear: (chatId) => chats.clear(chatId, true)
        },
        terminals: {
            agentOf: (sessionId) => {
                const session = sessions.get(sessionId);
                return session === undefined ? undefined : (session.agent ?? null);
            }
        }
    };
}

/* The services the agent verbs reach the daemon through. */
export function wireCanvasHost(input: CanvasHostInput): CanvasHost {
    const { identity, stores, providers, agents, work, launches, git, devices, databases, remote, usage, later } = input;
    const { lineage, outbox, tasks } = stores;
    const { sessions, chats } = agents;
    const { store: projects } = input.projects;
    const enqueue = work.worker.enqueue.bind(work.worker);
    const host: CanvasHost = {
        projects,
        hiddenAgents: projects.hiddenAgents,
        startClaims: input.projects.startClaims,
        lineage,
        starts: agentStartHost({
            installed: async () => (await providers.providers.list()).filter((provider) => provider.installed).map((provider) => provider.kind),
            prompts: stores.prompts,
            enqueue,
            chats,
            sessions,
            lineage,
            openedCount: (callerId) => openedAgentCount({ lineage, hiddenAgents: projects.hiddenAgents, tasks, outbox, chats, sessions }, callerId),
            accountsOff: (projectId, kind) => projects.index.accountsOf(projectId)?.[kind]?.off ?? []
        }),
        checkouts: git.checkouts,
        untrusted: agents.untrusted,
        remote: {
            machines: (projectId) =>
                projects.remote.linksOf(projectId).map((link) => ({
                    machineId: link.machineId,
                    label: link.label,
                    remoteProjectId: link.remoteProjectId,
                    ready: remote.machines.get(link.machineId) !== null
                })),
            give: (projectId, nodeId, payload) => enqueue(projectId, nodeId, { kind: 'start-remote-agent', payload })
        },
        machine: identity,
        endSession: input.projects.endSession,
        messages: agentMessages({ notices: stores.notices, sessions, chats, projects, enqueue, push: later.push }),
        diagrams: input.projects.diagrams,
        drawings: input.projects.drawings,
        tasks: work.tasks.host,
        plans: agents.plans,
        worktrees: worktreeHost(git.worktrees, git.merges),
        browsers: devices.browserDriver,
        agents: agentStates({ outbox, lineage, chats, sessions }),
        requests: chatRequests(chats),
        ...chatAccess(chats, sessions),
        computer: devices.computer,
        devices: devices.deviceDriver,
        context: agents.context,
        launches: launches.agentHost,
        agentImages: { attach: (chatId, upload) => chats.attachAgentImage(chatId, upload) },
        visuals: agentVisuals({ enabled: () => identity.visualReplies, visuals: agents.visuals, chats, renderer: devices.visualRenderer }),
        databases: databases.agents,
        language: new AgentLanguage({
            host: {
                forAgent: (projectId, request, languageWork) => later.language().forAgent(projectId, request, languageWork),
                programOf: (kind) => later.language().programOf(kind),
                cachedWorkspaceProblems: (projectId) => later.language().cachedWorkspaceProblems(projectId)
            },
            sql: databases.sqlAnalysis
        }),
        providerInstalls: {
            catalog: (refresh) => providers.registryAgents.catalog(refresh),
            versions: (refresh) => providers.versions.list(refresh)
        },
        planLimits: { snapshot: () => usage.limits.snapshot(), now: Date.now },
        secrets: launches.secrets,
        proposals: { inChats: (chatId) => chatIsInChats(projects, chatId), propose: (ask) => Promise.resolve(agents.proposals.ask(ask)) },
        snoozes: work.snoozes,
        artifacts: input.artifacts.artifacts,
        routines: agentRoutines(input.routines.routines, (id) => projects.index.titleFor(id)),
        templates: input.templates.store,
        reach: {
            enabled: () => identity.reachOpenProjects,
            open: async () =>
                (await projects.known()).filter((project) => project.folder !== projects.scratchFolder && projects.holdersOf(project.projectId).length > 0)
        }
    };
    const forkDeps = chatForkDeps({
        chats,
        host,
        titleFor: (id) => projects.index.titleFor(id),
        lineage,
        hiddenAgents: projects.hiddenAgents,
        worktrees: git.worktrees,
        checkpoints: agents.checkpoints
    });
    host.forks = { fork: (input, opener) => forkForAgent(forkDeps, input, opener) };
    return host;
}

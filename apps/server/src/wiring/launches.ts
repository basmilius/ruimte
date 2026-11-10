import { checkCwd } from '../canvas/project-paths.ts';
import { toplevel } from '../git/run.ts';
import { AfterSettleLaunches } from '../launches/after-settle.ts';
import type { LaunchHost } from '../launches/agent-host.ts';
import { agentLaunches } from '../launches/agent-host.ts';
import { LaunchRunner } from '../launches/runner.ts';
import { managerSessions } from '../launches/sessions.ts';
import { LaunchStore } from '../launches/store.ts';
import { foregroundGroup } from '../processes/foreground.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { SecretService } from '../secrets/secret-service.ts';
import { SecretStore } from '../secrets/secret-store.ts';
import type { AgentWorkBundle } from './agent-work.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { DaemonBundles } from './bundles.ts';
import type { Later } from './later.ts';

/* A project's launches and the secrets they start with. */
export interface LaunchesBundle {
    store: LaunchStore;
    runner: LaunchRunner;
    secrets: SecretService;
    agentHost: LaunchHost;
    /* The one launch a person chose to run after a worktree chat settles. */
    afterSettle: AfterSettleLaunches;
}

interface LaunchesInput {
    home: string;
    stores: AgentStores;
    agents: AgentsBundle;
    work: AgentWorkBundle;
    projects: ProjectStore;
    later: Later<Pick<DaemonBundles, 'git'>>;
}

export function wireLaunches({ home, stores, agents, work, projects, later }: LaunchesInput): LaunchesBundle {
    const { sessions, chats } = agents;
    const secretStore = new SecretStore(home);
    const store = new LaunchStore({
        projects: { folderOf: (projectId) => projects.index.folderOf(projectId), worktreePaths: (folder) => later.git().checkouts.paths(folder) },
        approvals: stores.commandApprovals,
        secrets: secretStore,
        afterSettle: work.afterSettleStore
    });
    const runner = new LaunchRunner({
        store,
        sessions: managerSessions(sessions, foregroundGroup),
        checkCwd: (folder, cwd) => checkCwd(folder, cwd, (inside) => later.git().checkouts.paths(inside)),
        resolveEnv: (projectId, launchId, env) => secretStore.resolveEnv(projectId, launchId, env)
    });
    const secrets = new SecretService({
        store: secretStore,
        launches: store,
        chats: { hold: (nodeId, key) => void chats.holdForPerson(nodeId, key), release: (nodeId, key) => chats.releaseHold(nodeId, key) }
    });
    secrets.follow(stores.lifecycle);
    const agentHost = agentLaunches(store, runner, (sessionId) => sessions.get(sessionId)?.plainText() ?? Promise.resolve(null));
    const afterSettle = new AfterSettleLaunches({
        store: work.afterSettleStore,
        chats,
        launches: store,
        runner,
        projectOf: (chatId) => projects.index.locate(chatId)?.projectId ?? null,
        isPeerChat: (chatId) => agents.untrusted.node(chatId),
        folderOf: (projectId) => projects.index.folderOf(projectId),
        worktreesOf: (folder) =>
            later
                .git()
                .worktrees.list(folder)
                .then((list) => list.filter((worktree) => worktree.missing !== true).map((worktree) => worktree.path))
                .catch(() => []),
        repoRootOf: (folder) => toplevel(folder),
        ofKind: (kind) => stores.outbox.ofKind(kind),
        enqueue: (projectId, chatId, entryWork) => agents.outboxLink.enqueue(projectId, chatId, entryWork)
    });
    agents.outboxLink.worker.handle('run-after-settle', (entry) => afterSettle.handle(entry));
    return { store, runner, secrets, agentHost, afterSettle };
}

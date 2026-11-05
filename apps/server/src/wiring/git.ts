import { MachineHome } from '../disk/machine-home.ts';
import { SharedWatch } from '../disk/shared-watch.ts';
import type { EndpointIdentity } from '../endpoint-id.ts';
import { errorText } from '../error-text.ts';
import { forgetSearchCache } from '../fs/search.ts';
import { FolderWatcher } from '../fs/watch.ts';
import { BundleStore } from '../git/bundles.ts';
import { Checkpoints } from '../git/checkpoints.ts';
import { forgetRepos } from '../git/repo-cache.ts';
import { GitStatusWatcher } from '../git/status-watcher.ts';
import { readStatusAt } from '../git/status.ts';
import { worktreeAgents } from '../git/worktree-agents.ts';
import { checkoutHost } from '../git/worktree-host.ts';
import { WorktreeMerge } from '../git/worktree-merge.ts';
import { Worktrees } from '../git/worktrees.ts';
import type { PeerLinks } from '../peering/links.ts';
import type { CheckoutHost } from '../tools/host.ts';
import type { AgentWorkBundle } from './agent-work.ts';
import type { AgentsBundle } from './agents.ts';

/* The folders of projects as files and as checkouts. */
export interface GitBundle {
    /* One platform watcher per folder for the file tree, git status and the language servers together. */
    watches: SharedWatch;
    folders: FolderWatcher;
    statuses: GitStatusWatcher;
    worktrees: Worktrees;
    merges: WorktreeMerge;
    checkouts: CheckoutHost;
    /* The bundles written for and received from other machines. */
    bundles: BundleStore;
    checkpoints: Checkpoints;
}

export function wireGit(home: string, identity: EndpointIdentity, agents: AgentsBundle, work: AgentWorkBundle, peers: PeerLinks): GitBundle {
    const watches = new SharedWatch();
    watches.onBurst(forgetSearchCache);
    watches.onBurst(forgetRepos);
    const folders = new FolderWatcher(process.platform, watches);
    const machineHome = new MachineHome(home);
    const statuses = new GitStatusWatcher(process.platform, watches, Date.now, (root) => readStatusAt(root, (top) => machineHome.stateWithin(top)));
    const agentsInWorktrees = worktreeAgents({
        chats: () => agents.chats.list(),
        sessions: () => agents.sessions.list(),
        stopNode: (nodeId, reason) => work.endChildren.stopNode(nodeId, reason)
    });
    const worktrees = new Worktrees(home, agentsInWorktrees, Date.now, () => identity.worktreeRoot, {
        branches: () => peers.peerBranches(),
        untrust: (path, branch) => peers.untrustFolder(path, branch)
    });
    const merges = new WorktreeMerge(worktrees, agentsInWorktrees);
    const bundles = new BundleStore(home);
    // Nothing is in flight at start, so what an earlier run left is of no one.
    bundles.sweep().catch((e: unknown) => console.warn('Clearing the bundles failed:', errorText(e)));
    return { watches, folders, statuses, worktrees, merges, checkouts: checkoutHost(worktrees), bundles, checkpoints: new Checkpoints(home) };
}

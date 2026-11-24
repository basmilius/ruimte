import { listRepos, repoLabel } from './repos.ts';
import { readGit, repositoryRoot } from './run.ts';

/* A checkout as a code host is looked for: where it is, what the git panel calls it, where it pushes and what is checked out. */
export interface HostCheckout {
    path: string;
    label: string;
    // `origin` first, since that is the remote a change is opened against.
    remotes: string[];
    // Null with a detached HEAD.
    branch: string | null;
}

/* What the code hosts of a project are found from; a seam, so a test names remotes without a repository. */
export interface HostCheckouts {
    /* Every checkout the git panel draws for a project folder. */
    repos(folder: string): Promise<HostCheckout[]>;
    /* The checkout a folder is in, such as the worktree a chat works in; null outside a repository. */
    of(folder: string): Promise<HostCheckout | null>;
}

export function parseRemotes(output: string): string[] {
    const remotes = output.split('\n').flatMap((entry) => {
        const match = /^remote\.(.+)\.url (.+)$/.exec(entry);

        return match?.[1] !== undefined && match[2] !== undefined ? [{ name: match[1], url: match[2] }] : [];
    });

    return [...remotes.filter((remote) => remote.name === 'origin'), ...remotes.filter((remote) => remote.name !== 'origin')].map((remote) => remote.url);
}

async function checkoutAt(path: string, label: string): Promise<HostCheckout> {
    const [remotes, branch] = await Promise.all([
        readGit(['config', '--get-regexp', '^remote\\..*\\.url$'], path),
        readGit(['symbolic-ref', '--short', '-q', 'HEAD'], path)
    ]);

    return { path, label, remotes: parseRemotes(remotes ?? ''), branch: branch?.trim() || null };
}

export const gitHostCheckouts: HostCheckouts = {
    async repos(folder) {
        const { repos } = await listRepos(folder);

        return Promise.all(repos.map((repo) => checkoutAt(repo.path, repo.label)));
    },
    async of(folder) {
        const root = await repositoryRoot(folder);

        return root === null ? null : checkoutAt(root, repoLabel(folder, root));
    }
};

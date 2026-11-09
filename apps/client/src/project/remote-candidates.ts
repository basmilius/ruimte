import type { GitIdentity, GitIdentityMiss } from '@ruimte/contracts';

/* A project of the other machine that could be this project's checkout there. */
export interface RemoteCandidate {
    projectId: string;
    name: string;
    folder: string;
    /* It holds the same repository: one of its first commits is one of ours. */
    same: boolean;
    branch: string | null;
    /* The tips of HEAD and the local branches there, which is what a bundle sent to it can leave out. */
    heads: string[];
    /* Whether it has an `origin`; a branch can travel through it only when both sides do. */
    remoteUrl: string | null;
}

interface RemoteProject {
    projectId: string;
    name: string;
    folder: string;
}

/*
 * The projects of the other machine that are repositories, the ones with a root commit in common with
 * ours first. A folder that is no repository cannot be a checkout of one, so it is left out; a
 * repository with another history stays, since a person may mean it.
 */
export function rankCandidates(
    local: Pick<GitIdentity, 'rootCommits'> | null,
    projects: readonly RemoteProject[],
    identities: readonly (GitIdentity | GitIdentityMiss)[]
): RemoteCandidate[] {
    const ours = new Set(local?.rootCommits ?? []);
    const candidates = projects.flatMap<RemoteCandidate>((project) => {
        const identity = identities.find((entry) => entry.path === project.folder);
        if (identity === undefined || 'error' in identity) {
            return [];
        }
        return [
            {
                ...project,
                same: identity.rootCommits.some((commit) => ours.has(commit)),
                branch: identity.branch ?? null,
                heads: identity.heads,
                remoteUrl: identity.remoteUrl ?? null
            }
        ];
    });
    return [...candidates.filter((candidate) => candidate.same), ...candidates.filter((candidate) => !candidate.same)];
}

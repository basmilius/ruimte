import type { GitRepo } from '@ruimte/contracts';
import { create } from 'zustand';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { shownFolderOf, useProject } from '@/state/project';
import { machineFor } from '@/transport/connections';

/* A repository of the project folder that has a branch out, which is what a pull request hangs on. */
export interface PrRepo {
    path: string;
    label: string;
}

interface PrReposState {
    /* The folder these repositories belong to, so another project never shows them. */
    key: string;
    repos: readonly PrRepo[];
}

export const usePrRepos = create<PrReposState>(() => ({ key: '', repos: [] }));

/* The repositories with a branch of the project on screen; empty until read, and for any other project. */
export function prReposOfCurrent(): readonly PrRepo[] {
    const folder = shownFolderOf(useProject.getState().current);
    const { key, repos } = usePrRepos.getState();
    return folder !== null && key === endpointKey(currentEndpointId(), folder) ? repos : [];
}

const NO_REPOS: readonly PrRepo[] = [];

/* The same list as `prReposOfCurrent`, for a component that redraws when it moves. */
export function useCurrentPrRepos(): readonly PrRepo[] {
    const folder = useProject((state) => shownFolderOf(state.current));
    const endpointId = useProject((state) => state.currentEndpointId);
    const { key, repos } = usePrRepos();
    return folder !== null && key === endpointKey(endpointId ?? currentEndpointId(), folder) ? repos : NO_REPOS;
}

/* Reads which repositories the folder holds and which of them stand on a branch. */
export async function refreshPrRepos(): Promise<void> {
    const folder = shownFolderOf(useProject.getState().current);
    const endpointId = currentEndpointId();
    const transport = machineFor(endpointId)?.transport;
    if (folder === null || !transport) {
        return;
    }
    const key = endpointKey(endpointId, folder);
    try {
        const { repos } = await transport.request('git.repos', { folder });
        const states = await Promise.all(repos.map((repo) => branchOf(transport, repo)));
        usePrRepos.setState({ key, repos: states.filter((repo): repo is PrRepo => repo !== null) });
    } catch {
        // A machine without the verb has the folder as its one repository; the single entry then uses the folder.
        usePrRepos.setState({ key, repos: [] });
    }
}

async function branchOf(transport: NonNullable<ReturnType<typeof machineFor>>['transport'], repo: GitRepo): Promise<PrRepo | null> {
    try {
        const status = await transport.request('git.status', { cwd: repo.path });
        return status.branch === null ? null : { path: repo.path, label: repo.label };
    } catch {
        return null;
    }
}

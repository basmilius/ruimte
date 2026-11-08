import type { GitCompareMode, GitRef } from '@ruimte/contracts';
import { create } from 'zustand';
import { openCompareTab, openSnapshotTab, useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';

/* What the comparison dialog starts from; whatever is left out the dialog chooses itself. */
export interface BranchCompareSeed {
    cwd?: string;
    from?: string;
    to?: string;
    mode?: GitCompareMode;
}

interface BranchCompareRequest extends BranchCompareSeed {
    /* Goes up on every ask, so the dialog starts over from a new seed. */
    key: number;
    /* The project it was asked in; a dialog never outlives a switch to another. */
    projectId: string;
}

export const useBranchCompare = create<{ request: BranchCompareRequest | null }>(() => ({ request: null }));

let asked = 0;

/* Opens the comparison dialog for the project on screen. */
export function showBranchCompare(seed: BranchCompareSeed = {}): void {
    const projectId = useProject.getState().current?.projectId;

    if (projectId === undefined) {
        return;
    }

    useBranchCompare.setState({ request: { ...seed, key: (asked += 1), projectId } });
}

export function closeBranchCompare(): void {
    useBranchCompare.setState({ request: null });
}

/* Opens the comparison as a tab of this session. Nothing is stored. */
export function openComparison(cwd: string, from: string, to: string, mode: GitCompareMode): void {
    useFiles.getState().show(openCompareTab(useFiles.getState(), cwd, from, to, mode), useSettings.getState().filesTabLimit);
}

/* Opens one file of a pinned commit, read-only, as a tab of this session. */
export function openSnapshot(cwd: string, commit: string, branch: string, path: string): void {
    useFiles.getState().show(openSnapshotTab(useFiles.getState(), cwd, commit, branch, path), useSettings.getState().filesTabLimit);
}

/* A ref as a person reads it: `main` for `refs/heads/main`. */
export function refLabel(ref: string): string {
    return ref.replace(/^refs\/(heads|remotes)\//, '');
}

/* The name that picks this ref and no other, which a local branch and a remote one with the same short name need. */
export function fullRefName(ref: GitRef): string {
    return ref.fullName ?? `refs/${ref.kind === 'local' ? 'heads' : 'remotes'}/${ref.name}`;
}

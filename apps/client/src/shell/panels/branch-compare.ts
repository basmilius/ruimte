import { create } from 'zustand';
import type { GitCompareMode, GitRef } from '@ruimte/contracts';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { openSessionTab, useFiles } from '@/state/files';
import { useSettings } from '@/state/settings';

interface CompareRequest {
    key: number;
    endpointId: string;
    projectId: string;
    cwd?: string;
    from?: string;
    to?: string;
}

export const useBranchCompare = create<{ request: CompareRequest | null }>(() => ({ request: null }));
let nextRequest = 0;

export function showBranchCompare(cwd?: string, to?: string, from?: string): void {
    const projectId = useProject.getState().current?.projectId;
    if (projectId === undefined) {
        return;
    }
    useBranchCompare.setState({ request: { key: ++nextRequest, endpointId: currentEndpointId(), projectId, cwd, from, to } });
}

export function closeBranchCompare(): void {
    useBranchCompare.setState({ request: null });
}

export function openComparison(cwd: string, from: string, to: string, mode: GitCompareMode): void {
    const files = useFiles.getState();
    files.show(openSessionTab(files, { kind: 'compare', cwd, from, to, mode }), useSettings.getState().filesTabLimit);
}

export function openSnapshot(cwd: string, commit: string, branch: string, path: string, line?: number): void {
    const files = useFiles.getState();
    files.show(
        openSessionTab(files, { kind: 'snapshot', cwd, commit, branch, path, ...(line === undefined ? {} : { line }) }),
        useSettings.getState().filesTabLimit
    );
}

export function refLabel(ref: string): string {
    return ref.replace(/^refs\/(heads|remotes)\//, '');
}

export function fullRefName(ref: GitRef): string {
    return ref.fullName ?? `refs/${ref.kind === 'local' ? 'heads' : 'remotes'}/${ref.name}`;
}

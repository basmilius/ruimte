import { create } from 'zustand';
import { artifactTabKey, openArtifactTab, useFiles } from '@/state/files';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';

export const useArtifactSelection = create<{ versions: Readonly<Record<string, string>> }>(() => ({ versions: {} }));

export function selectArtifactVersion(artifactId: string, versionId: string | null, machineId?: string): void {
    const key = artifactTabKey(artifactId, machineId);
    useArtifactSelection.setState((state) => {
        const { [key]: _was, ...rest } = state.versions;
        return { versions: versionId === null ? rest : { ...rest, [key]: versionId } };
    });
}

/*
 * An artifact as a loose view of the window's project, the way a file opens from the files panel;
 * `machineId` names another machine of the account it is kept on.
 */
export function openArtifact(artifactId: string, title: string, versionId: string | null = null, machineId?: string): void {
    selectArtifactVersion(artifactId, versionId, machineId);
    const files = useFiles.getState();
    files.show(openArtifactTab(files, artifactId, title, machineId), useSettings.getState().filesTabLimit);
}

/* A project the panel is asked to show, taken by the panel when it draws; null once taken. */
export const useOutputRequest = create<{ project: { projectId: string } | null }>(() => ({ project: null }));

export function showProjectOutput(projectId: string): void {
    useOutputRequest.setState({ project: { projectId } });
    useUi.getState().setPanel({ open: true, kind: 'output' });
}

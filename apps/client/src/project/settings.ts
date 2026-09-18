import type { ProjectIconChoice, ProjectSummary } from '@ruimte/contracts';
import { ensureMachine } from '@/endpoint/reach';
import { useProjectList } from '@/state/project-list';
import { transportFor, type Transport } from '@/transport';

export interface ProjectSettingsResult {
    endpointId: string;
    summary: ProjectSummary;
}

const connectedTransport = async (endpointId: string): Promise<{ endpointId: string; transport: Transport }> => {
    const connectedId = await ensureMachine(endpointId);
    const transport = transportFor(connectedId);
    if (!transport) {
        throw new Error('That machine is no longer connected');
    }
    return { endpointId: connectedId, transport };
};

const remember = (endpointId: string, summary: ProjectSummary): ProjectSettingsResult => {
    useProjectList.getState().patchProject(endpointId, summary);
    return { endpointId, summary };
};

export const setProjectIdentity = async (
    endpointId: string,
    projectId: string,
    identity: { name?: string; icon?: ProjectIconChoice | null }
): Promise<ProjectSettingsResult> => {
    const connected = await connectedTransport(endpointId);
    const { summary } = await connected.transport.request('project.setIdentity', { projectId, ...identity });
    return remember(connected.endpointId, summary);
};

export const uploadProjectIcon = async (endpointId: string, projectId: string, mime: string, base64: string): Promise<ProjectSettingsResult> => {
    const connected = await connectedTransport(endpointId);
    const cleared = await connected.transport.request('project.setIdentity', { projectId, icon: null });
    remember(connected.endpointId, cleared.summary);
    const { summary } = await connected.transport.request('project.setIcon', { projectId, image: { mime, base64 } });
    return remember(connected.endpointId, summary);
};

export const setProjectFolderIcon = async (endpointId: string, projectId: string): Promise<ProjectSettingsResult> => {
    const connected = await connectedTransport(endpointId);
    const cleared = await connected.transport.request('project.setIdentity', { projectId, icon: null });
    remember(connected.endpointId, cleared.summary);
    const { summary } = await connected.transport.request('project.setIcon', { projectId, image: null });
    return remember(connected.endpointId, summary);
};

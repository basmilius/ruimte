import i18next from 'i18next';
import type { ProjectIconChoice, ProjectSummary } from '@ruimte/contracts';
import { ensureMachine } from '@/endpoint/reach';
import { useProjectList } from '@/state/project-list';
import { transportFor, type Transport } from '@/transport';

export interface ProjectSettingsResult {
    endpointId: string;
    summary: ProjectSummary;
}

async function connectedTransport(endpointId: string): Promise<{ endpointId: string; transport: Transport }> {
    const connectedId = await ensureMachine(endpointId);
    const transport = transportFor(connectedId);
    if (!transport) {
        throw new Error(i18next.t('project:error.machineDisconnected'));
    }
    return { endpointId: connectedId, transport };
}

function remember(endpointId: string, summary: ProjectSummary): ProjectSettingsResult {
    useProjectList.getState().patchProject(endpointId, summary);
    return { endpointId, summary };
}

export async function setProjectIdentity(
    endpointId: string,
    projectId: string,
    identity: { name?: string; icon?: ProjectIconChoice | null }
): Promise<ProjectSettingsResult> {
    const connected = await connectedTransport(endpointId);
    const { summary } = await connected.transport.request('project.setIdentity', { projectId, ...identity });
    return remember(connected.endpointId, summary);
}

/* Clears a picked icon first, so the image (or, with null, the folder's own icon) is what shows. */
async function setIconImage(endpointId: string, projectId: string, image: { mime: string; base64: string } | null): Promise<ProjectSettingsResult> {
    const connected = await connectedTransport(endpointId);
    const cleared = await connected.transport.request('project.setIdentity', { projectId, icon: null });
    remember(connected.endpointId, cleared.summary);
    const { summary } = await connected.transport.request('project.setIcon', { projectId, image });
    return remember(connected.endpointId, summary);
}

export function uploadProjectIcon(endpointId: string, projectId: string, mime: string, base64: string): Promise<ProjectSettingsResult> {
    return setIconImage(endpointId, projectId, { mime, base64 });
}

export function setProjectFolderIcon(endpointId: string, projectId: string): Promise<ProjectSettingsResult> {
    return setIconImage(endpointId, projectId, null);
}

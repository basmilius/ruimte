import type { HostMenuAction } from '@adecore/agents-react';
import { messageOf } from '@adecore/ui';
import type { ArtifactSaveSource } from '@ruimte/contracts';
import i18next from 'i18next';
import { PackagePlus } from 'lucide-react';
import { newRequestId } from '@/output/artifacts';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { machineTransport, pool } from '@/transport';
import { machineAnswers, useMachineAnswers } from '@/transport/features';

/*
 * Keeps something a chat showed in Output, as a person asked. The machine records who saved it and in
 * which chat; nothing here claims either. A fresh request id per click, so the machine lands it once.
 */
export async function saveToOutput(endpointId: string, projectId: string, source: ArtifactSaveSource, title?: string): Promise<boolean> {
    try {
        await machineTransport(endpointId).request('artifact.save', {
            projectId,
            requestId: newRequestId(),
            source,
            ...(title === undefined || title.trim() === '' ? {} : { title: title.trim().slice(0, 200) })
        });
        useToasts.getState().show({ kind: 'success', title: i18next.t('output:chat.saved') });
        return true;
    } catch (error) {
        useToasts.getState().show({
            kind: 'error',
            title: i18next.t('output:chat.saveFailed'),
            description: messageOf(error)
        });
        return false;
    }
}

/* The project a chat on screen belongs to: the window's, and only on the machine the window shows it from. */
function outputProjectFor(endpointId: string): string | null {
    const { current, currentEndpointId } = useProject.getState();
    if (current === null || currentEndpointId !== endpointId || !machineAnswers(pool.statusOf(endpointId), 'artifact.save')) {
        return null;
    }
    return current.projectId;
}

export function useOutputProject(endpointId: string): string | null {
    const answers = useMachineAnswers(endpointId, 'artifact.save');
    const projectId = useProject((s) => (s.currentEndpointId === endpointId ? (s.current?.projectId ?? null) : null));
    return answers ? projectId : null;
}

export function saveToOutputActions(endpointId: string, source: ArtifactSaveSource, title?: string): readonly HostMenuAction[] {
    const projectId = outputProjectFor(endpointId);
    if (projectId === null) {
        return [];
    }
    return [
        {
            id: 'save-to-output',
            label: i18next.t('output:chat.save'),
            icon: PackagePlus,
            run: () => void saveToOutput(endpointId, projectId, source, title)
        }
    ];
}

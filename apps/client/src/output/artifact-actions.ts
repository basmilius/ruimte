import { isCanvasView, type Artifact, type ArtifactVersion } from '@ruimte/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createNodeAction } from '@/actions/client-actions';
import { useLinkedMachines } from '@/output/linked-machines';
import { openArtifact } from '@/output/open';
import { showView } from '@/project/views';
import { canvasSettled } from '@/state/canvas';
import { useEndpointId } from '@/state/current-endpoint';
import { useDocument } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { machineTransport } from '@/transport';
import { TransportError } from '@/transport-api/transport';
import { useMachineAnswers } from '@/transport/features';

/* The canvases of the window's project an artifact can be pinned to. */
export function usePinCanvases() {
    const views = useDocument((s) => s.views);
    return views.filter((view) => isCanvasView(view) && view.hidden !== true);
}

/*
 * Puts the artifact on a canvas of the window's project, staying on `version` unless that is null, when
 * the node follows the latest. The artifact is the window's machine's, and so is every canvas of the
 * project on it, so a node never points at another machine's Output.
 */
export async function pinArtifact(artifact: Artifact, version: string | null, viewId: string): Promise<void> {
    showView(viewId);
    if (!(await canvasSettled(viewId))) {
        return;
    }
    await createNodeAction('artifact', {
        viewId,
        artifact: artifact.artifactId,
        title: artifact.title,
        ...(version === null ? {} : { artifactVersion: version })
    });
}

const COPY_FAILURES: Readonly<Record<string, string>> = {
    'machine-unreachable': 'copyHere.unreachable',
    'not-linked': 'copyHere.unlinked',
    'not-found': 'copyHere.gone',
    'hash-mismatch': 'copyHere.mismatch',
    'bad-reply': 'copyHere.mismatch',
    'disk-full': 'copyHere.diskFull',
    'too-large': 'copyHere.tooLarge'
};

interface MachineCopy {
    copying: boolean;
    /* What the copy does, for a tooltip. */
    tip: string;
    copy(version: ArtifactVersion): void;
}

/*
 * Copies a version another machine keeps into Output of the window's project on the window's machine.
 * Null where that does not work: the window's machine copies, and it does so over the link its project
 * has to the other machine's project, so an artifact of any other project there is not offered.
 */
export function useCopyToThisMachine(machineId: string, artifact: Artifact): MachineCopy | null {
    const { t } = useTranslation('output');
    const endpointId = useEndpointId();
    const answers = useMachineAnswers(endpointId, 'artifact.importFrom');
    const project = useProject((s) => s.current);
    const links = useLinkedMachines();
    const link = links.find((candidate) => candidate.machineId === machineId && candidate.remoteProjectId === artifact.projectId);
    const machine = useEndpoints((s) => s.endpoints.find((entry) => entry.id === machineId || entry.daemonId === machineId)?.label) ?? link?.label ?? '';
    const [copying, setCopying] = useState(false);
    if (!answers || project === null || link === undefined) {
        return null;
    }

    const copy = (version: ArtifactVersion): void => {
        setCopying(true);
        machineTransport(endpointId)
            .request('artifact.importFrom', { machineId, artifactId: artifact.artifactId, versionId: version.versionId, projectId: project.projectId })
            .then(({ artifactId }) => {
                useToasts.getState().show({ kind: 'success', title: t('copyHere.copied'), description: t('copyHere.copiedDetail', { project: project.name }) });
                openArtifact(artifactId, artifact.title);
            })
            .catch((failure: unknown) => {
                const code = failure instanceof TransportError ? failure.code : '';
                useToasts.getState().show({ kind: 'error', title: t('copyHere.failed'), description: t(COPY_FAILURES[code] ?? 'copyHere.other', { machine }) });
            })
            .finally(() => setCopying(false));
    };

    return { copying, tip: t('copyHere.tip', { project: project.name }), copy };
}

/* Whether a person can remove Output here: only on the window's own machine, and only one that answers it. */
export function useCanRemove(endpointId: string, machineId: string | undefined): boolean {
    const answers = useMachineAnswers(endpointId, 'artifact.remove');
    return machineId === undefined && answers;
}

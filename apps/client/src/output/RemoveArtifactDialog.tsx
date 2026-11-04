import { PromptDialog } from '@adecore/ui';
import { formatBytes } from '@adecore/ui/format';
import type { Artifact, ArtifactVersion } from '@ruimte/contracts';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { selectArtifactVersion, useArtifactSelection } from '@/output/open';
import { useEndpoints } from '@/state/endpoints';
import { artifactTabKey, useFiles } from '@/state/files';
import { useToasts } from '@/state/toasts';
import { machineTransport } from '@/transport';

/*
 * One opening of the remove question. It stays after a close, so the dialog keeps what it showed
 * while it fades out. `version` null is the artifact whole.
 */
export interface RemoveArtifactRequest {
    artifact: Artifact;
    version: ArtifactVersion | null;
    versionCount: number;
    /* What the artifact holds in all its versions. */
    totalBytes: number;
    open: boolean;
}

/*
 * Asks before an artifact or one version of it goes for good, then removes it on the machine. The
 * last version takes the artifact with it, and an artifact that went closes its view.
 */
export function RemoveArtifactDialog({ endpointId, request, onClose }: { endpointId: string; request: RemoveArtifactRequest | null; onClose(): void }) {
    const { t } = useTranslation('output');
    const machine = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId)?.label ?? '');
    if (request === null) {
        return null;
    }
    const { artifact, version } = request;
    const whole = version === null || request.versionCount === 1;

    const confirm = async (): Promise<void> => {
        const result = await machineTransport(endpointId).request('artifact.remove', {
            artifactId: artifact.artifactId,
            ...(version === null ? {} : { versionIds: [version.versionId] })
        });
        const tabKey = artifactTabKey(artifact.artifactId);
        if (whole && useFiles.getState().tabs.some((tab) => tab.key === tabKey)) {
            useFiles.getState().close(tabKey);
        }
        // The view goes back to the latest rather than saying the version it showed is gone.
        if (version !== null && useArtifactSelection.getState().versions[tabKey] === version.versionId) {
            selectArtifactVersion(artifact.artifactId, null);
        }
        useToasts.getState().show({ kind: 'success', title: t('remove.removed'), description: t('remove.freed', { size: formatBytes(result.freedBytes) }) });
        onClose();
    };

    const description =
        version === null
            ? t('remove.description', { count: request.versionCount, size: formatBytes(request.totalBytes), machine })
            : t('remove.versionDescription', { size: formatBytes(version.bytes), machine });
    return (
        <PromptDialog
            open={request.open}
            title={version === null ? t('remove.title', { title: artifact.title }) : t('remove.versionTitle', { number: version.number })}
            description={
                version !== null && whole ? (
                    <>
                        {description} {t('remove.lastVersion', { title: artifact.title })}
                    </>
                ) : (
                    description
                )
            }
            confirmLabel={t('remove.confirm')}
            confirmIcon={Trash2}
            danger
            fallbackMessage={t('remove.failed')}
            onConfirm={confirm}
            onOpenChange={onClose}
        />
    );
}

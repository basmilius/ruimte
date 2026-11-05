import type { ArtifactSummary, ArtifactVersion } from '@ruimte/contracts';
import { Fragment, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { startArtifactDrag } from '@/output/artifact-drag';
import { useOpenArtifact } from '@/output/artifact-opener';
import { OutputShownBesideContext } from '@/output/chat-scope';
import { KindTile } from '@/output/look';
import { savedPreviewOf } from '@/output/saved-preview';
import { SavedPreview } from '@/output/SavedPreview';
import { setDragging } from '@/surface/view-drag';

export interface Saved {
    artifact: Pick<ArtifactSummary, 'artifactId' | 'title' | 'kind'>;
    version: ArtifactVersion;
    latest: boolean;
}

/*
 * The versions a turn of a chat saved, as one block of tight rows; the timeline gives it the room around it.
 * An artifact's last version in the block shows what it holds under its row when one of its files draws inline.
 */
export function SavedCard({ endpointId, saved }: { endpointId: string; saved: readonly Saved[] }) {
    const shownBeside = useContext(OutputShownBesideContext);
    return (
        <div className="flex flex-col">
            {saved.map((entry, index) => {
                const preview =
                    entry.artifact.artifactId === shownBeside || saved.slice(index + 1).some((later) => later.artifact.artifactId === entry.artifact.artifactId)
                        ? null
                        : savedPreviewOf(entry.version);
                return (
                    <Fragment key={entry.version.versionId}>
                        <SavedRow {...entry} />
                        {preview !== null && <SavedPreview endpointId={endpointId} entry={entry} preview={preview} />}
                    </Fragment>
                );
            })}
        </div>
    );
}

function SavedRow({ artifact, version, latest }: Saved) {
    const { t } = useTranslation('output');
    const open = useOpenArtifact();
    const what = version.number === 1 ? t('card.saved') : t('card.savedVersion', { number: version.number });
    return (
        <button
            type="button"
            aria-label={t('card.row', { title: artifact.title, what })}
            className="-mx-1 flex h-8 w-[calc(100%+8px)] min-w-0 items-center gap-2 rounded-md px-1 text-left text-sm text-text-muted hover:bg-surface-hover"
            onClick={() => open(artifact.artifactId, artifact.title, latest ? null : version.versionId, version.versionId)}
            draggable
            onDragStart={(event) => startArtifactDrag(event.dataTransfer, artifact)}
            onDragEnd={() => setDragging(null)}
        >
            <KindTile kind={artifact.kind} size="sm" />
            <span className="min-w-0 shrink truncate font-medium text-text">{artifact.title}</span>
            <span className="shrink-0">{what}</span>
        </button>
    );
}

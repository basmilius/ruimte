import { EmptyState } from '@adecore/ui';
import type { ProjectArtifactView } from '@ruimte/contracts';
import { Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ArtifactView } from '@/output/ArtifactView';
import { useDocument } from '@/state/document';

/*
 * An artifact as a view of the project. Which artifact is one person's on this machine and stays in
 * the private overlay, so a view that arrives without it says it is not here. The version stays with
 * the view, following the latest until a person picks another.
 */
export function ArtifactViewBody({ view }: { view: ProjectArtifactView }) {
    const { t } = useTranslation('output');
    const reference = view.node.artifact;
    if (reference === undefined) {
        return (
            <div className="grid h-full place-items-center">
                <EmptyState icon={Package}>
                    <span className="flex flex-col gap-1">
                        <span className="text-text">{t('node.notHere')}</span>
                        <span>{t('node.notHereDetail')}</span>
                    </span>
                </EmptyState>
            </div>
        );
    }
    const pin = {
        version: reference.version ?? null,
        set: (version: string | null): void =>
            useDocument.getState().updateStandalone(view.id, { artifact: { id: reference.id, ...(version === null ? {} : { version }) } })
    };
    return (
        <div className="flex h-full min-h-0 flex-col">
            <ArtifactView artifactId={reference.id} pin={pin} />
        </div>
    );
}

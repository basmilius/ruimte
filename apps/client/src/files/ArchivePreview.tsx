import { ErrorBoundary, lazyNamed, LazyBoundary } from '@adecore/ui';
import type { FsReadBinary } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { UnsupportedFile } from '@/files/UnsupportedFile';
import { useEndpointId } from '@/state/current-endpoint';
import { useMachineAnswers } from '@/transport/features';

const ArchiveFile = lazyNamed(() => import('@/files/ArchiveFile'), 'ArchiveFile');

/* A machine from before `archive.list` has nothing to list an archive with, so it gets what any other binary gets. */
export function ArchivePreview({ path, name, read }: { path: string; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const answers = useMachineAnswers(endpointId, 'archive.list');
    if (!answers) {
        return <UnsupportedFile path={path} name={name} read={read} />;
    }
    return (
        <ErrorBoundary label={t('file.archive.crashed')} resetKeys={[path, read.mtime, read.size]} className="min-h-0 grow">
            <LazyBoundary>
                <ArchiveFile path={path} name={name} read={read} />
            </LazyBoundary>
        </ErrorBoundary>
    );
}

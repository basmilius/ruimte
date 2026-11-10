import { ErrorBoundary, lazyNamed, LazyBoundary } from '@adecore/ui';
import type { FsReadBinary } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { sourceKey, type FileSource } from '@/surface/panels/file-source';

// The 3D engine and its loaders are most of a megabyte, so they wait for the first model or for the prefetcher.
const ModelFile = lazyNamed(() => import('@/files/ModelFile'), 'ModelFile');

export function ModelPreview({ source, name, read }: { source: FileSource; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    return (
        <ErrorBoundary label={t('file.model.crashed')} resetKeys={[sourceKey(source, read)]} className="min-h-0 grow">
            <LazyBoundary>
                <ModelFile source={source} name={name} read={read} />
            </LazyBoundary>
        </ErrorBoundary>
    );
}

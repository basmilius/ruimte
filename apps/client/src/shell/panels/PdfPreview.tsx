import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { FsReadBinary } from '@ruimte/contracts';
import { ErrorBoundary, lazyNamed } from '@adecore/ui';

// pdf.js is most of a megabyte, so it waits for the first PDF or for the prefetcher.
const PdfFile = lazyNamed(() => import('@/shell/panels/PdfFile'), 'PdfFile');

export function PdfPreview({ path, name, read }: { path: string; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    return (
        <ErrorBoundary label={t('file.pdf.crashed')} resetKeys={[path, read.mtime, read.size]} className="min-h-0 grow">
            <Suspense fallback={null}>
                <PdfFile path={path} name={name} read={read} />
            </Suspense>
        </ErrorBoundary>
    );
}

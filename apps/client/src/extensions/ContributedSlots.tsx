import { ErrorBoundary } from '@adecore/ui';
import { createElement, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useContributions, type CanvasLayerContribution } from '@/state/extension-registry';

/* What extensions draw over the canvas, each behind a boundary of its own so one failure never takes the canvas along. */
export function CanvasLayers({ place, z }: { place: CanvasLayerContribution['place']; z: number }) {
    const { t } = useTranslation('shell');
    const layers = useContributions((state) => state.canvasLayers);

    return layers
        .filter((layer) => layer.place === place)
        .map((layer) => (
            <ErrorBoundary key={layer.id} label={t('extensions.failed')} resetKeys={[layer]} compact>
                <Suspense fallback={null}>{createElement(layer.component, { z })}</Suspense>
            </ErrorBoundary>
        ));
}

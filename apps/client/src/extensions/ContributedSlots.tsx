import { ErrorBoundary } from '@adecore/ui';
import { createElement, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useContributions, type CanvasLayerContribution, type ViewAccessoryContribution, type ViewAccessoryProps } from '@/state/extension-registry';

/* What built-ins draw over the canvas, each behind a boundary of its own so one failure never takes the canvas along. */
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

/* What built-ins add beside a chat's composer or in a terminal view's bar. */
export function ViewAccessories({ on, ...props }: { on: ViewAccessoryContribution['on'] } & ViewAccessoryProps) {
    const { t } = useTranslation('shell');
    const accessories = useContributions((state) => state.viewAccessories);

    return accessories
        .filter((accessory) => accessory.on === on)
        .map((accessory) => (
            <ErrorBoundary key={accessory.id} label={t('extensions.failed')} resetKeys={[accessory]} compact>
                <Suspense fallback={null}>{createElement(accessory.component, props)}</Suspense>
            </ErrorBoundary>
        ));
}

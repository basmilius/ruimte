import { Separator, DockShell, ZoomControls } from '@adecore/ui';
import { useTranslation } from 'react-i18next';
import { fitAction } from '@/actions/client-actions';
import { copyDiagram, exportDiagram } from '@/diagram/diagram-actions';
import { DockExportHistory } from '@/drawing/DockExportHistory';
import { useKeyOf } from '@/shell/shortcut-overrides';
import { useDiagram, useDiagramStore } from '@/state/diagram';
import { useSettings } from '@/state/settings';

/* Shaped like a drawing's dock. The JSON file's menu stays in the bar above the view, since it is about the file. */
export function DiagramDock() {
    const { t } = useTranslation('drawing');
    const store = useDiagramStore();
    const viewId = useDiagram((s) => s.viewId);
    const zoom = useDiagram((s) => s.camera.zoom);
    const empty = useDiagram((s) => s.content.nodes.length === 0);
    const canUndo = useDiagram((s) => s.past.length > 0);
    const canRedo = useDiagram((s) => s.future.length > 0);
    const dockAutoHide = useSettings((s) => s.dockAutoHide);
    const zoomKeys = { zoomReset: useKeyOf('zoom-reset'), fitAll: useKeyOf('fit') };
    const historyKeys = { undo: useKeyOf('edit-undo'), redo: useKeyOf('edit-redo') };

    return (
        <DockShell data-diagram-chrome autoHide={dockAutoHide} className="px-4">
            {/* A diagram has nothing to select, so it offers no zoom to a selection. */}
            <ZoomControls
                zoom={zoom}
                labels={{
                    presets: t('zoom.presets'),
                    fit: t('zoom.fit'),
                    fitEverything: t('zoom.fitEverything')
                }}
                shortcuts={zoomKeys}
                onZoomChange={(next) => store.getState().zoomTo(next)}
                onFitAll={() => fitAction(viewId)}
            />

            <Separator />

            <DockExportHistory
                viewId={viewId}
                empty={empty}
                canUndo={canUndo}
                canRedo={canRedo}
                shortcuts={historyKeys}
                onCopy={(format) => copyDiagram(store, format)}
                onSave={(format) => exportDiagram(store, format)}
            />
        </DockShell>
    );
}

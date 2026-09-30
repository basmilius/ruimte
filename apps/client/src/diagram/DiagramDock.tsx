import { useTranslation } from 'react-i18next';
import { Copy, Download, MoreHorizontal, Redo2, Undo2 } from 'lucide-react';
import { fitAction, historyAction } from '@/actions/client-actions';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { copyDiagram, exportDiagram } from '@/diagram/diagram-actions';
import { useDiagram, useDiagramStore } from '@/state/diagram';
import { ButtonGroup, Icon, IconButton, Separator, Menu, DockShell, ZoomControls } from '@basmilius/desktop-ui';
import { useSettings } from '@/state/settings';

/*
 * The diagram's dock: the zoom, the exports and the way back in the same place and the same shape as
 * a drawing has them. The way to the JSON file stays in the bar above the view, since it is about the file.
 */
export function DiagramDock() {
    const { t } = useTranslation('drawing');
    const store = useDiagramStore();
    const viewId = useDiagram((s) => s.viewId);
    const zoom = useDiagram((s) => s.camera.zoom);
    const empty = useDiagram((s) => s.content.nodes.length === 0);
    const canUndo = useDiagram((s) => s.past.length > 0);
    const canRedo = useDiagram((s) => s.future.length > 0);
    const dockAutoHide = useSettings((s) => s.dockAutoHide);

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
                shortcuts={CANVAS_SHORTCUTS}
                onZoomChange={(next) => store.getState().zoomTo(next)}
                onFitAll={() => fitAction(viewId)}
            />

            <Separator />

            <ButtonGroup>
                <Menu.Root>
                    <IconButton render={<Menu.Trigger />} icon={MoreHorizontal} label={t('export.label')} />
                    <Menu.Popup side="top" sideOffset={10} align="end" className="min-w-52">
                        <Menu.Item disabled={empty} onClick={() => copyDiagram(store, 'png')}>
                            <Icon icon={Copy} size={14} /> {t('export.copyPng')}
                        </Menu.Item>
                        <Menu.Item disabled={empty} onClick={() => exportDiagram(store, 'png')}>
                            <Icon icon={Download} size={14} /> {t('export.savePng')}
                        </Menu.Item>
                        <Menu.Item disabled={empty} onClick={() => copyDiagram(store, 'svg')}>
                            <Icon icon={Copy} size={14} /> {t('export.copySvg')}
                        </Menu.Item>
                        <Menu.Item disabled={empty} onClick={() => exportDiagram(store, 'svg')}>
                            <Icon icon={Download} size={14} /> {t('export.saveSvg')}
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Root>
                <IconButton
                    icon={Undo2}
                    label={t('common:action.undo')}
                    kbd={CANVAS_SHORTCUTS.undo}
                    disabled={!canUndo}
                    onClick={() => historyAction('undo', viewId)}
                />
                <IconButton
                    icon={Redo2}
                    label={t('common:action.redo')}
                    kbd={CANVAS_SHORTCUTS.redo}
                    disabled={!canRedo}
                    onClick={() => historyAction('redo', viewId)}
                />
            </ButtonGroup>
        </DockShell>
    );
}

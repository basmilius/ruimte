import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { Copy, Download, MoreHorizontal, Redo2, Undo2 } from 'lucide-react';
import { fitAction, historyAction } from '@/actions/client-actions';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { copyDiagramPng, copyDiagramSvg, saveDiagramPng, saveDiagramSvg } from '@/diagram/export';
import { useDiagram, useDiagramStore } from '@/state/diagram';
import { BTN_GROUP, MENU_LABEL } from '@/ui/classes';
import { DockShell } from '@/ui/DockShell';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';
import { ZoomControls } from '@/ui/ZoomControls';

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

    return (
        <DockShell data-diagram-chrome className="px-4">
            {/* A diagram has nothing to select, so it offers no zoom to a selection. */}
            <ZoomControls
                zoom={zoom}
                labels={{
                    out: t('zoom.out'),
                    in: t('zoom.in'),
                    presets: t('zoom.presets'),
                    fit: t('zoom.fit'),
                    fitEverything: t('zoom.fitEverything')
                }}
                shortcuts={CANVAS_SHORTCUTS}
                onZoomTo={(next) => store.getState().zoomTo(next)}
                onFitAll={() => fitAction(viewId)}
            />

            <Separator />

            <div className={BTN_GROUP}>
                <Menu.Root>
                    <Tooltip label={t('export.label')} name>
                        <Menu.Trigger className="icon-btn">
                            <Icon icon={MoreHorizontal} size={16} />
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={10} align="end">
                            <Menu.Popup className="menu-popup min-w-52">
                                <div className={MENU_LABEL}>{t('export.diagram')}</div>
                                <Menu.Item className="menu-item" disabled={empty} onClick={() => void copyDiagramPng(store)}>
                                    <Icon icon={Copy} size={14} /> {t('export.copyPng')}
                                </Menu.Item>
                                <Menu.Item className="menu-item" disabled={empty} onClick={() => void saveDiagramPng(store)}>
                                    <Icon icon={Download} size={14} /> {t('export.savePng')}
                                </Menu.Item>
                                <Menu.Item className="menu-item" disabled={empty} onClick={() => void copyDiagramSvg(store)}>
                                    <Icon icon={Copy} size={14} /> {t('export.copySvg')}
                                </Menu.Item>
                                <Menu.Item className="menu-item" disabled={empty} onClick={() => void saveDiagramSvg(store)}>
                                    <Icon icon={Download} size={14} /> {t('export.saveSvg')}
                                </Menu.Item>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
                <Tooltip label={t('common:action.undo')} kbd={CANVAS_SHORTCUTS.undo} name>
                    <button className="icon-btn" disabled={!canUndo} onClick={() => historyAction('undo', viewId)}>
                        <Icon icon={Undo2} size={16} />
                    </button>
                </Tooltip>
                <Tooltip label={t('common:action.redo')} kbd={CANVAS_SHORTCUTS.redo} name>
                    <button className="icon-btn" disabled={!canRedo} onClick={() => historyAction('redo', viewId)}>
                        <Icon icon={Redo2} size={16} />
                    </button>
                </Tooltip>
            </div>
        </DockShell>
    );
}

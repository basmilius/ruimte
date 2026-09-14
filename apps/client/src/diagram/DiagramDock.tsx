import { Menu } from '@base-ui-components/react/menu';
import { Check, Maximize, Minus, Plus } from 'lucide-react';
import { activeZoomPreset, ZOOM_PRESETS } from '@/canvas/math';
import { useDiagram, useDiagramStore } from '@/state/diagram';
import { BTN_GROUP, MENU_SEPARATOR } from '@/ui/classes';
import { DockShell } from '@/ui/DockShell';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/*
 * The diagram's dock: the zoom in the same place and the same shape as a canvas and a drawing have
 * it. What is about the file (the JSON, the exports) stays in the bar above the view.
 */
export function DiagramDock() {
    const store = useDiagramStore();
    const zoom = useDiagram((s) => s.camera.zoom);
    const preset = activeZoomPreset(zoom);

    return (
        <DockShell data-diagram-chrome className="px-4">
            <div className={BTN_GROUP}>
                <Tooltip label="Zoom out" name>
                    <button className="icon-btn" onClick={() => store.getState().zoomTo(Math.round(zoom * 100 - 10) / 100)}>
                        <Icon icon={Minus} size={16} />
                    </button>
                </Tooltip>
                <Menu.Root>
                    <Tooltip label="Zoom presets">
                        <Menu.Trigger className="h-8 min-w-14 rounded-lg px-1 text-xs tabular-nums text-text-muted hover:bg-surface-hover hover:text-text data-[popup-open]:bg-surface-active data-[popup-open]:text-text">
                            {Math.round(zoom * 100)}%
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={10} align="center">
                            <Menu.Popup className="menu-popup min-w-44">
                                <Menu.RadioGroup value={preset} onValueChange={(value: number) => store.getState().zoomTo(value / 100)}>
                                    {ZOOM_PRESETS.map((pct) => (
                                        <Menu.RadioItem key={pct} value={pct} className="menu-item">
                                            <span className="grid h-4 w-4 place-items-center">
                                                <Menu.RadioItemIndicator>
                                                    <Icon icon={Check} size={14} />
                                                </Menu.RadioItemIndicator>
                                            </span>
                                            <span className="tabular-nums">{pct}%</span>
                                        </Menu.RadioItem>
                                    ))}
                                </Menu.RadioGroup>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.Item className="menu-item" onClick={() => store.getState().fitAll()}>
                                    <span className="grid h-4 w-4 place-items-center">
                                        <Icon icon={Maximize} size={14} />
                                    </span>
                                    Zoom to fit
                                </Menu.Item>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
                <Tooltip label="Zoom in" name>
                    <button className="icon-btn" onClick={() => store.getState().zoomTo(Math.round(zoom * 100 + 10) / 100)}>
                        <Icon icon={Plus} size={16} />
                    </button>
                </Tooltip>
                <Tooltip label="Fit everything" name>
                    <button className="icon-btn" onClick={() => store.getState().fitAll()}>
                        <Icon icon={Maximize} size={16} />
                    </button>
                </Tooltip>
            </div>
        </DockShell>
    );
}

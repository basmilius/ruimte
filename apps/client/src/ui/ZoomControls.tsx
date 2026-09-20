import { Menu } from '@base-ui-components/react/menu';
import { Check, Maximize, Minus, Plus, Scan } from 'lucide-react';
import { activeZoomPreset, ZOOM_PRESETS } from '@/canvas/math';
import { BTN_GROUP, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Kbd } from '@/ui/Kbd';
import { Tooltip } from '@/ui/Tooltip';
import type { Shortcut } from '@/ui/shortcut';

interface ZoomSelection {
    label: string;
    shortcut: Shortcut;
    /* Nothing is selected, so the row is there but says so rather than doing nothing. */
    enabled: boolean;
    onZoom(): void;
}

/*
 * The words, from the caller. A dock reads its own namespace. The canvas has these sentences under
 * `shell:dock`, where the command palette reads two of them, and a drawing under `drawing:zoom`,
 * where its right-click menu reads two more, so neither set can move without leaving a reader behind.
 */
interface ZoomLabels {
    out: string;
    in: string;
    presets: string;
    fit: string;
    fitEverything: string;
}

interface ZoomControlsProps {
    zoom: number;
    labels: ZoomLabels;
    shortcuts: { zoomReset: Shortcut; fitAll: Shortcut };
    onZoomTo(zoom: number): void;
    onFitAll(): void;
    /* Left out by a surface with nothing to select, which is what a diagram is. */
    selection?: ZoomSelection;
}

/* Ten percent a click, on the readout's own rounded percent, so + and - come back where they were. */
const stepped = (zoom: number, by: number): number => Math.round(zoom * 100 + by) / 100;

/* The zoom group of a dock: out, the readout with its presets, in, and fit everything. */
export function ZoomControls({ zoom, labels, shortcuts, onZoomTo, onFitAll, selection }: ZoomControlsProps) {
    const preset = activeZoomPreset(zoom);

    return (
        <div className={BTN_GROUP}>
            <Tooltip label={labels.out} name>
                <button className="icon-btn" onClick={() => onZoomTo(stepped(zoom, -10))}>
                    <Icon icon={Minus} size={16} />
                </button>
            </Tooltip>
            <Menu.Root>
                <Tooltip label={labels.presets}>
                    <Menu.Trigger className="h-8 min-w-14 rounded-lg px-1 text-xs tabular-nums text-text-muted hover:bg-surface-hover hover:text-text data-[popup-open]:bg-surface-active data-[popup-open]:text-text">
                        {Math.round(zoom * 100)}%
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={10} align="center">
                        <Menu.Popup className="menu-popup min-w-44">
                            <Menu.RadioGroup value={preset} onValueChange={(value: number) => onZoomTo(value / 100)}>
                                {ZOOM_PRESETS.map((pct) => (
                                    <Menu.RadioItem key={pct} value={pct} className="menu-item">
                                        <span className="grid h-4 w-4 place-items-center">
                                            <Menu.RadioItemIndicator>
                                                <Icon icon={Check} size={14} />
                                            </Menu.RadioItemIndicator>
                                        </span>
                                        <span className="tabular-nums">{pct}%</span>
                                        {pct === 100 && <Kbd shortcut={shortcuts.zoomReset} />}
                                    </Menu.RadioItem>
                                ))}
                            </Menu.RadioGroup>
                            <Menu.Separator className={MENU_SEPARATOR} />
                            <Menu.Item className="menu-item" onClick={onFitAll}>
                                <span className="grid h-4 w-4 place-items-center">
                                    <Icon icon={Maximize} size={14} />
                                </span>
                                {labels.fit} <Kbd shortcut={shortcuts.fitAll} />
                            </Menu.Item>
                            {selection && (
                                <Menu.Item className="menu-item" disabled={!selection.enabled} onClick={selection.onZoom}>
                                    <span className="grid h-4 w-4 place-items-center">
                                        <Icon icon={Scan} size={14} />
                                    </span>
                                    {selection.label} <Kbd shortcut={selection.shortcut} />
                                </Menu.Item>
                            )}
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>
            <Tooltip label={labels.in} name>
                <button className="icon-btn" onClick={() => onZoomTo(stepped(zoom, 10))}>
                    <Icon icon={Plus} size={16} />
                </button>
            </Tooltip>
            <Tooltip label={labels.fitEverything} kbd={shortcuts.fitAll} name>
                <button className="icon-btn" onClick={onFitAll}>
                    <Icon icon={Maximize} size={16} />
                </button>
            </Tooltip>
        </div>
    );
}

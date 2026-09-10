import { Menu } from '@base-ui-components/react/menu';
import {
    Check,
    Circle,
    Diamond,
    Eraser,
    Hand,
    Lock,
    LockOpen,
    Maximize,
    Minus,
    MousePointer2,
    MoveUpRight,
    Palette,
    Pencil,
    Plus,
    Scan,
    Square,
    Type,
    Undo2,
    Redo2,
    Copy,
    Download,
    MoreHorizontal
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { DRAWING_COLORS, type DrawingColor } from '@ruimte/contracts';
import { activeZoomPreset, ZOOM_PRESETS } from '@/canvas/math';
import { copyDrawingPng, copyDrawingSvg, saveDrawingPng, saveDrawingSvg } from '@/drawing/export';
import { useDrawing, type DrawingStyle, type DrawingTool } from '@/state/drawing';
import { BTN_GROUP, FLOAT, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';

interface ToolRow {
    tool: DrawingTool;
    label: string;
    kbd: string;
    icon: typeof Square;
}

const TOOLS: ToolRow[] = [
    { tool: 'select', label: 'Select', kbd: 'V', icon: MousePointer2 },
    { tool: 'hand', label: 'Pan', kbd: 'H', icon: Hand },
    { tool: 'rect', label: 'Rectangle', kbd: 'R', icon: Square },
    { tool: 'diamond', label: 'Diamond', kbd: 'D', icon: Diamond },
    { tool: 'ellipse', label: 'Ellipse', kbd: 'O', icon: Circle },
    { tool: 'arrow', label: 'Arrow', kbd: 'A', icon: MoveUpRight },
    { tool: 'line', label: 'Line', kbd: 'L', icon: Minus },
    { tool: 'freehand', label: 'Draw', kbd: 'P', icon: Pencil },
    { tool: 'text', label: 'Text', kbd: 'T', icon: Type },
    { tool: 'eraser', label: 'Eraser', kbd: 'E', icon: Eraser }
];

const WIDTHS: Array<{ value: DrawingStyle['strokeWidth']; label: string }> = [
    { value: 1, label: 'Thin' },
    { value: 2, label: 'Medium' },
    { value: 4, label: 'Bold' }
];

const STROKE_STYLES: Array<{ value: DrawingStyle['strokeStyle']; label: string }> = [
    { value: 'solid', label: 'Solid' },
    { value: 'dashed', label: 'Dashed' },
    { value: 'dotted', label: 'Dotted' }
];

const FILLS: Array<{ value: DrawingStyle['fill']; label: string }> = [
    { value: 'none', label: 'None' },
    { value: 'hachure', label: 'Hachure' },
    { value: 'solid', label: 'Solid' }
];

/* What Excalidraw calls the three hands a drawing can be made by. */
const ROUGHNESS: Array<{ value: DrawingStyle['roughness']; label: string }> = [
    { value: 0, label: 'Architect' },
    { value: 1, label: 'Artist' },
    { value: 2, label: 'Cartoonist' }
];

const FONTS: Array<{ value: DrawingStyle['font']; label: string }> = [
    { value: 'hand', label: 'Hand' },
    { value: 'sans', label: 'Sans' },
    { value: 'mono', label: 'Mono' }
];

const TEXT_SIZES = [16, 20, 28, 36];

const SWATCH = 'h-5 w-5 rounded-full border border-border-strong';

/* One row of a menu that picks a value, with the tick where every other menu keeps it. */
function RadioRow({ label, value }: { label: string; value: string | number }) {
    return (
        <Menu.RadioItem value={value} className="menu-item">
            <span className="grid h-4 w-4 place-items-center">
                <Menu.RadioItemIndicator>
                    <Icon icon={Check} size={14} />
                </Menu.RadioItemIndicator>
            </span>
            <span>{label}</span>
        </Menu.RadioItem>
    );
}

/*
 * The drawing's own dock: the tools, the style of what comes next, the zoom and the way back. The
 * canvas dock returns null on a view of its own, so the two never share the bottom of the screen.
 */
export function DrawingDock() {
    const { tool, toolLocked, style, zoom, hasSelection, canUndo, canRedo, anyLocked, exportBackground, empty } = useDrawing(
        useShallow((s) => ({
            tool: s.tool,
            toolLocked: s.toolLocked,
            style: s.style,
            zoom: s.camera.zoom,
            hasSelection: s.selection.length > 0,
            canUndo: s.past.length > 0,
            canRedo: s.future.length > 0,
            anyLocked: s.elements.some((element) => element.locked),
            exportBackground: s.exportBackground,
            empty: s.elements.length === 0
        }))
    );
    const set = (patch: Partial<DrawingStyle>): void => useDrawing.getState().setStyle(patch);
    const preset = activeZoomPreset(zoom);

    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
            <div className={`${FLOAT} pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-xl p-1`}>
                <div className={BTN_GROUP}>
                    {TOOLS.map((row) => (
                        <Tooltip key={row.tool} label={row.label} kbd={row.kbd} name>
                            <button className="icon-btn" data-active={tool === row.tool} onClick={() => useDrawing.getState().setTool(row.tool)}>
                                <Icon icon={row.icon} size={16} />
                            </button>
                        </Tooltip>
                    ))}
                    <Tooltip label="Keep the tool" kbd="Q" name>
                        <button className="icon-btn" data-active={toolLocked} onClick={() => useDrawing.getState().toggleToolLock()}>
                            <Icon icon={toolLocked ? Lock : LockOpen} size={16} />
                        </button>
                    </Tooltip>
                </div>

                <Separator />

                <div className={BTN_GROUP}>
                    <Menu.Root>
                        <Tooltip label="Color">
                            <Menu.Trigger className="icon-btn" aria-label="Color">
                                <span className={SWATCH} style={{ background: `var(--draw-${style.stroke})` }} />
                            </Menu.Trigger>
                        </Tooltip>
                        <Menu.Portal>
                            <Menu.Positioner className="z-[var(--z-popup)]" side="top" sideOffset={10} align="center">
                                <Menu.Popup className="menu-popup">
                                    <div className={MENU_LABEL}>Stroke</div>
                                    <Swatches value={style.stroke} onPick={(stroke) => set({ stroke })} />
                                    <Menu.Separator className={MENU_SEPARATOR} />
                                    <div className={MENU_LABEL}>Fill</div>
                                    <Swatches value={style.fillColor} onPick={(fillColor) => set({ fillColor })} />
                                </Menu.Popup>
                            </Menu.Positioner>
                        </Menu.Portal>
                    </Menu.Root>

                    <Menu.Root>
                        <Tooltip label="Style" name>
                            <Menu.Trigger className="icon-btn">
                                <Icon icon={Palette} size={16} />
                            </Menu.Trigger>
                        </Tooltip>
                        <Menu.Portal>
                            <Menu.Positioner className="z-[var(--z-popup)]" side="top" sideOffset={10} align="center">
                                <Menu.Popup className="menu-popup min-w-44">
                                    <div className={MENU_LABEL}>Stroke width</div>
                                    <Menu.RadioGroup
                                        value={style.strokeWidth}
                                        onValueChange={(value: DrawingStyle['strokeWidth']) => set({ strokeWidth: value })}
                                    >
                                        {WIDTHS.map((row) => (
                                            <RadioRow key={row.value} label={row.label} value={row.value} />
                                        ))}
                                    </Menu.RadioGroup>
                                    <Menu.Separator className={MENU_SEPARATOR} />
                                    <div className={MENU_LABEL}>Stroke style</div>
                                    <Menu.RadioGroup
                                        value={style.strokeStyle}
                                        onValueChange={(value: DrawingStyle['strokeStyle']) => set({ strokeStyle: value })}
                                    >
                                        {STROKE_STYLES.map((row) => (
                                            <RadioRow key={row.value} label={row.label} value={row.value} />
                                        ))}
                                    </Menu.RadioGroup>
                                    <Menu.Separator className={MENU_SEPARATOR} />
                                    <div className={MENU_LABEL}>Fill</div>
                                    <Menu.RadioGroup value={style.fill} onValueChange={(value: DrawingStyle['fill']) => set({ fill: value })}>
                                        {FILLS.map((row) => (
                                            <RadioRow key={row.value} label={row.label} value={row.value} />
                                        ))}
                                    </Menu.RadioGroup>
                                    <Menu.Separator className={MENU_SEPARATOR} />
                                    <div className={MENU_LABEL}>Sloppiness</div>
                                    <Menu.RadioGroup value={style.roughness} onValueChange={(value: DrawingStyle['roughness']) => set({ roughness: value })}>
                                        {ROUGHNESS.map((row) => (
                                            <RadioRow key={row.value} label={row.label} value={row.value} />
                                        ))}
                                    </Menu.RadioGroup>
                                    <Menu.Separator className={MENU_SEPARATOR} />
                                    <div className={MENU_LABEL}>Text</div>
                                    <Menu.RadioGroup value={style.font} onValueChange={(value: DrawingStyle['font']) => set({ font: value })}>
                                        {FONTS.map((row) => (
                                            <RadioRow key={row.value} label={row.label} value={row.value} />
                                        ))}
                                    </Menu.RadioGroup>
                                    <Menu.RadioGroup value={style.textSize} onValueChange={(value: number) => set({ textSize: value })}>
                                        {TEXT_SIZES.map((size) => (
                                            <RadioRow key={size} label={`${size} px`} value={size} />
                                        ))}
                                    </Menu.RadioGroup>
                                    {anyLocked && (
                                        <>
                                            <Menu.Separator className={MENU_SEPARATOR} />
                                            <Menu.Item className="menu-item" onClick={() => useDrawing.getState().unlockAll()}>
                                                <span className="grid h-4 w-4 place-items-center">
                                                    <Icon icon={LockOpen} size={14} />
                                                </span>
                                                Unlock all
                                            </Menu.Item>
                                        </>
                                    )}
                                </Menu.Popup>
                            </Menu.Positioner>
                        </Menu.Portal>
                    </Menu.Root>
                </div>

                <Separator />

                <div className={BTN_GROUP}>
                    <Tooltip label="Zoom out" name>
                        <button className="icon-btn" onClick={() => useDrawing.getState().zoomTo(Math.round(zoom * 100 - 10) / 100)}>
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
                            <Menu.Positioner className="z-[var(--z-popup)]" side="top" sideOffset={10} align="center">
                                <Menu.Popup className="menu-popup min-w-44">
                                    <Menu.RadioGroup value={preset} onValueChange={(value: number) => useDrawing.getState().zoomTo(value / 100)}>
                                        {ZOOM_PRESETS.map((pct) => (
                                            <Menu.RadioItem key={pct} value={pct} className="menu-item">
                                                <span className="grid h-4 w-4 place-items-center">
                                                    <Menu.RadioItemIndicator>
                                                        <Icon icon={Check} size={14} />
                                                    </Menu.RadioItemIndicator>
                                                </span>
                                                <span className="tabular-nums">{pct}%</span>
                                                {pct === 100 && <kbd>⌘0</kbd>}
                                            </Menu.RadioItem>
                                        ))}
                                    </Menu.RadioGroup>
                                    <Menu.Separator className={MENU_SEPARATOR} />
                                    <Menu.Item className="menu-item" onClick={() => useDrawing.getState().fitAll()}>
                                        <span className="grid h-4 w-4 place-items-center">
                                            <Icon icon={Maximize} size={14} />
                                        </span>
                                        Zoom to fit <kbd>⇧1</kbd>
                                    </Menu.Item>
                                    <Menu.Item className="menu-item" disabled={!hasSelection} onClick={() => useDrawing.getState().zoomToSelection()}>
                                        <span className="grid h-4 w-4 place-items-center">
                                            <Icon icon={Scan} size={14} />
                                        </span>
                                        Zoom to selection <kbd>⇧2</kbd>
                                    </Menu.Item>
                                </Menu.Popup>
                            </Menu.Positioner>
                        </Menu.Portal>
                    </Menu.Root>
                    <Tooltip label="Zoom in" name>
                        <button className="icon-btn" onClick={() => useDrawing.getState().zoomTo(Math.round(zoom * 100 + 10) / 100)}>
                            <Icon icon={Plus} size={16} />
                        </button>
                    </Tooltip>
                    <Tooltip label="Fit everything" kbd="Shift+1" name>
                        <button className="icon-btn" onClick={() => useDrawing.getState().fitAll()}>
                            <Icon icon={Maximize} size={16} />
                        </button>
                    </Tooltip>
                </div>

                <Separator />

                <div className={BTN_GROUP}>
                    <Menu.Root>
                        <Tooltip label="Export" name>
                            <Menu.Trigger className="icon-btn">
                                <Icon icon={MoreHorizontal} size={16} />
                            </Menu.Trigger>
                        </Tooltip>
                        <Menu.Portal>
                            <Menu.Positioner className="z-[var(--z-popup)]" side="top" sideOffset={10} align="end">
                                <Menu.Popup className="menu-popup min-w-52">
                                    <div className={MENU_LABEL}>{hasSelection ? 'Export the selection' : 'Export the drawing'}</div>
                                    <Menu.Item className="menu-item" disabled={empty} onClick={() => void copyDrawingPng()}>
                                        <Icon icon={Copy} size={14} /> Copy as PNG
                                    </Menu.Item>
                                    <Menu.Item className="menu-item" disabled={empty} onClick={() => void saveDrawingPng()}>
                                        <Icon icon={Download} size={14} /> Save PNG
                                    </Menu.Item>
                                    <Menu.Item className="menu-item" disabled={empty} onClick={() => void copyDrawingSvg()}>
                                        <Icon icon={Copy} size={14} /> Copy as SVG
                                    </Menu.Item>
                                    <Menu.Item className="menu-item" disabled={empty} onClick={() => void saveDrawingSvg()}>
                                        <Icon icon={Download} size={14} /> Save SVG
                                    </Menu.Item>
                                    <Menu.Separator className={MENU_SEPARATOR} />
                                    <Menu.CheckboxItem
                                        className="menu-item"
                                        checked={exportBackground}
                                        closeOnClick={false}
                                        onCheckedChange={(checked) => useDrawing.getState().setExportBackground(checked)}
                                    >
                                        <span className="grid h-4 w-4 place-items-center rounded border border-border-strong">
                                            <Menu.CheckboxItemIndicator>
                                                <Icon icon={Check} size={12} />
                                            </Menu.CheckboxItemIndicator>
                                        </span>
                                        With background
                                    </Menu.CheckboxItem>
                                </Menu.Popup>
                            </Menu.Positioner>
                        </Menu.Portal>
                    </Menu.Root>
                    <Tooltip label="Undo" kbd="Cmd+Z" name>
                        <button className="icon-btn" disabled={!canUndo} onClick={() => useDrawing.getState().undo()}>
                            <Icon icon={Undo2} size={16} />
                        </button>
                    </Tooltip>
                    <Tooltip label="Redo" kbd="Shift+Cmd+Z" name>
                        <button className="icon-btn" disabled={!canRedo} onClick={() => useDrawing.getState().redo()}>
                            <Icon icon={Redo2} size={16} />
                        </button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

/* The ten palette names as circles; the file keeps the name, the theme keeps the value. */
function Swatches({ value, onPick }: { value: DrawingColor; onPick: (color: DrawingColor) => void }) {
    return (
        <div className="flex gap-1 px-2 py-1.5">
            {DRAWING_COLORS.map((color) => (
                <Tooltip key={color} label={color}>
                    <button
                        className={`${SWATCH} ${color === value ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface-raised' : ''}`}
                        aria-label={color}
                        style={{ background: `var(--draw-${color})` }}
                        onClick={() => onPick(color)}
                    />
                </Tooltip>
            ))}
        </div>
    );
}

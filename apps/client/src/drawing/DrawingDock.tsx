import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import {
    Check,
    Circle,
    Diamond,
    Eraser,
    Hand,
    Lock,
    LockOpen,
    Minus,
    MousePointer2,
    MoveUpRight,
    Palette,
    Pencil,
    Square,
    StickyNote,
    Type,
    Undo2,
    Redo2,
    Copy,
    Download,
    MoreHorizontal
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { DRAWING_COLORS, type DrawingColor } from '@ruimte/contracts';
import { fitAction, historyAction } from '@/actions/client-actions';
import { copyDrawingPng, copyDrawingSvg, saveDrawingPng, saveDrawingSvg } from '@/drawing/export';
import { useDrawing, useDrawingStore, type DrawingStyle, type DrawingTool } from '@/state/drawing';
import { BTN_GROUP, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { DockShell } from '@/ui/DockShell';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';
import { DRAWING_SHORTCUTS } from '@/drawing/shortcuts';
import { ZoomControls } from '@/ui/ZoomControls';

interface ToolRow {
    tool: DrawingTool;
    kbd: string;
    icon: typeof Square;
}

/* The letter is the key on the keyboard, not a word, so it stays out of the translations. */
const TOOLS: ToolRow[] = [
    { tool: 'select', kbd: 'V', icon: MousePointer2 },
    { tool: 'hand', kbd: 'H', icon: Hand },
    { tool: 'rect', kbd: 'R', icon: Square },
    { tool: 'diamond', kbd: 'D', icon: Diamond },
    { tool: 'ellipse', kbd: 'O', icon: Circle },
    { tool: 'arrow', kbd: 'A', icon: MoveUpRight },
    { tool: 'line', kbd: 'L', icon: Minus },
    { tool: 'freehand', kbd: 'P', icon: Pencil },
    { tool: 'text', kbd: 'T', icon: Type },
    { tool: 'note', kbd: 'N', icon: StickyNote },
    { tool: 'eraser', kbd: 'E', icon: Eraser }
];

/* A width is a number on the wire, so the row carries the name its label is keyed on. */
const WIDTHS: Array<{ value: DrawingStyle['strokeWidth']; key: string }> = [
    { value: 1, key: 'thin' },
    { value: 2, key: 'medium' },
    { value: 4, key: 'bold' }
];

const STROKE_STYLES: Array<DrawingStyle['strokeStyle']> = ['solid', 'dashed', 'dotted'];

const FILLS: Array<DrawingStyle['fill']> = ['none', 'hachure', 'solid'];

/* What Excalidraw calls the three hands a drawing can be made by. */
const ROUGHNESS: Array<{ value: DrawingStyle['roughness']; key: string }> = [
    { value: 0, key: 'architect' },
    { value: 1, key: 'artist' },
    { value: 2, key: 'cartoonist' }
];

const FONTS: Array<DrawingStyle['font']> = ['hand', 'sans', 'mono'];

const TEXT_SIZES = [16, 20, 28, 36];

const ALIGNMENTS: Array<DrawingStyle['align']> = ['left', 'center', 'right'];

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
    const { t } = useTranslation('drawing');
    const drawingStore = useDrawingStore();
    const viewId = useDrawing((s) => s.viewId);
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
    const set = (patch: Partial<DrawingStyle>): void => drawingStore.getState().setStyle(patch);

    return (
        <DockShell data-drawing-chrome className="px-4" barClassName="flex-wrap justify-center">
            <div className={BTN_GROUP}>
                {TOOLS.map((row) => (
                    <Tooltip key={row.tool} label={t(`tools.${row.tool}`)} kbd={row.kbd} name>
                        <button className="icon-btn" data-active={tool === row.tool} onClick={() => drawingStore.getState().setTool(row.tool)}>
                            <Icon icon={row.icon} size={16} />
                        </button>
                    </Tooltip>
                ))}
                <Tooltip label={t('tools.keep')} kbd="Q" name>
                    <button className="icon-btn" data-active={toolLocked} onClick={() => drawingStore.getState().toggleToolLock()}>
                        <Icon icon={toolLocked ? Lock : LockOpen} size={16} />
                    </button>
                </Tooltip>
            </div>

            <Separator />

            <div className={BTN_GROUP}>
                <Menu.Root>
                    <Tooltip label={t('color.label')}>
                        <Menu.Trigger className="icon-btn" aria-label={t('color.label')}>
                            <span className={SWATCH} style={{ background: `var(--draw-${style.stroke})` }} />
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={10} align="center">
                            <Menu.Popup className="menu-popup">
                                <div className={MENU_LABEL}>{t('color.stroke')}</div>
                                <Swatches value={style.stroke} onPick={(stroke) => set({ stroke })} />
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <div className={MENU_LABEL}>{t('color.fill')}</div>
                                <Swatches value={style.fillColor} onPick={(fillColor) => set({ fillColor })} />
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <div className={MENU_LABEL}>{t('color.note')}</div>
                                <Swatches value={style.noteColor} onPick={(noteColor) => set({ noteColor })} paper />
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>

                <Menu.Root>
                    <Tooltip label={t('style.label')} name>
                        <Menu.Trigger className="icon-btn">
                            <Icon icon={Palette} size={16} />
                        </Menu.Trigger>
                    </Tooltip>
                    <Menu.Portal>
                        <Menu.Positioner className="z-(--z-popup)" side="top" sideOffset={10} align="center">
                            <Menu.Popup className="menu-popup min-w-44">
                                <div className={MENU_LABEL}>{t('style.strokeWidth')}</div>
                                <Menu.RadioGroup value={style.strokeWidth} onValueChange={(value: DrawingStyle['strokeWidth']) => set({ strokeWidth: value })}>
                                    {WIDTHS.map((row) => (
                                        <RadioRow key={row.value} label={t(`style.widths.${row.key}`)} value={row.value} />
                                    ))}
                                </Menu.RadioGroup>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <div className={MENU_LABEL}>{t('style.strokeStyle')}</div>
                                <Menu.RadioGroup value={style.strokeStyle} onValueChange={(value: DrawingStyle['strokeStyle']) => set({ strokeStyle: value })}>
                                    {STROKE_STYLES.map((strokeStyle) => (
                                        <RadioRow key={strokeStyle} label={t(`style.strokeStyles.${strokeStyle}`)} value={strokeStyle} />
                                    ))}
                                </Menu.RadioGroup>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <div className={MENU_LABEL}>{t('style.fill')}</div>
                                <Menu.RadioGroup value={style.fill} onValueChange={(value: DrawingStyle['fill']) => set({ fill: value })}>
                                    {FILLS.map((fill) => (
                                        <RadioRow key={fill} label={t(`style.fills.${fill}`)} value={fill} />
                                    ))}
                                </Menu.RadioGroup>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <div className={MENU_LABEL}>{t('style.sloppiness')}</div>
                                <Menu.RadioGroup value={style.roughness} onValueChange={(value: DrawingStyle['roughness']) => set({ roughness: value })}>
                                    {ROUGHNESS.map((row) => (
                                        <RadioRow key={row.value} label={t(`style.roughness.${row.key}`)} value={row.value} />
                                    ))}
                                </Menu.RadioGroup>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <div className={MENU_LABEL}>{t('style.text')}</div>
                                <Menu.RadioGroup value={style.font} onValueChange={(value: DrawingStyle['font']) => set({ font: value })}>
                                    {FONTS.map((font) => (
                                        <RadioRow key={font} label={t(`style.fonts.${font}`)} value={font} />
                                    ))}
                                </Menu.RadioGroup>
                                <Menu.RadioGroup value={style.textSize} onValueChange={(value: number) => set({ textSize: value })}>
                                    {TEXT_SIZES.map((size) => (
                                        <RadioRow key={size} label={t('style.textSize', { size })} value={size} />
                                    ))}
                                </Menu.RadioGroup>
                                <Menu.RadioGroup value={style.align} onValueChange={(value: DrawingStyle['align']) => set({ align: value })}>
                                    {ALIGNMENTS.map((align) => (
                                        <RadioRow key={align} label={t(`style.alignments.${align}`)} value={align} />
                                    ))}
                                </Menu.RadioGroup>
                                {anyLocked && (
                                    <>
                                        <Menu.Separator className={MENU_SEPARATOR} />
                                        <Menu.Item className="menu-item" onClick={() => drawingStore.getState().unlockAll()}>
                                            <span className="grid h-4 w-4 place-items-center">
                                                <Icon icon={LockOpen} size={14} />
                                            </span>
                                            {t('style.unlockAll')}
                                        </Menu.Item>
                                    </>
                                )}
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
            </div>

            <Separator />

            <ZoomControls
                zoom={zoom}
                labels={{
                    out: t('zoom.out'),
                    in: t('zoom.in'),
                    presets: t('zoom.presets'),
                    fit: t('zoom.fit'),
                    fitEverything: t('zoom.fitEverything')
                }}
                shortcuts={DRAWING_SHORTCUTS}
                onZoomTo={(next) => drawingStore.getState().zoomTo(next)}
                onFitAll={() => fitAction(viewId)}
                selection={{
                    label: t('zoom.selection'),
                    shortcut: DRAWING_SHORTCUTS.zoomSelection,
                    enabled: hasSelection,
                    onZoom: () => drawingStore.getState().zoomToSelection()
                }}
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
                                <div className={MENU_LABEL}>{hasSelection ? t('export.selection') : t('export.drawing')}</div>
                                <Menu.Item className="menu-item" disabled={empty} onClick={() => void copyDrawingPng(drawingStore)}>
                                    <Icon icon={Copy} size={14} /> {t('export.copyPng')}
                                </Menu.Item>
                                <Menu.Item className="menu-item" disabled={empty} onClick={() => void saveDrawingPng(drawingStore)}>
                                    <Icon icon={Download} size={14} /> {t('export.savePng')}
                                </Menu.Item>
                                <Menu.Item className="menu-item" disabled={empty} onClick={() => void copyDrawingSvg(drawingStore)}>
                                    <Icon icon={Copy} size={14} /> {t('export.copySvg')}
                                </Menu.Item>
                                <Menu.Item className="menu-item" disabled={empty} onClick={() => void saveDrawingSvg(drawingStore)}>
                                    <Icon icon={Download} size={14} /> {t('export.saveSvg')}
                                </Menu.Item>
                                <Menu.Separator className={MENU_SEPARATOR} />
                                <Menu.CheckboxItem
                                    className="menu-item"
                                    checked={exportBackground}
                                    closeOnClick={false}
                                    onCheckedChange={(checked) => drawingStore.getState().setExportBackground(checked)}
                                >
                                    <span className="grid h-4 w-4 place-items-center rounded border border-border-strong">
                                        <Menu.CheckboxItemIndicator>
                                            <Icon icon={Check} size={12} />
                                        </Menu.CheckboxItemIndicator>
                                    </span>
                                    {t('export.withBackground')}
                                </Menu.CheckboxItem>
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
                <Tooltip label={t('common:action.undo')} kbd={DRAWING_SHORTCUTS.undo} name>
                    <button className="icon-btn" disabled={!canUndo} onClick={() => historyAction('undo', viewId)}>
                        <Icon icon={Undo2} size={16} />
                    </button>
                </Tooltip>
                <Tooltip label={t('common:action.redo')} kbd={DRAWING_SHORTCUTS.redo} name>
                    <button className="icon-btn" disabled={!canRedo} onClick={() => historyAction('redo', viewId)}>
                        <Icon icon={Redo2} size={16} />
                    </button>
                </Tooltip>
            </div>
        </DockShell>
    );
}

/* The ten palette names as circles; the file keeps the name, the theme keeps the value. A diagram picks its tones here too. */
export function Swatches({ value, onPick, paper = false }: { value: DrawingColor; onPick: (color: DrawingColor) => void; paper?: boolean }) {
    const { t } = useTranslation('drawing');
    return (
        <div className="flex gap-1 px-2 py-1.5">
            {DRAWING_COLORS.map((color) => (
                <Tooltip key={color} label={t(`color.names.${color}`)}>
                    <button
                        className={`${SWATCH} ${color === value ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface-raised' : ''}`}
                        aria-label={t(`color.names.${color}`)}
                        style={{ background: `var(--draw${paper ? '-paper' : ''}-${color})` }}
                        onClick={() => onPick(color)}
                    />
                </Tooltip>
            ))}
        </div>
    );
}

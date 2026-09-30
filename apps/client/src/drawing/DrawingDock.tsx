import { useTranslation } from 'react-i18next';
import {
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
import { copyDrawing, exportDrawing, styleSelection, unlockEverything } from '@/drawing/drawing-actions';
import { useDrawing, useDrawingStore, type DrawingStyle, type DrawingTool } from '@/state/drawing';
import { ButtonGroup, ColorSwatch, Icon, IconButton, Menu, Separator, Tooltip, DockShell, ZoomControls } from '@basmilius/desktop-ui';
import { useSettings } from '@/state/settings';
import { DRAWING_SHORTCUTS } from '@/drawing/shortcuts';

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
        <Menu.RadioItem value={value}>
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
    const dockAutoHide = useSettings((s) => s.dockAutoHide);
    const set = (patch: Partial<DrawingStyle>): void => styleSelection(drawingStore, patch);

    return (
        <DockShell data-drawing-chrome autoHide={dockAutoHide} className="px-4" barClassName="flex-wrap justify-center">
            <ButtonGroup>
                {TOOLS.map((row) => (
                    <IconButton
                        key={row.tool}
                        icon={row.icon}
                        label={t(`tools.${row.tool}`)}
                        kbd={row.kbd}
                        active={tool === row.tool}
                        onClick={() => drawingStore.getState().setTool(row.tool)}
                    />
                ))}
                <IconButton
                    icon={toolLocked ? Lock : LockOpen}
                    label={t('tools.keep')}
                    kbd="Q"
                    active={toolLocked}
                    onClick={() => drawingStore.getState().toggleToolLock()}
                />
            </ButtonGroup>

            <Separator />

            <ButtonGroup>
                <Menu.Root>
                    <IconButton render={<Menu.Trigger />} label={t('color.label')}>
                        <span className={SWATCH} style={{ background: `var(--draw-${style.stroke})` }} />
                    </IconButton>
                    <Menu.Popup side="top" sideOffset={10} align="center">
                        <Menu.Label>{t('color.stroke')}</Menu.Label>
                        <Swatches value={style.stroke} onPick={(stroke) => set({ stroke })} />
                        <Menu.Separator />
                        <Menu.Label>{t('color.fill')}</Menu.Label>
                        <Swatches value={style.fillColor} onPick={(fillColor) => set({ fillColor })} />
                        <Menu.Separator />
                        <Menu.Label>{t('color.note')}</Menu.Label>
                        <Swatches value={style.noteColor} onPick={(noteColor) => set({ noteColor })} paper />
                    </Menu.Popup>
                </Menu.Root>

                <Menu.Root>
                    <IconButton render={<Menu.Trigger />} icon={Palette} label={t('style.label')} />
                    <Menu.Popup side="top" sideOffset={10} align="center" className="min-w-44">
                        <Menu.Label>{t('style.strokeWidth')}</Menu.Label>
                        <Menu.RadioGroup value={style.strokeWidth} onValueChange={(value: DrawingStyle['strokeWidth']) => set({ strokeWidth: value })}>
                            {WIDTHS.map((row) => (
                                <RadioRow key={row.value} label={t(`style.widths.${row.key}`)} value={row.value} />
                            ))}
                        </Menu.RadioGroup>
                        <Menu.Separator />
                        <Menu.Label>{t('style.strokeStyle')}</Menu.Label>
                        <Menu.RadioGroup value={style.strokeStyle} onValueChange={(value: DrawingStyle['strokeStyle']) => set({ strokeStyle: value })}>
                            {STROKE_STYLES.map((strokeStyle) => (
                                <RadioRow key={strokeStyle} label={t(`style.strokeStyles.${strokeStyle}`)} value={strokeStyle} />
                            ))}
                        </Menu.RadioGroup>
                        <Menu.Separator />
                        <Menu.Label>{t('style.fill')}</Menu.Label>
                        <Menu.RadioGroup value={style.fill} onValueChange={(value: DrawingStyle['fill']) => set({ fill: value })}>
                            {FILLS.map((fill) => (
                                <RadioRow key={fill} label={t(`style.fills.${fill}`)} value={fill} />
                            ))}
                        </Menu.RadioGroup>
                        <Menu.Separator />
                        <Menu.Label>{t('style.sloppiness')}</Menu.Label>
                        <Menu.RadioGroup value={style.roughness} onValueChange={(value: DrawingStyle['roughness']) => set({ roughness: value })}>
                            {ROUGHNESS.map((row) => (
                                <RadioRow key={row.value} label={t(`style.roughness.${row.key}`)} value={row.value} />
                            ))}
                        </Menu.RadioGroup>
                        <Menu.Separator />
                        <Menu.Label>{t('style.text')}</Menu.Label>
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
                                <Menu.Separator />
                                <Menu.Item onClick={() => unlockEverything(drawingStore)}>
                                    <span className="grid h-4 w-4 place-items-center">
                                        <Icon icon={LockOpen} size={14} />
                                    </span>
                                    {t('style.unlockAll')}
                                </Menu.Item>
                            </>
                        )}
                    </Menu.Popup>
                </Menu.Root>
            </ButtonGroup>

            <Separator />

            <ZoomControls
                zoom={zoom}
                labels={{
                    presets: t('zoom.presets'),
                    fit: t('zoom.fit'),
                    fitEverything: t('zoom.fitEverything')
                }}
                shortcuts={DRAWING_SHORTCUTS}
                onZoomChange={(next) => drawingStore.getState().zoomTo(next)}
                onFitAll={() => fitAction(viewId)}
                selection={{
                    label: t('zoom.selection'),
                    shortcut: DRAWING_SHORTCUTS.zoomSelection,
                    enabled: hasSelection,
                    onZoom: () => drawingStore.getState().zoomToSelection()
                }}
            />

            <Separator />

            <ButtonGroup>
                <Menu.Root>
                    <IconButton render={<Menu.Trigger />} icon={MoreHorizontal} label={t('export.label')} />
                    <Menu.Popup side="top" sideOffset={10} align="end" className="min-w-52">
                        <Menu.Label>{hasSelection ? t('export.selection') : t('export.drawing')}</Menu.Label>
                        <Menu.Item disabled={empty} onClick={() => void copyDrawing(drawingStore, 'png')}>
                            <Icon icon={Copy} size={14} /> {t('export.copyPng')}
                        </Menu.Item>
                        <Menu.Item disabled={empty} onClick={() => exportDrawing(drawingStore, 'png')}>
                            <Icon icon={Download} size={14} /> {t('export.savePng')}
                        </Menu.Item>
                        <Menu.Item disabled={empty} onClick={() => void copyDrawing(drawingStore, 'svg')}>
                            <Icon icon={Copy} size={14} /> {t('export.copySvg')}
                        </Menu.Item>
                        <Menu.Item disabled={empty} onClick={() => exportDrawing(drawingStore, 'svg')}>
                            <Icon icon={Download} size={14} /> {t('export.saveSvg')}
                        </Menu.Item>
                        <Menu.Separator />
                        <Menu.CheckboxItem
                            checked={exportBackground}
                            closeOnClick={false}
                            onCheckedChange={(checked) => drawingStore.getState().setExportBackground(checked)}
                        >
                            {t('export.withBackground')}
                        </Menu.CheckboxItem>
                    </Menu.Popup>
                </Menu.Root>
                <IconButton
                    icon={Undo2}
                    label={t('common:action.undo')}
                    kbd={DRAWING_SHORTCUTS.undo}
                    disabled={!canUndo}
                    onClick={() => historyAction('undo', viewId)}
                />
                <IconButton
                    icon={Redo2}
                    label={t('common:action.redo')}
                    kbd={DRAWING_SHORTCUTS.redo}
                    disabled={!canRedo}
                    onClick={() => historyAction('redo', viewId)}
                />
            </ButtonGroup>
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
                    <ColorSwatch
                        aria-label={t(`color.names.${color}`)}
                        color={`var(--draw${paper ? '-paper' : ''}-${color})`}
                        picked={color === value}
                        on="popup"
                        className="border border-border-strong"
                        onClick={() => onPick(color)}
                    />
                </Tooltip>
            ))}
        </div>
    );
}

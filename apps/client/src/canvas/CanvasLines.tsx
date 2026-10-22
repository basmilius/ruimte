import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, FlipHorizontal2, SlidersHorizontal, Trash } from 'lucide-react';
import type { ProjectCanvasLine } from '@ruimte/contracts';
import { ColorSwatch, ContextMenu, Icon, IconButton, Menu, Surface, Tooltip } from '@adecore/ui';
import { accentColor, accentLabel, NODE_ACCENTS } from '@/canvas/accents';
import { constrainedLineEnd, LINE_GRID, lineArrow, lineBounds, lineDash } from '@/canvas/line-geometry';
import { snapPoint, toWorld, type Point } from '@/canvas/math';
import { isSpaceDown } from '@/canvas/space-pan';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { DEFAULT_LINE_STYLE } from '@/state/canvas-lines-slice';

type LinePatch = Partial<Omit<ProjectCanvasLine, 'id'>>;
type Drag = { at: Point; line: ProjectCanvasLine; handle: 'start' | 'end' | 'move'; moved: boolean };

function worldPoint(event: { clientX: number; clientY: number }, surface: Element, camera: Parameters<typeof toWorld>[0]): Point {
    const rect = surface.getBoundingClientRect();
    return toWorld(camera, { x: event.clientX - rect.left, y: event.clientY - rect.top });
}

function LinePaint({ line, selected = false, zoom = 1 }: { line: ProjectCanvasLine; selected?: boolean; zoom?: number }) {
    const from = { x: line.x, y: line.y };
    const to = { x: line.endX, y: line.endY };
    const d = `M${from.x},${from.y} L${to.x},${to.y}`;
    const stroke = accentColor(line.stroke) ?? (line.stroke === 'accent' ? 'var(--accent)' : line.stroke === 'muted' ? 'var(--text-muted)' : 'var(--text)');
    return (
        <>
            {selected && <path d={d} fill="none" stroke="var(--accent)" strokeWidth={line.strokeWidth + 6 / zoom} opacity={0.22} />}
            <path d={d} fill="none" stroke={stroke} strokeWidth={line.strokeWidth} strokeDasharray={lineDash(line)} strokeLinecap="round" />
            {line.arrowStart && (
                <path
                    d={lineArrow(from, to, line.strokeWidth)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={line.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}
            {line.arrowEnd && (
                <path
                    d={lineArrow(to, from, line.strokeWidth)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={line.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}
        </>
    );
}

function LineStyleItems({ line, onChange }: { line: ProjectCanvasLine; onChange(patch: LinePatch): void }) {
    const { t } = useTranslation(['drawing', 'canvas']);
    return (
        <>
            <Menu.Label>{t('color.stroke')}</Menu.Label>
            <div className="grid grid-cols-6 gap-1 px-2.5 py-2" role="group" aria-label={t('color.stroke')}>
                <Tooltip label={t('canvas:lines.defaultColor')}>
                    <ColorSwatch
                        render={<Menu.Item unstyled closeOnClick={false} />}
                        picked={line.stroke === 'ink'}
                        aria-label={t('canvas:lines.defaultColor')}
                        onClick={() => onChange({ stroke: 'ink' })}
                    />
                </Tooltip>
                {NODE_ACCENTS.map((accent) => (
                    <Tooltip key={accent.id} label={accentLabel(accent.id)}>
                        <ColorSwatch
                            render={<Menu.Item unstyled closeOnClick={false} />}
                            color={accent.color}
                            picked={line.stroke === accent.id}
                            aria-label={accentLabel(accent.id)}
                            on="popup"
                            onClick={() => onChange({ stroke: accent.id })}
                        />
                    </Tooltip>
                ))}
            </div>
            <Menu.Separator />
            <Menu.Label>{t('style.strokeWidth')}</Menu.Label>
            <Menu.RadioGroup value={line.strokeWidth} onValueChange={(strokeWidth: ProjectCanvasLine['strokeWidth']) => onChange({ strokeWidth })}>
                {(
                    [
                        { value: 1, name: 'thin' },
                        { value: 2, name: 'medium' },
                        { value: 4, name: 'bold' }
                    ] as const
                ).map((width) => (
                    <Menu.RadioItem key={width.value} value={width.value} closeOnClick={false}>
                        {t(`style.widths.${width.name}`)}
                    </Menu.RadioItem>
                ))}
            </Menu.RadioGroup>
            <Menu.Separator />
            <Menu.Label>{t('style.strokeStyle')}</Menu.Label>
            <Menu.RadioGroup value={line.strokeStyle} onValueChange={(strokeStyle: ProjectCanvasLine['strokeStyle']) => onChange({ strokeStyle })}>
                {(['solid', 'dashed', 'dotted'] as const).map((style) => (
                    <Menu.RadioItem key={style} value={style} closeOnClick={false}>
                        {t(`style.strokeStyles.${style}`)}
                    </Menu.RadioItem>
                ))}
            </Menu.RadioGroup>
            <Menu.Separator />
            <Menu.CheckboxItem checked={line.arrowStart === true} onCheckedChange={(arrowStart) => onChange({ arrowStart })} closeOnClick={false}>
                {t('canvas:lines.arrowStart')}
            </Menu.CheckboxItem>
            <Menu.CheckboxItem checked={line.arrowEnd === true} onCheckedChange={(arrowEnd) => onChange({ arrowEnd })} closeOnClick={false}>
                {t('canvas:lines.arrowEnd')}
            </Menu.CheckboxItem>
            <Menu.Item onClick={() => onChange({ x: line.endX, y: line.endY, endX: line.x, endY: line.y })}>
                <Icon icon={FlipHorizontal2} size={14} />
                {t('canvas:lines.reverse')}
            </Menu.Item>
        </>
    );
}

function CanvasLine({ id }: { id: string }) {
    const { t } = useTranslation(['drawing', 'common', 'canvas']);
    const store = useCanvasStore();
    const line = useCanvas((s) => s.lines[id]);
    const selected = useCanvas((s) => s.selection.includes(id));
    const zoom = useCanvas((s) => s.camera.zoom);
    const locks = useCanvas((s) => s.locks);
    const hidden = useCanvas((s) => s.hidden.has(id));
    const drag = useRef<Drag | null>(null);
    if (!line || hidden) {
        return null;
    }
    const down = (event: ReactPointerEvent<Element>): void => {
        if (event.button !== 0 || isSpaceDown()) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const state = store.getState();
        (document.activeElement as HTMLElement | null)?.blur();
        state.setBodyFocus(null);
        const surface = event.currentTarget.closest('[data-canvas-surface]')!;
        const handle = (event.target as Element).getAttribute('data-line-handle') as 'start' | 'end' | null;
        if (handle || !state.selection.includes(id) || event.shiftKey) {
            state.select([id], !handle && event.shiftKey);
        }
        if (!store.getState().selection.includes(id)) {
            return;
        }
        if ((handle && locks.resize) || (!handle && locks.move)) {
            return;
        }
        drag.current = { at: worldPoint(event, surface, state.camera), line, handle: handle ?? 'move', moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const move = (event: ReactPointerEvent<Element>): void => {
        const held = drag.current;
        if (!held) {
            return;
        }
        event.stopPropagation();
        const state = store.getState();
        const at = worldPoint(event, event.currentTarget.closest('[data-canvas-surface]')!, state.camera);
        const offset = snapPoint({ x: at.x - held.at.x, y: at.y - held.at.y }, LINE_GRID);
        const dx = offset.x,
            dy = offset.y;
        if (!held.moved && Math.hypot(dx, dy) * state.camera.zoom < 3) {
            return;
        }
        if (held.handle === 'move') {
            state.moveSelected(dx - (state.lines[id]!.x - held.line.x), dy - (state.lines[id]!.y - held.line.y), !held.moved);
        } else {
            const origin = held.handle === 'start' ? { x: held.line.endX, y: held.line.endY } : { x: held.line.x, y: held.line.y };
            const end = constrainedLineEnd(origin, at, event.shiftKey);
            state.updateLine(id, held.handle === 'start' ? { x: end.x, y: end.y } : { endX: end.x, endY: end.y }, !held.moved);
        }
        held.moved = true;
        state.setGesturing(true);
    };
    const up = (event: ReactPointerEvent<Element>): void => {
        if (!drag.current) {
            return;
        }
        event.stopPropagation();
        if (drag.current.moved && drag.current.handle === 'move') {
            store.getState().settleMove();
        }
        drag.current = null;
        store.getState().setGesturing(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<g />}
                data-canvas-line={id}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onDoubleClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => {
                    event.stopPropagation();
                    store.getState().select([id]);
                }}
            >
                <LinePaint line={line} selected={selected} zoom={zoom} />
                <path
                    d={`M${line.x},${line.y} L${line.endX},${line.endY}`}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(12 / zoom, line.strokeWidth)}
                    className="cursor-move"
                    style={{ pointerEvents: 'stroke' }}
                />
                {selected &&
                    !locks.resize &&
                    (['start', 'end'] as const).map((end) => (
                        <circle
                            key={end}
                            data-line-handle={end}
                            cx={end === 'start' ? line.x : line.endX}
                            cy={end === 'start' ? line.y : line.endY}
                            r={5 / zoom}
                            fill="var(--surface)"
                            stroke="var(--accent)"
                            strokeWidth={1.5 / zoom}
                            className="cursor-crosshair"
                            style={{ pointerEvents: 'all' }}
                        />
                    ))}
            </ContextMenu.Trigger>
            <ContextMenu.Popup className="min-w-52">
                <LineStyleItems line={line} onChange={(patch) => store.getState().updateLine(id, patch)} />
                <ContextMenu.Separator />
                <ContextMenu.Item onClick={() => store.getState().duplicateLine(id)}>
                    <Icon icon={Copy} size={14} />
                    {t('canvas:menu.duplicate')}
                </ContextMenu.Item>
                <ContextMenu.Item
                    className="text-status-error"
                    onClick={() => {
                        store.getState().select([id]);
                        store.getState().deleteSelected();
                    }}
                >
                    <Icon icon={Trash} size={14} />
                    {t('common:action.delete')}
                </ContextMenu.Item>
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

export function CanvasLineLayer() {
    const lines = useCanvas((s) => s.lines);
    return (
        <svg width="1" height="1" className="pointer-events-none absolute top-0 left-0 overflow-visible" data-canvas-lines>
            {Object.keys(lines).map((id) => (
                <CanvasLine key={id} id={id} />
            ))}
        </svg>
    );
}

export function CanvasLineTool({ onDraftChange }: { onDraftChange(line: ProjectCanvasLine | null): void }) {
    const { t } = useTranslation('canvas');
    const store = useCanvasStore();
    const tool = useCanvas((s) => s.lineTool);
    const camera = useCanvas((s) => s.camera);
    const [draft, setDraft] = useState<ProjectCanvasLine | null>(null);
    const draftRef = useRef<ProjectCanvasLine | null>(null);
    useEffect(
        () => () => {
            onDraftChange(null);
            store.getState().setGesturing(false);
        },
        [store, onDraftChange]
    );
    if (tool === null) {
        return null;
    }
    const point = (event: ReactPointerEvent<HTMLDivElement>): Point => worldPoint(event, event.currentTarget, store.getState().camera);
    return (
        <div
            className="absolute inset-0 z-10 cursor-crosshair"
            data-line-tool={tool}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                store.getState().setLineTool(null);
            }}
            onPointerDown={(event) => {
                if (event.button !== 0 || isSpaceDown()) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                const at = snapPoint(point(event), LINE_GRID);
                const line = { ...DEFAULT_LINE_STYLE, id: 'draft', x: at.x, y: at.y, endX: at.x, endY: at.y };
                draftRef.current = line;
                setDraft(line);
                onDraftChange(line);
                store.getState().setGesturing(true);
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
                if (!draftRef.current) {
                    return;
                }
                event.stopPropagation();
                const end = constrainedLineEnd(draftRef.current, point(event), event.shiftKey);
                const line = { ...draftRef.current, endX: end.x, endY: end.y };
                draftRef.current = line;
                setDraft(line);
                onDraftChange(line);
            }}
            onPointerUp={(event) => {
                if (!draftRef.current) {
                    return;
                }
                event.stopPropagation();
                const end = constrainedLineEnd(draftRef.current, point(event), event.shiftKey);
                const line = { ...draftRef.current, endX: end.x, endY: end.y };
                draftRef.current = null;
                setDraft(null);
                onDraftChange(null);
                store.getState().setGesturing(false);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }
                store.getState().addLine(line);
            }}
            onPointerCancel={() => {
                draftRef.current = null;
                setDraft(null);
                onDraftChange(null);
                store.getState().setGesturing(false);
            }}
        >
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
                <g transform={`translate(${camera.x},${camera.y}) scale(${camera.zoom})`}>{draft && <LinePaint line={draft} />}</g>
            </svg>
            <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-muted shadow-float">
                {t('lines.drawHint')}
            </div>
        </div>
    );
}

export function CanvasLineToolbar() {
    const { t } = useTranslation(['canvas', 'drawing']);
    const store = useCanvasStore();
    const line = useCanvas((s) => (s.selection.length === 1 ? s.lines[s.selection[0]!] : undefined));
    // Only a bar on screen follows the camera, so a pan with no line selected renders nothing here.
    const camera = useCanvas((s) => (line === undefined ? null : s.camera));
    const viewport = useCanvas((s) => s.viewport);
    if (!line || camera === null) {
        return null;
    }
    const bounds = lineBounds(line);
    const top = bounds.y * camera.zoom + camera.y - 52;
    return (
        <Surface
            role="toolbar"
            aria-label={t('lines.format')}
            className="pointer-events-auto absolute z-10 flex items-center gap-1 rounded-xl p-1"
            style={{
                left: Math.max(8, Math.min(bounds.x * camera.zoom + camera.x, viewport.w - 100)),
                top: Math.max(8, Math.min(top < 8 ? (bounds.y + bounds.h) * camera.zoom + camera.y + 10 : top, viewport.h - 50))
            }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <Menu.Root>
                <IconButton render={<Menu.Trigger />} icon={SlidersHorizontal} label={t('drawing:style.label')} />
                <Menu.Popup side="top" sideOffset={8} className="min-w-52">
                    <LineStyleItems line={line} onChange={(patch) => store.getState().updateLine(line.id, patch)} />
                </Menu.Popup>
            </Menu.Root>
            <IconButton icon={Trash} label={t('common:action.delete')} iconClassName="text-status-error" onClick={() => store.getState().deleteSelected()} />
        </Surface>
    );
}

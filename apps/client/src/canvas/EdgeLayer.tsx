import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Pencil, Trash } from 'lucide-react';
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import { isAgentKind, useCanvas, useCanvasStore } from '@/state/canvas';
import { edgeLook, lineMeaning } from '@/canvas/edge-look';
import { routeDraft, SIDE_NORMAL, type Side } from '@/canvas/edge-route';
import { lineRoutes } from '@/canvas/line-routes';
import { markerPath, type MarkerShape } from '@/canvas/marker-path';
import type { Point } from '@/canvas/math';
import { useEndpointId } from '@/state/keys';
import { edgeTask, taskEdgeLabel, useTasks } from '@/state/tasks';
import { MENU_HINT, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

function EdgeLabel({
    ids,
    label,
    at,
    editing,
    onEdit
}: {
    ids: string[];
    label: string | undefined;
    at: Point;
    editing: boolean;
    onEdit(editing: boolean): void;
}) {
    const canvasStore = useCanvasStore();
    if (editing) {
        // A pixel wider on every side than the field, since a foreignObject clips the focus outline around it.
        return (
            <foreignObject x={at.x - 61} y={at.y - 15} width="122" height="30">
                <input
                    autoFocus
                    defaultValue={label ?? ''}
                    maxLength={MAX_TITLE_LENGTH}
                    className="field field-sm m-px w-[120px] text-center"
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                        // Both directions carry the name: to a person this is one line, and one line has one name.
                        for (const id of ids) {
                            canvasStore.getState().setEdgeLabel(id, e.currentTarget.value);
                        }
                        onEdit(false);
                    }}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter' || e.key === 'Escape') {
                            e.currentTarget.blur();
                        }
                    }}
                />
            </foreignObject>
        );
    }
    if (!label) {
        return null;
    }
    /* HTML, not `<text>` in a fixed 64 by 24 pill: the pill then grows with the label and with the
       interface font size, which an SVG rect of hard numbers cannot do. */
    return (
        <foreignObject x={at.x - 100} y={at.y - 16} width="200" height="32" style={{ overflow: 'visible' }}>
            <div className="flex h-8 items-center justify-center" onDoubleClick={(e) => (e.stopPropagation(), onEdit(true))}>
                <span className="pointer-events-auto cursor-text rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-xs whitespace-nowrap text-text-muted">
                    {label}
                </span>
            </div>
        </foreignObject>
    );
}

/* Where a line meets a node: it stops a gap short and leaves its marker in the gap behind, rimmed in
   its own color, so nothing is ever drawn against a node's border. An outline is filled with the
   canvas, so the line ends inside it instead of running through it. */
function EdgeMarker({ shape, at, side, stroke }: { shape: MarkerShape; at: Point; side: Side; stroke: string }) {
    const path = markerPath(shape, at, SIDE_NORMAL[side]);
    if (path === '') {
        return null;
    }
    const fill = shape === 'chevron' ? 'none' : shape === 'arrow' ? stroke : 'var(--canvas-bg)';
    return <path d={path} fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
}

/* Memoized with no props: the canvas above re-renders on every pan, which moves nothing drawn here. */
export const EdgeLayer = memo(function EdgeLayer() {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const edges = useCanvas((s) => s.edges);
    const nodes = useCanvas((s) => s.nodes);
    const texts = useCanvas((s) => s.texts);
    const hidden = useCanvas((s) => s.hidden);
    const selection = useCanvas((s) => s.selection);
    const draft = useCanvas((s) => s.linkDraft);
    const [hovered, setHovered] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const endpointId = useEndpointId();
    const tasks = useTasks((s) => s.byEndpoint[endpointId]);

    const { lines, obstacles, routes, rectOf } = lineRoutes(edges, nodes, texts, hidden);

    /* Whether this node reads what a line brings it, which only an agent does; every other node is
       an end a line runs to and nothing more. */
    const readsContext = (nodeId: string): boolean => {
        const target = nodes[nodeId];
        return target !== undefined && isAgentKind(target.kind);
    };

    /* Whether an agent works on this node rather than reads it, which is what a line out of an agent
       into a device or a page means with no role written on it. It says what the line is, and grants
       nothing: what an agent may do hangs on lineage, never on a line. */
    const drivenByAgent = (nodeId: string): boolean => {
        const node = nodes[nodeId];
        return node !== undefined && (node.kind === 'device' || node.kind === 'browser');
    };

    return (
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            {lines.map((line) => {
                const key = line.edge.id;
                const route = routes.get(key);
                if (route === undefined) {
                    return null;
                }
                const mid = route.mid;
                const active = hovered === key || line.ids.some((id) => selection.includes(id));
                // A line a task went along says how the task stands, and only looks open while it is.
                const task = edgeTask(tasks, line.edge.from, line.edge.to) ?? (line.back === null ? null : edgeTask(tasks, line.back.from, line.back.to));
                const label = task === null ? line.label : taskEdgeLabel(task.status);
                const look = edgeLook(lineMeaning(line, readsContext, drivenByAgent), {
                    pair: line.back !== null,
                    openTask: task !== null && task.status === 'open'
                });
                const stroke = look.accent ? (active ? 'var(--accent)' : 'var(--edge-context)') : active ? 'var(--text-muted)' : 'var(--edge-line)';
                const remove = (): void => {
                    for (const id of line.ids) {
                        canvasStore.getState().removeEdge(id);
                    }
                };
                return (
                    <ContextMenu.Root key={key}>
                        <ContextMenu.Trigger
                            render={<g />}
                            onPointerEnter={() => setHovered(key)}
                            onPointerLeave={() => setHovered((h) => (h === key ? null : h))}
                        >
                            {/* A wide invisible stroke gives the thin line something to hover and click; a double-click names it. */}
                            <path
                                d={route.d}
                                fill="none"
                                stroke="transparent"
                                strokeWidth="14"
                                className="pointer-events-auto cursor-pointer"
                                onPointerDown={(e) => {
                                    e.stopPropagation();
                                    // One line is one thing to click, so both of its directions are selected together.
                                    canvasStore.getState().select(line.ids, e.shiftKey);
                                }}
                                onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    setEditing(key);
                                }}
                            />
                            <path
                                d={route.d}
                                fill="none"
                                stroke={stroke}
                                strokeWidth={active ? look.width + 1 : look.width}
                                strokeDasharray={look.dashed ? '6 6' : undefined}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                            <EdgeMarker shape={look.tail} at={route.from} side={route.fromSide} stroke={stroke} />
                            <EdgeMarker shape={look.head} at={route.to} side={route.toSide} stroke={stroke} />
                            <EdgeLabel ids={line.ids} label={label} at={mid} editing={editing === key} onEdit={(on) => setEditing(on ? key : null)} />
                            {active && editing !== key && (
                                <g
                                    transform={`translate(${mid.x + (label ? 40 : 0)}, ${mid.y})`}
                                    className="pointer-events-auto cursor-pointer"
                                    onPointerDown={(e) => {
                                        e.stopPropagation();
                                        remove();
                                    }}
                                >
                                    <circle r="9" fill="var(--surface-raised)" stroke="var(--border-strong)" />
                                    <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
                                </g>
                            )}
                        </ContextMenu.Trigger>
                        <ContextMenu.Portal>
                            <ContextMenu.Positioner className="z-(--z-popup)">
                                <ContextMenu.Popup className="menu-popup">
                                    <ContextMenu.Item className="menu-item" onClick={() => setEditing(key)}>
                                        <Icon icon={Pencil} size={14} /> {t('common:action.rename')} <span className={MENU_HINT}>{t('menu.doubleClick')}</span>
                                    </ContextMenu.Item>
                                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                                    <ContextMenu.Item className="menu-item" onClick={remove}>
                                        <Icon icon={Trash} size={14} /> {t('common:action.remove')}
                                    </ContextMenu.Item>
                                </ContextMenu.Popup>
                            </ContextMenu.Positioner>
                        </ContextMenu.Portal>
                    </ContextMenu.Root>
                );
            })}
            {draft &&
                (() => {
                    const from = rectOf(draft.from);
                    if (!from) {
                        return null;
                    }
                    const route = routeDraft(
                        from,
                        draft.to,
                        obstacles.filter((obstacle) => obstacle.id !== draft.from),
                        { fromSide: draft.fromSide }
                    );
                    return (
                        <>
                            <path
                                d={route.d}
                                fill="none"
                                stroke="var(--accent)"
                                strokeWidth="2"
                                strokeDasharray="4 4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                            <EdgeMarker shape="dot" at={route.from} side={route.fromSide} stroke="var(--accent)" />
                        </>
                    );
                })()}
        </svg>
    );
});

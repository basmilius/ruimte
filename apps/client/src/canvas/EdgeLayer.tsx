import { memo, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash, X } from 'lucide-react';
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import { isAgentKind, useCanvas, useCanvasStore, type CanvasState } from '@/state/canvas';
import { edgeLook, lineMeaning } from '@/canvas/edge-look';
import { routeDraft, SIDE_NORMAL, type EdgeRoute, type Obstacle, type Side } from '@/canvas/edge-route';
import type { EdgeLine } from '@/canvas/edge-lines';
import { lineRoutes } from '@/canvas/line-routes';
import { markerPath, type MarkerShape } from '@/canvas/marker-path';
import type { Point, Rect } from '@/canvas/math';
import { endpointOfNodeIn, useEndpointId } from '@/state/keys';
import { useEndpoints } from '@/state/endpoints';
import { edgeTask, taskEdgeLabel, useTasks } from '@/state/tasks';
import { Icon, IconButton, ContextMenu, Input } from '@adecore/ui';

function EdgeLabel({
    ids,
    label,
    at,
    editing,
    onEdit,
    active,
    onRemove
}: {
    ids: string[];
    label: string | undefined;
    at: Point;
    editing: boolean;
    onEdit(editing: boolean): void;
    active: boolean;
    onRemove(): void;
}) {
    const canvasStore = useCanvasStore();
    const { t } = useTranslation('common');
    if (editing) {
        // A pixel wider on every side than the field, since a foreignObject clips the focus outline around it.
        return (
            <foreignObject x={at.x - 61} y={at.y - 15} width="122" height="30">
                <Input
                    autoFocus
                    defaultValue={label ?? ''}
                    maxLength={MAX_TITLE_LENGTH}
                    size="sm"
                    className="m-px w-[120px] text-center"
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
    if (!label && !active) {
        return null;
    }
    /* HTML, not `<text>` in a fixed 64 by 24 pill: the pill then grows with the label and with the
       interface font size, which an SVG rect of hard numbers cannot do. */
    return (
        <foreignObject x={at.x - 100} y={at.y - 16} width="200" height="32" style={{ overflow: 'visible' }}>
            <div className="flex h-8 items-center justify-center" onDoubleClick={(e) => (e.stopPropagation(), onEdit(true))}>
                <div className="relative">
                    {label && (
                        <span
                            className="pointer-events-auto cursor-text rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-xs whitespace-nowrap text-text-muted"
                            onPointerDown={(event) => {
                                event.stopPropagation();
                                canvasStore.getState().select(ids, event.shiftKey);
                            }}
                        >
                            {label}
                        </span>
                    )}
                    {active && (
                        <IconButton
                            icon={X}
                            size="xs"
                            label={t('action.remove')}
                            className="pointer-events-auto absolute top-1/2 left-full ml-1 -translate-y-1/2 rounded-full border border-border bg-surface-raised"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                onRemove();
                            }}
                        />
                    )}
                </div>
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

function DraftLine({ draft, from, obstacles }: { draft: NonNullable<CanvasState['linkDraft']>; from: Rect | null; obstacles: readonly Obstacle[] }) {
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
            <path d={route.d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" strokeLinejoin="round" />
            <EdgeMarker shape="dot" at={route.from} side={route.fromSide} stroke="var(--accent)" />
        </>
    );
}

interface EdgeRowProps {
    layer: 'lines' | 'labels';
    line: EdgeLine;
    route: EdgeRoute;
    label: string | undefined;
    stroke: string;
    width: number;
    dashed: boolean;
    tail: MarkerShape;
    head: MarkerShape;
    active: boolean;
    editing: boolean;
    onHover: Dispatch<SetStateAction<string | null>>;
    onEdit: Dispatch<SetStateAction<string | null>>;
}

/* One line in one of the two layers. Memoized, since a canvas holds a line per agent it ran and a hover or a click changes one of them. */
const EdgeRow = memo(function EdgeRow({ layer, line, route, label, stroke, width, dashed, tail, head, active, editing, onHover, onEdit }: EdgeRowProps) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const key = line.edge.id;
    const remove = (): void => {
        for (const id of line.ids) {
            canvasStore.getState().removeEdge(id);
        }
    };
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger render={<g />} onPointerEnter={() => onHover(key)} onPointerLeave={() => onHover((h) => (h === key ? null : h))}>
                {layer === 'lines' && (
                    <>
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
                                onEdit(key);
                            }}
                        />
                        <path
                            d={route.d}
                            fill="none"
                            stroke={stroke}
                            strokeWidth={width}
                            strokeDasharray={dashed ? '6 6' : undefined}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <EdgeMarker shape={tail} at={route.from} side={route.fromSide} stroke={stroke} />
                        <EdgeMarker shape={head} at={route.to} side={route.toSide} stroke={stroke} />
                    </>
                )}
                {layer === 'labels' && (
                    <EdgeLabel
                        ids={line.ids}
                        label={label}
                        at={route.mid}
                        editing={editing}
                        active={active}
                        onRemove={remove}
                        onEdit={(on) => onEdit(on ? key : null)}
                    />
                )}
            </ContextMenu.Trigger>
            <ContextMenu.Popup>
                <ContextMenu.Item onClick={() => onEdit(key)}>
                    <Icon icon={Pencil} size={14} /> {t('common:action.rename')} <ContextMenu.Hint>{t('menu.doubleClick')}</ContextMenu.Hint>
                </ContextMenu.Item>
                <ContextMenu.Separator />
                <ContextMenu.Item onClick={remove}>
                    <Icon icon={Trash} size={14} /> {t('common:action.remove')}
                </ContextMenu.Item>
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
});

/* It reads the store itself, so what renders the canvas above moves nothing drawn here. */
export function EdgeLayer() {
    const edges = useCanvas((s) => s.edges);
    const nodes = useCanvas((s) => s.nodes);
    const texts = useCanvas((s) => s.texts);
    const hidden = useCanvas((s) => s.hidden);
    const selection = useCanvas((s) => s.selection);
    const draft = useCanvas((s) => s.linkDraft);
    const [hovered, setHovered] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const endpointId = useEndpointId();
    const endpoints = useEndpoints((s) => s.endpoints);
    const tasks = useTasks((s) => s.byEndpoint);

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
        <>
            {(['lines', 'labels'] as const).map((layer) => (
                <svg key={layer} data-edge-layer={layer} className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
                    {[...lines]
                        .sort((first, second) => (layer === 'labels' ? Number(first.edge.id === editing) - Number(second.edge.id === editing) : 0))
                        .map((line) => {
                            const key = line.edge.id;
                            const route = routes.get(key);
                            if (route === undefined) {
                                return null;
                            }
                            const active = hovered === key || line.ids.some((id) => selection.includes(id));
                            // A line a task went along says how the task stands, and only looks open while it is.
                            // The tasks a machine keeps are about its own nodes, so a line between nodes of another machine reads that machine's.
                            const machineTasks = tasks[endpointOfNodeIn(endpoints, nodes[line.edge.from] ?? {}, endpointId)];
                            const task =
                                edgeTask(machineTasks, line.edge.from, line.edge.to) ??
                                (line.back === null ? null : edgeTask(machineTasks, line.back.from, line.back.to));
                            const look = edgeLook(lineMeaning(line, readsContext, drivenByAgent), {
                                pair: line.back !== null,
                                openTask: task !== null && task.status === 'open'
                            });
                            return (
                                <EdgeRow
                                    key={key}
                                    layer={layer}
                                    line={line}
                                    route={route}
                                    label={task === null ? line.label : taskEdgeLabel(task.status)}
                                    stroke={
                                        look.accent ? (active ? 'var(--accent)' : 'var(--edge-context)') : active ? 'var(--text-muted)' : 'var(--edge-line)'
                                    }
                                    width={active ? look.width + 1 : look.width}
                                    dashed={look.dashed}
                                    tail={look.tail}
                                    head={look.head}
                                    active={active}
                                    editing={editing === key}
                                    onHover={setHovered}
                                    onEdit={setEditing}
                                />
                            );
                        })}
                    {layer === 'lines' && draft && <DraftLine draft={draft} from={rectOf(draft.from)} obstacles={obstacles} />}
                </svg>
            ))}
        </>
    );
}

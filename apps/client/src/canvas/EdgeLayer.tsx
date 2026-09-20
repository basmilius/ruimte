import { useEffect, useMemo, useState } from 'react';
import { isAgentKind, useCanvas, useCanvasStore } from '@/state/canvas';
import { edgeLines, fixedSides, selectedLine, textRect } from '@/canvas/edge-lines';
import { edgeLook, lineRole } from '@/canvas/edge-look';
import { DraftEdge, EdgePath } from '@/canvas/EdgePath';
import { routeDraft, routeEdge, selfRoute, type Obstacle } from '@/canvas/edge-route';
import type { Point, Rect } from '@/canvas/math';
import { useEndpointId } from '@/state/keys';
import { edgeTask, taskEdgeLabel, useTasks } from '@/state/tasks';

/* The name a person wrote on a line. It rides on the line rather than on the canvas, so it keeps its
   size on screen the way the line does and stays out of the cross beside it at every zoom. */
function EdgeLabel({
    ids,
    label,
    at,
    zoom,
    editing,
    onEdit
}: {
    ids: string[];
    label: string | undefined;
    at: Point;
    zoom: number;
    editing: boolean;
    onEdit(editing: boolean): void;
}) {
    const canvasStore = useCanvasStore();
    const place = `translate(${at.x} ${at.y}) scale(${1 / zoom})`;
    if (editing) {
        return (
            <foreignObject transform={place} x="-60" y="-14" width="120" height="28">
                <input
                    autoFocus
                    defaultValue={label ?? ''}
                    className="h-7 w-full rounded-full border border-accent bg-surface-raised px-2 text-center text-xs text-text outline-none"
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
        <foreignObject transform={place} x="-100" y="-16" width="200" height="32" style={{ overflow: 'visible' }}>
            <div className="flex h-8 items-center justify-center" onDoubleClick={(e) => (e.stopPropagation(), onEdit(true))}>
                <span className="pointer-events-auto cursor-text rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-xs whitespace-nowrap text-text-muted">
                    {label}
                </span>
            </div>
        </foreignObject>
    );
}

export function EdgeLayer() {
    const canvasStore = useCanvasStore();
    const edges = useCanvas((s) => s.edges);
    const nodes = useCanvas((s) => s.nodes);
    const texts = useCanvas((s) => s.texts);
    const hidden = useCanvas((s) => s.hidden);
    const selection = useCanvas((s) => s.selection);
    const draft = useCanvas((s) => s.linkDraft);
    const zoom = useCanvas((s) => s.camera.zoom);
    const [hovered, setHovered] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const endpointId = useEndpointId();
    const tasks = useTasks((s) => s.byEndpoint[endpointId]);

    const lines = useMemo(() => edgeLines(edges), [edges]);

    // A selected line answers Enter the way a selected node does: it opens what you can edit on it.
    const selected = selectedLine(lines, selection);
    const selectedKey = selected === null ? null : selected.edge.id;
    useEffect(() => {
        if (selectedKey === null) {
            return;
        }
        const onKeyDown = (e: KeyboardEvent): void => {
            const target = e.target;
            if (
                e.key !== 'Enter' ||
                (target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'))
            ) {
                return;
            }
            e.preventDefault();
            setEditing(selectedKey);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedKey]);

    const rectOf = (id: string): Rect | null => (hidden.has(id) ? null : nodes[id] ? nodes[id] : texts[id] ? textRect(texts[id]) : null);

    /* What a line routes around. A group is a frame under its nodes, so a line between two of them
       would be pushed out of the group it belongs to. */
    const obstacles = useMemo(
        () =>
            Object.values(nodes)
                .filter((node) => node.kind !== 'group' && !hidden.has(node.id))
                .map(({ id, x, y, w, h }): Obstacle => ({ id, x, y, w, h })),
        [hidden, nodes]
    );

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
                const a = rectOf(line.edge.from);
                const b = rectOf(line.edge.to);
                if (!a || !b) {
                    return null;
                }
                const key = line.edge.id;
                const route =
                    line.edge.from === line.edge.to
                        ? selfRoute(a)
                        : routeEdge(
                              a,
                              b,
                              obstacles.filter((obstacle) => obstacle.id !== line.edge.from && obstacle.id !== line.edge.to),
                              fixedSides(line)
                          );
                const mid = route.mid;
                const active = hovered === key || line.ids.some((id) => selection.includes(id));
                // A line a task went along says how the task stands, and only looks open while it is.
                const task = edgeTask(tasks, line.edge.from, line.edge.to) ?? (line.back === null ? null : edgeTask(tasks, line.back.from, line.back.to));
                const label = task === null ? line.label : taskEdgeLabel(task.status);
                const look = edgeLook(lineRole(line, readsContext, drivenByAgent), {
                    pair: line.back !== null,
                    openTask: task !== null && task.status === 'open'
                });
                return (
                    <EdgePath
                        key={key}
                        route={route}
                        look={look}
                        zoom={zoom}
                        active={active}
                        onEnter={() => setHovered(key)}
                        onLeave={() => setHovered((current) => (current === key ? null : current))}
                        onPress={(e) => {
                            e.stopPropagation();
                            // One line is one thing to click, so both of its directions are selected together.
                            canvasStore.getState().select(line.ids, e.shiftKey);
                        }}
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditing(key);
                        }}
                        removeOffset={label ? 40 : 0}
                        onRemove={
                            editing === key
                                ? undefined
                                : () => {
                                      for (const id of line.ids) {
                                          canvasStore.getState().removeEdge(id);
                                      }
                                  }
                        }
                    >
                        <EdgeLabel ids={line.ids} label={label} at={mid} zoom={zoom} editing={editing === key} onEdit={(on) => setEditing(on ? key : null)} />
                    </EdgePath>
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
                    return <DraftEdge route={route} zoom={zoom} />;
                })()}
        </svg>
    );
}

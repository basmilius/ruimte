import { useEffect, useMemo, useState } from 'react';
import { isAgentKind, useCanvas, useCanvasStore } from '@/state/canvas';
import { edgeLines, fixedSides, selectedLine, textRect, type EdgeLine } from '@/canvas/edge-lines';
import { routeDraft, routeEdge, selfRoute, type Obstacle } from '@/canvas/edge-route';
import type { Point, Rect } from '@/canvas/math';
import { useEndpointId } from '@/state/keys';
import { TASK_EDGE_LABEL, edgeTask, useTasks } from '@/state/tasks';

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
        return (
            <foreignObject x={at.x - 60} y={at.y - 14} width="120" height="28">
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
        <foreignObject x={at.x - 100} y={at.y - 16} width="200" height="32" style={{ overflow: 'visible' }}>
            <div className="flex h-8 items-center justify-center" onDoubleClick={(e) => (e.stopPropagation(), onEdit(true))}>
                <span className="pointer-events-auto cursor-text rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-xs whitespace-nowrap text-text-muted">
                    {label}
                </span>
            </div>
        </foreignObject>
    );
}

/* Where a line meets a node: it stops a gap short and leaves this hole in the canvas behind, rimmed
   in its own color, so nothing is ever drawn against a node's border. */
function PortDot({ at, stroke }: { at: Point; stroke: string }) {
    return <circle cx={at.x} cy={at.y} r="5" fill="var(--canvas-bg)" stroke={stroke} strokeWidth="2" />;
}

export function EdgeLayer() {
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

    /* Into an agent the line carries context and shows it in the accent; anywhere else it is a plain
       line. A pair between two agents is one either way round. */
    const carriesContext = (line: EdgeLine): boolean =>
        [line.edge.to, ...(line.back === null ? [] : [line.back.to])].some((id) => {
            const target = nodes[id];
            return target !== undefined && isAgentKind(target.kind);
        });

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
                const context = carriesContext(line);
                const stroke = context ? (active ? 'var(--accent)' : 'var(--edge-context)') : active ? 'var(--text-muted)' : 'var(--edge-line)';
                // A line a task went along says how the task stands, and stays dashed only while it is open.
                const task = edgeTask(tasks, line.edge.from, line.edge.to) ?? (line.back === null ? null : edgeTask(tasks, line.back.from, line.back.to));
                const label = task === null ? line.label : TASK_EDGE_LABEL[task.status];
                const dashed = task === null ? context : task.status === 'open';
                return (
                    <g key={key} onPointerEnter={() => setHovered(key)} onPointerLeave={() => setHovered((h) => (h === key ? null : h))}>
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
                            strokeWidth={active ? 3 : 2}
                            strokeDasharray={dashed ? '6 6' : undefined}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        <PortDot at={route.from} stroke={stroke} />
                        <PortDot at={route.to} stroke={stroke} />
                        <EdgeLabel ids={line.ids} label={label} at={mid} editing={editing === key} onEdit={(on) => setEditing(on ? key : null)} />
                        {active && editing !== key && (
                            <g
                                transform={`translate(${mid.x + (label ? 40 : 0)}, ${mid.y})`}
                                className="pointer-events-auto cursor-pointer"
                                onPointerDown={(e) => {
                                    e.stopPropagation();
                                    for (const id of line.ids) {
                                        canvasStore.getState().removeEdge(id);
                                    }
                                }}
                            >
                                <circle r="9" fill="var(--surface-raised)" stroke="var(--border-strong)" />
                                <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
                            </g>
                        )}
                    </g>
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
                            <circle cx={route.from.x} cy={route.from.y} r="5" fill="var(--canvas-bg)" stroke="var(--accent)" strokeWidth="2" />
                        </>
                    );
                })()}
        </svg>
    );
}

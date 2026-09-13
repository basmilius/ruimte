import { useEffect, useMemo, useState } from 'react';
import { isAgentKind, useCanvas, useCanvasStore } from '@/state/canvas';
import { anchors, curve, edgeLines, selectedLine, textRect, type EdgeLine } from '@/canvas/edge-lines';
import type { Point, Rect } from '@/canvas/math';

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
                const p = anchors(a, b);
                const d = curve(p);
                const mid = { x: (p.ax + p.bx) / 2, y: (p.ay + p.by) / 2 };
                const active = hovered === key || line.ids.some((id) => selection.includes(id));
                const context = carriesContext(line);
                const stroke = context ? 'var(--accent)' : active ? 'var(--text-muted)' : 'var(--border-strong)';
                return (
                    <g key={key} onPointerEnter={() => setHovered(key)} onPointerLeave={() => setHovered((h) => (h === key ? null : h))}>
                        {/* A wide invisible stroke gives the thin line something to hover and click; a double-click names it. */}
                        <path
                            d={d}
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
                            d={d}
                            fill="none"
                            stroke={stroke}
                            strokeWidth={active ? 3 : 2}
                            strokeOpacity={context ? (active ? 0.95 : 0.55) : 1}
                            strokeDasharray={context ? '6 6' : undefined}
                        />
                        <circle cx={p.bx} cy={p.by} r="4" fill={stroke} />
                        {/* A head at the tail too: the pair reads at a glance as both nodes reading each other. */}
                        {line.back !== null && <circle cx={p.ax} cy={p.ay} r="4" fill={stroke} />}
                        <EdgeLabel ids={line.ids} label={line.label} at={mid} editing={editing === key} onEdit={(on) => setEditing(on ? key : null)} />
                        {active && editing !== key && (
                            <g
                                transform={`translate(${mid.x + (line.label ? 40 : 0)}, ${mid.y})`}
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
                    const p = anchors(from, { x: draft.to.x, y: draft.to.y, w: 0, h: 0 });
                    return <path d={curve(p)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeOpacity="0.8" strokeDasharray="4 4" />;
                })()}
        </svg>
    );
}

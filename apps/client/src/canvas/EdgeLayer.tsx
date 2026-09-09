import { useState } from 'react';
import clsx from 'clsx';
import { useCanvas } from '@/state/canvas';
import type { Point, Rect } from '@/canvas/math';

/* Anchor on the facing sides, so an edge takes the short way round. */
const anchors = (a: Rect, b: Rect): { ax: number; ay: number; bx: number; by: number; horizontal: boolean } => {
    const acx = a.x + a.w / 2,
        acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2,
        bcy = b.y + b.h / 2;
    const horizontal = Math.abs(bcx - acx) >= Math.abs(bcy - acy);
    if (horizontal) {
        const right = bcx >= acx;
        return {
            ax: right ? a.x + a.w : a.x,
            ay: acy,
            bx: right ? b.x : b.x + b.w,
            by: bcy,
            horizontal
        };
    }
    const below = bcy >= acy;
    return {
        ax: acx,
        ay: below ? a.y + a.h : a.y,
        bx: bcx,
        by: below ? b.y : b.y + b.h,
        horizontal
    };
};

const curve = (p: ReturnType<typeof anchors>): string =>
    p.horizontal
        ? `M ${p.ax} ${p.ay} C ${(p.ax + p.bx) / 2} ${p.ay}, ${(p.ax + p.bx) / 2} ${p.by}, ${p.bx} ${p.by}`
        : `M ${p.ax} ${p.ay} C ${p.ax} ${(p.ay + p.by) / 2}, ${p.bx} ${(p.ay + p.by) / 2}, ${p.bx} ${p.by}`;

// A text has no box of its own; this is close enough to aim an edge at.
const textRect = (text: { x: number; y: number; size: number; text: string }): Rect => ({
    x: text.x,
    y: text.y,
    w: Math.max(40, text.text.length * text.size * 0.55),
    h: text.size * 1.4
});

function EdgeLabel({ id, label, at, editing, onEdit }: { id: string; label: string | undefined; at: Point; editing: boolean; onEdit(editing: boolean): void }) {
    if (editing) {
        return (
            <foreignObject x={at.x - 60} y={at.y - 12} width="120" height="24">
                <input
                    autoFocus
                    defaultValue={label ?? ''}
                    className="h-6 w-full rounded-full border border-accent bg-surface-raised px-2 text-center text-[11px] text-text outline-none"
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                        useCanvas.getState().setEdgeLabel(id, e.currentTarget.value);
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
    return (
        <g transform={`translate(${at.x}, ${at.y})`} className="cursor-text" onDoubleClick={(e) => (e.stopPropagation(), onEdit(true))}>
            <rect x="-30" y="-11" width="60" height="22" rx="11" fill="var(--surface-raised)" stroke="var(--border)" />
            <text textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="var(--text-muted)" fontFamily="var(--font-sans)">
                {label}
            </text>
        </g>
    );
}

export function EdgeLayer() {
    const edges = useCanvas((s) => s.edges);
    const nodes = useCanvas((s) => s.nodes);
    const texts = useCanvas((s) => s.texts);
    const hidden = useCanvas((s) => s.hidden);
    const selection = useCanvas((s) => s.selection);
    const draft = useCanvas((s) => s.linkDraft);
    const [hovered, setHovered] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);

    const rectOf = (id: string): Rect | null => (hidden.has(id) ? null : nodes[id] ? nodes[id] : texts[id] ? textRect(texts[id]) : null);

    return (
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            {edges.map((edge) => {
                const a = rectOf(edge.from);
                const b = rectOf(edge.to);
                if (!a || !b) {
                    return null;
                }
                const p = anchors(a, b);
                const d = curve(p);
                const mid = { x: (p.ax + p.bx) / 2, y: (p.ay + p.by) / 2 };
                const active = hovered === edge.id || selection.includes(edge.id);
                return (
                    <g
                        key={edge.id}
                        className={clsx(active && 'edge-active')}
                        onPointerEnter={() => setHovered(edge.id)}
                        onPointerLeave={() => setHovered((h) => (h === edge.id ? null : h))}
                    >
                        {/* A wide invisible stroke gives the thin line something to hover and click. */}
                        <path
                            d={d}
                            fill="none"
                            stroke="transparent"
                            strokeWidth="14"
                            className="pointer-events-auto cursor-pointer"
                            onPointerDown={(e) => {
                                e.stopPropagation();
                                useCanvas.getState().select([edge.id], e.shiftKey);
                            }}
                        />
                        <path
                            d={d}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth={active ? 2.5 : 2}
                            strokeOpacity={active ? 0.95 : 0.55}
                            strokeDasharray="6 6"
                        />
                        <circle cx={p.bx} cy={p.by} r="4" fill="var(--accent)" />
                        <EdgeLabel id={edge.id} label={edge.label} at={mid} editing={editing === edge.id} onEdit={(on) => setEditing(on ? edge.id : null)} />
                        {active && editing !== edge.id && (
                            <g
                                transform={`translate(${mid.x + (edge.label ? 40 : 0)}, ${mid.y})`}
                                className="pointer-events-auto cursor-pointer"
                                onPointerDown={(e) => {
                                    e.stopPropagation();
                                    useCanvas.getState().removeEdge(edge.id);
                                }}
                            >
                                <circle r="9" fill="var(--surface-raised)" stroke="var(--border-strong)" />
                                <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" />
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

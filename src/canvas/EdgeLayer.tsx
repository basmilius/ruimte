import { useCanvas } from '@/state/canvas';
import type { Rect } from '@/canvas/math';

/* Anchor on the facing sides, so an edge takes the short way round. */
const anchors = (a: Rect, b: Rect): { ax: number; ay: number; bx: number; by: number; horizontal: boolean } => {
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    const horizontal = Math.abs(bcx - acx) >= Math.abs(bcy - acy);
    if (horizontal) {
        const right = bcx >= acx;
        return { ax: right ? a.x + a.w : a.x, ay: acy, bx: right ? b.x : b.x + b.w, by: bcy, horizontal };
    }
    const below = bcy >= acy;
    return { ax: acx, ay: below ? a.y + a.h : a.y, bx: bcx, by: below ? b.y : b.y + b.h, horizontal };
};

export function EdgeLayer() {
    const edges = useCanvas((s) => s.edges);
    const nodes = useCanvas((s) => s.nodes);
    return (
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            {edges.map((edge) => {
                const a = nodes[edge.from];
                const b = nodes[edge.to];
                if (!a || !b) {
                    return null;
                }
                const p = anchors(a, b);
                const d = p.horizontal
                    ? `M ${p.ax} ${p.ay} C ${(p.ax + p.bx) / 2} ${p.ay}, ${(p.ax + p.bx) / 2} ${p.by}, ${p.bx} ${p.by}`
                    : `M ${p.ax} ${p.ay} C ${p.ax} ${(p.ay + p.by) / 2}, ${p.bx} ${(p.ay + p.by) / 2}, ${p.bx} ${p.by}`;
                const mx = (p.ax + p.bx) / 2, my = (p.ay + p.by) / 2;
                return (
                    <g key={edge.id}>
                        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeOpacity="0.55" strokeDasharray="6 6" />
                        <circle cx={p.bx} cy={p.by} r="4" fill="var(--accent)" />
                        {edge.label && (
                            <g transform={`translate(${mx}, ${my})`}>
                                <rect x="-30" y="-11" width="60" height="22" rx="11" fill="var(--surface-raised)" stroke="var(--border)" />
                                <text textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="var(--text-muted)" fontFamily="var(--font-sans)">{edge.label}</text>
                            </g>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}

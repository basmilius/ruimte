import { useState, type ReactNode } from 'react';
import type { ProcessPoint } from '@ruimte/contracts';
import { formatClock } from '@ruimte/agents-react/usage/format';
import { SECTION_LABEL } from '@ruimte/ui/classes';
import { useMeasuredWidth } from '@ruimte/ui/useMeasuredWidth';

const HEIGHT = 44;

/* Runs of points with a value, so a stretch that could not be measured is a gap and not a line to zero. */
const runs = (points: readonly ProcessPoint[], read: (point: ProcessPoint) => number | null): ProcessPoint[][] => {
    const out: ProcessPoint[][] = [];
    let current: ProcessPoint[] = [];
    for (const point of points) {
        if (read(point) === null) {
            if (current.length > 0) {
                out.push(current);
            }
            current = [];
        } else {
            current.push(point);
        }
    }
    if (current.length > 0) {
        out.push(current);
    }
    return out;
};

interface ProcessChartProps {
    label: ReactNode;
    /* What the chart says while nobody points at it: the value now. */
    headline: string;
    points: readonly ProcessPoint[];
    windowMs: number;
    /* The daemon's clock of the newest sample, so a machine whose clock differs from this one still ends at the right edge. */
    end: number;
    max: number;
    machine(point: ProcessPoint): number | null;
    ruimte(point: ProcessPoint): number | null;
    format(value: number): string;
}

/*
 * One measure over time: the whole machine as a line and the share of Ruimte as the area under it,
 * so a glance says whether Ruimte is what makes the machine slow or something else is.
 */
export function ProcessChart({ label, headline, points, windowMs, end, max, machine, ruimte, format }: ProcessChartProps) {
    const [measure, width] = useMeasuredWidth();
    const [hovered, setHovered] = useState<ProcessPoint | null>(null);
    const start = end - windowMs;
    const visible = points.filter((point) => point.at >= start);
    const xOf = (at: number): number => Math.round(((at - start) / windowMs) * width);
    const yOf = (value: number): number => Math.round(HEIGHT - Math.min(1, Math.max(0, max > 0 ? value / max : 0)) * (HEIGHT - 1));

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
        const bounds = e.currentTarget.getBoundingClientRect();
        const at = start + ((e.clientX - bounds.left) / Math.max(1, width)) * windowMs;
        let nearest: ProcessPoint | null = null;
        for (const point of visible) {
            if (nearest === null || Math.abs(point.at - at) < Math.abs(nearest.at - at)) {
                nearest = point;
            }
        }
        setHovered(nearest);
    };

    const readout = (point: ProcessPoint): string => {
        const whole = machine(point);
        const share = ruimte(point);
        return `${formatClock(point.at)}: ${whole === null ? '-' : format(whole)}, Ruimte ${share === null ? '-' : format(share)}`;
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
                <span className={SECTION_LABEL}>{label}</span>
                <span className="grow" />
                <span className="truncate text-xs text-text tabular-nums">{hovered === null ? headline : readout(hovered)}</span>
            </div>
            <div ref={measure} className="relative" style={{ height: HEIGHT }} onPointerMove={onPointerMove} onPointerLeave={() => setHovered(null)}>
                <svg width={width} height={HEIGHT} role="presentation" className="block">
                    <line x1={0} x2={width} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} stroke="var(--border)" strokeWidth={1} />
                    {runs(visible, ruimte).map((run) => (
                        <path
                            key={`area-${run[0]!.at}`}
                            d={`M${xOf(run[0]!.at)},${HEIGHT} ${run.map((point) => `L${xOf(point.at)},${yOf(ruimte(point)!)}`).join(' ')} L${xOf(run.at(-1)!.at)},${HEIGHT} Z`}
                            fill="var(--accent)"
                            fillOpacity={0.28}
                        />
                    ))}
                    {runs(visible, machine).map((run) => (
                        <polyline
                            key={`line-${run[0]!.at}`}
                            points={run.map((point) => `${xOf(point.at)},${yOf(machine(point)!)}`).join(' ')}
                            fill="none"
                            stroke="var(--text-muted)"
                            strokeWidth={1}
                        />
                    ))}
                    {hovered !== null && (
                        <line x1={xOf(hovered.at) + 0.5} x2={xOf(hovered.at) + 0.5} y1={0} y2={HEIGHT} stroke="var(--border-strong)" strokeWidth={1} />
                    )}
                </svg>
            </div>
        </div>
    );
}

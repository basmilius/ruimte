import clsx from 'clsx';
import type { AlignmentGuide, GapGuide } from '@/canvas/alignment-guides';
import type { Camera } from '@/canvas/math';
import { formatNumber } from '@ruimte/ui/format/number';

const TICK = 4;

export function AlignmentGuides({ guides, gaps, camera }: { guides: readonly AlignmentGuide[]; gaps: readonly GapGuide[]; camera: Camera }) {
    if (guides.length === 0 && gaps.length === 0) {
        return null;
    }
    const toScreen = (value: number, axis: 'x' | 'y'): number => value * camera.zoom + (axis === 'x' ? camera.x : camera.y);
    return (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
            <svg className="absolute inset-0 h-full w-full">
                {guides.map((guide) => {
                    const vertical = guide.axis === 'x';
                    const cross = vertical ? 'y' : 'x';
                    const position = toScreen(guide.position, guide.axis);
                    const start = toScreen(guide.start, cross) - 8;
                    const end = toScreen(guide.end, cross) + 8;
                    return (
                        <line
                            key={`${guide.axis}:${guide.position}`}
                            className="text-accent"
                            x1={vertical ? position : start}
                            y1={vertical ? start : position}
                            x2={vertical ? position : end}
                            y2={vertical ? end : position}
                            stroke="currentColor"
                            strokeWidth={1}
                        />
                    );
                })}
                {gaps.map((gap) => {
                    const along = gap.axis === 'x';
                    const cross = along ? 'y' : 'x';
                    const position = toScreen(gap.position, cross);
                    const start = toScreen(gap.start, gap.axis);
                    const end = toScreen(gap.end, gap.axis);
                    return (
                        <g
                            key={`${gap.axis}:${gap.start}:${gap.end}:${gap.position}`}
                            className={gap.equal ? 'text-accent' : 'text-text-muted'}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1}
                        >
                            <path d={along ? `M${start} ${position}H${end}` : `M${position} ${start}V${end}`} strokeDasharray="4 3" />
                            <path
                                d={
                                    along
                                        ? `M${start} ${position - TICK}V${position + TICK}M${end} ${position - TICK}V${position + TICK}`
                                        : `M${position - TICK} ${start}H${position + TICK}M${position - TICK} ${end}H${position + TICK}`
                                }
                            />
                        </g>
                    );
                })}
            </svg>
            {gaps.map((gap) => {
                const along = gap.axis === 'x';
                const middle = Math.round(toScreen((gap.start + gap.end) / 2, gap.axis));
                const position = Math.round(toScreen(gap.position, along ? 'y' : 'x'));
                return (
                    <span
                        key={`${gap.axis}:${gap.start}:${gap.end}:${gap.position}`}
                        className={clsx(
                            'absolute -translate-x-1/2 -translate-y-1/2 rounded-md px-1.5 font-mono text-xs tabular-nums shadow-float',
                            gap.equal ? 'bg-accent text-accent-text' : 'bg-surface-raised text-text-muted'
                        )}
                        style={{ left: along ? middle : position, top: along ? position : middle }}
                    >
                        {formatNumber(gap.end - gap.start)}
                    </span>
                );
            })}
        </div>
    );
}

import type { PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@adecore/ui/format';
import clsx from 'clsx';
import type { Camera } from '@/canvas/math';
import type { EditableGap, GapNode } from '@/canvas/editable-gaps';

export function GapHandles({
    gaps,
    nodes,
    camera,
    onStart
}: {
    gaps: readonly EditableGap[];
    nodes: Record<string, GapNode>;
    camera: Camera;
    onStart(gap: EditableGap, event: PointerEvent): void;
}) {
    const { t } = useTranslation('canvas');
    return (
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" data-gap-handles>
            {gaps.map((gap) => {
                const from = nodes[gap.from];
                const to = nodes[gap.to];
                if (!from || !to) {
                    return null;
                }
                const horizontal = gap.axis === 'x';
                const size = horizontal ? 'w' : 'h';
                const cross = horizontal ? 'y' : 'x';
                const crossSize = horizontal ? 'h' : 'w';
                const start = (from[gap.axis] + from[size]) * camera.zoom + camera[gap.axis];
                const end = to[gap.axis] * camera.zoom + camera[gap.axis];
                const position =
                    ((Math.max(from[cross], to[cross]) + Math.min(from[cross] + from[crossSize], to[cross] + to[crossSize])) / 2) * camera.zoom + camera[cross];
                const middle = (start + end) / 2;
                const hitSize = Math.min(40, Math.max(12, end - start + (Math.min(from[size], to[size]) * camera.zoom) / 2));
                const value = formatNumber(Math.max(0, to[gap.axis] - from[gap.axis] - from[size]));
                return (
                    <div key={gap.id}>
                        <svg className="absolute inset-0 h-full w-full text-accent" aria-hidden>
                            <path
                                d={
                                    horizontal
                                        ? `M${start} ${position}H${end}M${start} ${position - 4}V${position + 4}M${end} ${position - 4}V${position + 4}`
                                        : `M${position} ${start}V${end}M${position - 4} ${start}H${position + 4}M${position - 4} ${end}H${position + 4}`
                                }
                                stroke="currentColor"
                                strokeWidth={1}
                                fill="none"
                            />
                        </svg>
                        <button
                            type="button"
                            data-gap-id={gap.id}
                            aria-label={t(gap.shared ? 'gaps.shared' : 'gaps.adjust', { from: from.title ?? '', to: to.title ?? '', value })}
                            className={clsx(
                                'pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-accent',
                                horizontal ? 'cursor-ew-resize' : 'cursor-ns-resize'
                            )}
                            style={{
                                left: horizontal ? middle : position,
                                top: horizontal ? position : middle,
                                width: horizontal ? hitSize : 40,
                                height: horizontal ? 40 : hitSize
                            }}
                            onPointerDown={(event) => onStart(gap, event)}
                            onMouseDown={(event) => event.preventDefault()}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onContextMenu={(event) => event.stopPropagation()}
                        >
                            <span
                                className={clsx(
                                    'pointer-events-none rounded-md px-1.5 font-mono text-xs tabular-nums shadow-float',
                                    gap.shared ? 'bg-accent text-accent-text' : 'border border-accent bg-surface-raised text-text'
                                )}
                            >
                                {value}
                            </span>
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

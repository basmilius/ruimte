import type { Rect } from '@/canvas/math';

export interface AlignmentGuide {
    axis: 'x' | 'y';
    position: number;
    start: number;
    end: number;
}

export function alignmentGuides(moving: readonly Rect[], stationary: readonly Rect[]): AlignmentGuide[] {
    const guides = new Map<string, AlignmentGuide>();
    for (const rect of moving) {
        for (const other of stationary) {
            for (const axis of ['x', 'y'] as const) {
                const size = axis === 'x' ? 'w' : 'h';
                const cross = axis === 'x' ? 'y' : 'x';
                const crossSize = axis === 'x' ? 'h' : 'w';
                for (const fraction of [0, 0.5, 1]) {
                    const position = rect[axis] + rect[size] * fraction;
                    const matches = [0, 0.5, 1].some((value) => Math.abs(position - other[axis] - other[size] * value) < 0.001);
                    if (!matches) {
                        continue;
                    }
                    const key = `${axis}:${position.toFixed(3)}`;
                    const existing = guides.get(key);
                    guides.set(key, {
                        axis,
                        position,
                        start: Math.min(rect[cross], other[cross], existing?.start ?? Infinity),
                        end: Math.max(rect[cross] + rect[crossSize], other[cross] + other[crossSize], existing?.end ?? -Infinity)
                    });
                }
            }
        }
    }
    return [...guides.values()];
}

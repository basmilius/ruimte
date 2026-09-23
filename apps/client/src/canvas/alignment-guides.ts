import { unionOf, type Rect } from '@/canvas/math';

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

export interface GapGuide {
    axis: 'x' | 'y';
    start: number;
    end: number;
    /* Where the line runs on the other axis: the middle of the stretch both nodes cover. */
    position: number;
    equal: boolean;
}

type Gap = Omit<GapGuide, 'equal'>;

const EPSILON = 0.001;

/* What the label shows, so two gaps are equal exactly when they read the same. */
const measure = (gap: Gap): number => Math.round(gap.end - gap.start);

/* A neighbor that touches still stands in the way, so it answers with no gap rather than letting a node further out through. */
const nearestGap = (rect: Rect, others: readonly Rect[], axis: 'x' | 'y', direction: 1 | -1): Gap | null => {
    const size = axis === 'x' ? 'w' : 'h';
    const cross = axis === 'x' ? 'y' : 'x';
    const crossSize = axis === 'x' ? 'h' : 'w';
    let best: Gap | null = null;
    for (const other of others) {
        if (other === rect) {
            continue;
        }
        const low = Math.max(rect[cross], other[cross]);
        const high = Math.min(rect[cross] + rect[crossSize], other[cross] + other[crossSize]);
        if (high - low < EPSILON) {
            continue;
        }
        const start = direction > 0 ? rect[axis] + rect[size] : other[axis] + other[size];
        const end = direction > 0 ? other[axis] : rect[axis];
        if (end - start < -EPSILON || (best && end - start >= best.end - best.start)) {
            continue;
        }
        best = { axis, start, end, position: (low + high) / 2 };
    }
    return best && measure(best) > 0 ? best : null;
};

/*
 * What moves counts as one block. A gap that reads the same as another on its axis lights up with
 * it: the block's opposite gap, or a gap between two stationary neighbors, which is then drawn too.
 */
export function gapGuides(moving: readonly Rect[], stationary: readonly Rect[]): GapGuide[] {
    const block = unionOf(moving);
    if (!block) {
        return [];
    }
    const own: Gap[] = [];
    for (const axis of ['x', 'y'] as const) {
        for (const direction of [-1, 1] as const) {
            const gap = nearestGap(block, stationary, axis, direction);
            if (gap) {
                own.push(gap);
            }
        }
    }
    if (own.length === 0) {
        return [];
    }
    const between: Gap[] = [];
    for (const rect of stationary) {
        for (const axis of ['x', 'y'] as const) {
            const gap = nearestGap(rect, stationary, axis, 1);
            if (gap) {
                between.push(gap);
            }
        }
    }
    const reads = (gap: Gap, other: Gap): boolean => other !== gap && other.axis === gap.axis && measure(other) === measure(gap);
    return [
        ...own.map((gap) => ({ ...gap, equal: own.some((other) => reads(gap, other)) || between.some((other) => reads(gap, other)) })),
        ...between.filter((gap) => own.some((other) => reads(other, gap))).map((gap) => ({ ...gap, equal: true }))
    ];
}

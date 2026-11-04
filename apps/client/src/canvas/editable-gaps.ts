import { LINE_GRID } from '@/canvas/line-geometry';
import { overlapSpan, snapToGrid, type Point, type Rect } from '@/canvas/math';

export interface GapNode extends Rect {
    id: string;
    kind: string;
    title?: string;
    collapsed?: boolean;
}

export interface EditableGap {
    id: string;
    from: string;
    to: string;
    axis: 'x' | 'y';
    start: number;
    end: number;
    position: number;
    shared: boolean;
    minimum: number;
    moves: { id: string; factor: number }[];
    fixed: string[];
    gridOnly?: boolean;
}

function containsCenter(group: GapNode, node: GapNode): boolean {
    const x = node.x + node.w / 2;
    const y = node.y + node.h / 2;
    return x >= group.x && x <= group.x + group.w && y >= group.y && y <= group.y + group.h;
}

export function parentGroupOf(node: GapNode, nodes: readonly GapNode[]): string | null {
    let parent: GapNode | null = null;
    let area = Infinity;
    const ownArea = node.w * node.h;

    for (const group of nodes) {
        if (group.kind !== 'group' || group.id === node.id || group.collapsed) {
            continue;
        }

        const candidateArea = group.w * group.h;

        if (!(candidateArea > ownArea) || !containsCenter(group, node)) {
            continue;
        }

        if (parent === null || (candidateArea - area || group.id.localeCompare(parent.id)) < 0) {
            parent = group;
            area = candidateArea;
        }
    }

    return parent?.id ?? null;
}

function gapBetween(first: GapNode, second: GapNode, axis: 'x' | 'y'): Omit<EditableGap, 'shared' | 'moves' | 'minimum' | 'fixed'> | null {
    const size = axis === 'x' ? 'w' : 'h';
    const cross = axis === 'x' ? 'y' : 'x';
    const crossSize = axis === 'x' ? 'h' : 'w';
    const overlap = overlapSpan(first[cross], first[crossSize], second[cross], second[crossSize]);
    const start = first[axis] + first[size];
    const end = second[axis];
    if (!overlap || end < start) {
        return null;
    }
    return { id: `${axis}:${first.id}:${second.id}`, from: first.id, to: second.id, axis, start, end, position: (overlap.low + overlap.high) / 2 };
}

function shareEqualGaps(gaps: EditableGap[], nodes: readonly GapNode[]): void {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const axis of ['x', 'y'] as const) {
        const ordered = gaps.filter((gap) => gap.axis === axis).sort((first, second) => first.start - second.start || first.id.localeCompare(second.id));
        const following = new Map(ordered.map((gap) => [gap.from, gap]));
        const incoming = new Map<string, number>();
        for (const gap of ordered) {
            incoming.set(gap.to, (incoming.get(gap.to) ?? 0) + 1);
        }
        const visited = new Set<string>();
        const cross = axis === 'x' ? 'y' : 'x';
        const crossSize = axis === 'x' ? 'h' : 'w';
        for (const gap of ordered) {
            if (visited.has(gap.id)) {
                continue;
            }
            const first = byId.get(gap.from)!;
            const second = byId.get(gap.to)!;
            let low = Math.max(first[cross], second[cross]);
            let high = Math.min(first[cross] + first[crossSize], second[cross] + second[crossSize]);
            const row = [gap];
            visited.add(gap.id);
            let last = gap;
            // Branches and diagonal chains must not turn a local edit into a layout change.
            while (incoming.get(last.to) === 1) {
                const next = following.get(last.to);
                if (!next || visited.has(next.id) || incoming.get(next.to) !== 1 || Math.round(next.end - next.start) !== Math.round(gap.end - gap.start)) {
                    break;
                }
                const node = byId.get(next.to)!;
                const overlap = overlapSpan(low, high - low, node[cross], node[crossSize]);
                if (!overlap) {
                    break;
                }
                low = overlap.low;
                high = overlap.high;
                row.push(next);
                visited.add(next.id);
                last = next;
            }
            if (row.length > 1) {
                const minimum = Math.min(...row.map((gap) => gap.end - gap.start));
                const moves = row.map((gap, index) => ({ id: gap.to, factor: index + 1 }));
                for (const segment of row) {
                    Object.assign(segment, { shared: true, minimum, moves, fixed: [gap.from] });
                }
            }
        }
    }
}

function unselectedGaps(nodes: readonly GapNode[]): EditableGap[] {
    const levels = new Map<string | null, GapNode[]>();
    const groups = nodes.filter((node) => node.kind === 'group');

    for (const node of nodes) {
        const parent = parentGroupOf(node, groups);
        const siblings = levels.get(parent) ?? [];
        siblings.push(node);
        levels.set(parent, siblings);
    }
    const result: EditableGap[] = [];
    for (const siblings of levels.values()) {
        let byId: Map<string, GapNode> | null = null;
        for (const axis of ['x', 'y'] as const) {
            const size = axis === 'x' ? 'w' : 'h';
            const ordered = siblings.length < 32 ? null : siblings.toSorted((first, second) => first[axis] - second[axis]);
            const candidates = ordered ?? siblings;
            // An earlier wide node can still cross the gap; prefix maxima keep it in the blocker range.
            let furthest = -Infinity;
            const ends = ordered?.map((node) => {
                furthest = Math.max(furthest, node[axis] + node[size]);

                return furthest;
            });

            for (const first of siblings) {
                const start = first[axis] + first[size];
                let begin = 0;

                if (ordered !== null) {
                    let end = ordered.length;

                    while (begin < end) {
                        const middle = begin + Math.floor((end - begin) / 2);

                        if (ordered[middle]![axis] < start) {
                            begin = middle + 1;
                        } else {
                            end = middle;
                        }
                    }
                }

                let nearest: ReturnType<typeof gapBetween> = null;

                for (let index = begin; index < candidates.length; index++) {
                    const second = candidates[index]!;

                    if (ordered !== null && nearest !== null && second[axis] > nearest.end) {
                        break;
                    }

                    if (first.id === second.id || second[axis] < start || (nearest !== null && second[axis] > nearest.end)) {
                        continue;
                    }
                    const gap = gapBetween(first, second, axis);
                    if (gap && (nearest === null || gap.end < nearest.end || (gap.end === nearest.end && gap.id.localeCompare(nearest.id) < 0))) {
                        nearest = gap;
                    }
                }
                if (!nearest) {
                    continue;
                }
                const gap = nearest;
                if (siblings.length >= 32 && byId === null) {
                    byId = new Map();

                    for (const node of siblings) {
                        // Match find's first occurrence if ids are repeated.
                        if (!byId.has(node.id)) {
                            byId.set(node.id, node);
                        }
                    }
                }

                const second = (byId === null ? siblings.find((node) => node.id === gap.to) : byId.get(gap.to))!;
                const cross = axis === 'x' ? 'y' : 'x';
                const crossSize = axis === 'x' ? 'h' : 'w';
                const low = Math.max(first[cross], second[cross]);
                const high = Math.min(first[cross] + first[crossSize], second[cross] + second[crossSize]);
                let blockerStart = 0;

                if (ends !== undefined) {
                    let end = ends.length;

                    while (blockerStart < end) {
                        const middle = blockerStart + Math.floor((end - blockerStart) / 2);

                        if (ends[middle]! <= gap.start) {
                            blockerStart = middle + 1;
                        } else {
                            end = middle;
                        }
                    }
                }

                let blocked = false;

                for (let index = blockerStart; index < candidates.length; index++) {
                    const node = candidates[index]!;

                    if (ordered !== null && node[axis] >= gap.end) {
                        break;
                    }

                    if (
                        node.id !== first.id &&
                        node.id !== second.id &&
                        node[axis] < gap.end &&
                        node[axis] + node[size] > gap.start &&
                        overlapSpan(node[cross], node[crossSize], low, high - low) !== null
                    ) {
                        blocked = true;

                        break;
                    }
                }

                if (blocked) {
                    continue;
                }

                result.push({
                    ...gap,
                    shared: false,
                    minimum: gap.end - gap.start,
                    moves: [{ id: gap.to, factor: 1 }],
                    fixed: [gap.from]
                });
            }
        }
    }
    shareEqualGaps(result, nodes);
    return result;
}

export function editableGaps(nodes: readonly GapNode[], selection: readonly string[]): EditableGap[] {
    const lines = new Set<string>();

    for (const node of nodes) {
        if (node.kind === 'line') {
            lines.add(node.id);
        }
    }

    const withGrid = (gaps: EditableGap[]): EditableGap[] => {
        if (lines.size === 0) {
            return gaps;
        }

        return gaps.map((gap) =>
            lines.has(gap.from) || lines.has(gap.to) || gap.fixed.some((id) => lines.has(id)) || gap.moves.some((move) => lines.has(move.id))
                ? { ...gap, gridOnly: true }
                : gap
        );
    };

    if (selection.length === 0) {
        return withGrid(unselectedGaps(nodes));
    }
    const picked = nodes.filter((node) => selection.includes(node.id));
    if (picked.length === 0 || picked.length !== selection.length) {
        return [];
    }
    const groups = nodes.filter((node) => node.kind === 'group');
    const parent = parentGroupOf(picked[0]!, groups);
    if (picked.some((node) => parentGroupOf(node, groups) !== parent)) {
        return [];
    }
    const siblings = nodes.filter((node) => parentGroupOf(node, groups) === parent);
    const result: EditableGap[] = [];
    for (const axis of ['x', 'y'] as const) {
        if (picked.length === 1) {
            const active = picked[0]!;
            for (const direction of [-1, 1]) {
                let gap: ReturnType<typeof gapBetween> = null;

                for (const other of siblings) {
                    if (other.id === active.id) {
                        continue;
                    }

                    const candidate = direction > 0 ? gapBetween(active, other, axis) : gapBetween(other, active, axis);

                    if (
                        candidate !== null &&
                        (gap === null || (candidate.end - candidate.start - (gap.end - gap.start) || candidate.id.localeCompare(gap.id)) < 0)
                    ) {
                        gap = candidate;
                    }
                }

                if (gap) {
                    result.push({
                        ...gap,
                        shared: false,
                        minimum: gap.end - gap.start,
                        moves: [{ id: active.id, factor: -direction }],
                        fixed: [gap.from === active.id ? gap.to : gap.from]
                    });
                }
            }
            continue;
        }
        const cross = axis === 'x' ? 'y' : 'x';
        const crossSize = axis === 'x' ? 'h' : 'w';
        const crossLow = Math.max(...picked.map((node) => node[cross]));
        const crossHigh = Math.min(...picked.map((node) => node[cross] + node[crossSize]));
        if (crossHigh < crossLow || (crossHigh === crossLow && !picked.some((node) => node[crossSize] === 0))) {
            continue;
        }
        const ordered = [...picked].sort((first, second) => first[axis] - second[axis] || first.id.localeCompare(second.id));
        const gaps = ordered.slice(1).map((node, index) => gapBetween(ordered[index]!, node, axis));
        if (gaps.some((gap) => gap === null)) {
            continue;
        }
        const measured = gaps.map((gap) => gap!.end - gap!.start);
        const size = axis === 'x' ? 'w' : 'h';
        if (
            siblings.some(
                (node) =>
                    !selection.includes(node.id) &&
                    overlapSpan(node[cross], node[crossSize], crossLow, crossHigh - crossLow) !== null &&
                    gaps.some((gap) => node[axis] < gap!.end && node[axis] + node[size] > gap!.start)
            )
        ) {
            continue;
        }
        const shared = gaps.length > 1 && measured.every((value) => Math.round(value) === Math.round(measured[0]!));
        for (const [index, gap] of gaps.entries()) {
            if (!gap) {
                continue;
            }
            result.push({
                ...gap,
                shared,
                minimum: shared ? Math.min(...measured) : measured[index]!,
                fixed: [shared ? ordered[0]!.id : gap.from],
                moves: shared
                    ? ordered.slice(1).map((node, offset) => ({ id: node.id, factor: offset + 1 }))
                    : ordered.slice(index + 1).map((node) => ({ id: node.id, factor: 1 }))
            });
        }
    }
    return withGrid(result);
}

export function gapOffsets(gap: EditableGap, pointerDelta: number, precise: boolean): Record<string, Point> {
    const sign = gap.moves[0]?.factor === -1 ? -1 : 1;
    const original = gap.end - gap.start;
    const wanted = original + pointerDelta * sign;
    const target = gap.gridOnly ? snapToGrid(wanted, LINE_GRID) : precise ? Math.round(wanted) : snapToGrid(wanted);
    const delta = Math.max(-gap.minimum, target - original);
    return Object.fromEntries(gap.moves.map(({ id, factor }) => [id, { x: gap.axis === 'x' ? delta * factor : 0, y: gap.axis === 'y' ? delta * factor : 0 }]));
}

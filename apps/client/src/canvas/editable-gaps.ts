import { snapToGrid, type Point, type Rect } from '@/canvas/math';

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
}

function containsCenter(group: GapNode, node: GapNode): boolean {
    const x = node.x + node.w / 2;
    const y = node.y + node.h / 2;
    return x >= group.x && x <= group.x + group.w && y >= group.y && y <= group.y + group.h;
}

export function parentGroupOf(node: GapNode, nodes: readonly GapNode[]): string | null {
    return (
        nodes
            .filter(
                (group) =>
                    group.kind === 'group' && group.id !== node.id && !group.collapsed && group.w * group.h > node.w * node.h && containsCenter(group, node)
            )
            .sort((first, second) => first.w * first.h - second.w * second.h || first.id.localeCompare(second.id))[0]?.id ?? null
    );
}

function gapBetween(first: GapNode, second: GapNode, axis: 'x' | 'y'): Omit<EditableGap, 'shared' | 'moves' | 'minimum' | 'fixed'> | null {
    const size = axis === 'x' ? 'w' : 'h';
    const cross = axis === 'x' ? 'y' : 'x';
    const crossSize = axis === 'x' ? 'h' : 'w';
    const low = Math.max(first[cross], second[cross]);
    const high = Math.min(first[cross] + first[crossSize], second[cross] + second[crossSize]);
    const start = first[axis] + first[size];
    const end = second[axis];
    if (high <= low || end < start) {
        return null;
    }
    return { id: `${axis}:${first.id}:${second.id}`, from: first.id, to: second.id, axis, start, end, position: (low + high) / 2 };
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
                const nextLow = Math.max(low, node[cross]);
                const nextHigh = Math.min(high, node[cross] + node[crossSize]);
                if (nextHigh <= nextLow) {
                    break;
                }
                low = nextLow;
                high = nextHigh;
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
    for (const node of nodes) {
        const parent = parentGroupOf(node, nodes);
        const siblings = levels.get(parent) ?? [];
        siblings.push(node);
        levels.set(parent, siblings);
    }
    const result: EditableGap[] = [];
    for (const siblings of levels.values()) {
        for (const axis of ['x', 'y'] as const) {
            for (const first of siblings) {
                let nearest: ReturnType<typeof gapBetween> = null;
                for (const second of siblings) {
                    if (first.id === second.id) {
                        continue;
                    }
                    const gap = gapBetween(first, second, axis);
                    if (gap && (nearest === null || gap.end < nearest.end || (gap.end === nearest.end && gap.id.localeCompare(nearest.id) < 0))) {
                        nearest = gap;
                    }
                }
                const gap = nearest;
                if (gap) {
                    const second = siblings.find((node) => node.id === gap.to)!;
                    const size = axis === 'x' ? 'w' : 'h';
                    const cross = axis === 'x' ? 'y' : 'x';
                    const crossSize = axis === 'x' ? 'h' : 'w';
                    const low = Math.max(first[cross], second[cross]);
                    const high = Math.min(first[cross] + first[crossSize], second[cross] + second[crossSize]);
                    if (
                        siblings.some(
                            (node) =>
                                node.id !== first.id &&
                                node.id !== second.id &&
                                node[axis] < gap.end &&
                                node[axis] + node[size] > gap.start &&
                                node[cross] < high &&
                                node[cross] + node[crossSize] > low
                        )
                    ) {
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
    }
    shareEqualGaps(result, nodes);
    return result;
}

export function editableGaps(nodes: readonly GapNode[], selection: readonly string[]): EditableGap[] {
    if (selection.length === 0) {
        return unselectedGaps(nodes);
    }
    const picked = nodes.filter((node) => selection.includes(node.id));
    if (picked.length === 0 || picked.length !== selection.length) {
        return [];
    }
    const parent = parentGroupOf(picked[0]!, nodes);
    if (picked.some((node) => parentGroupOf(node, nodes) !== parent)) {
        return [];
    }
    const siblings = nodes.filter((node) => parentGroupOf(node, nodes) === parent);
    const result: EditableGap[] = [];
    for (const axis of ['x', 'y'] as const) {
        if (picked.length === 1) {
            const active = picked[0]!;
            for (const direction of [-1, 1]) {
                const neighbors = siblings
                    .flatMap((other) => {
                        if (other.id === active.id) {
                            return [];
                        }
                        const gap = direction > 0 ? gapBetween(active, other, axis) : gapBetween(other, active, axis);
                        return gap === null ? [] : [gap];
                    })
                    .sort((first, second) => first.end - first.start - (second.end - second.start) || first.id.localeCompare(second.id));
                const gap = neighbors[0];
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
        if (Math.min(...picked.map((node) => node[cross] + node[crossSize])) <= Math.max(...picked.map((node) => node[cross]))) {
            continue;
        }
        const ordered = [...picked].sort((first, second) => first[axis] - second[axis] || first.id.localeCompare(second.id));
        const gaps = ordered.slice(1).map((node, index) => gapBetween(ordered[index]!, node, axis));
        if (gaps.some((gap) => gap === null)) {
            continue;
        }
        const measured = gaps.map((gap) => gap!.end - gap!.start);
        const crossLow = Math.max(...picked.map((node) => node[cross]));
        const crossHigh = Math.min(...picked.map((node) => node[cross] + node[crossSize]));
        const size = axis === 'x' ? 'w' : 'h';
        if (
            siblings.some(
                (node) =>
                    !selection.includes(node.id) &&
                    node[cross] < crossHigh &&
                    node[cross] + node[crossSize] > crossLow &&
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
    return result;
}

export function gapOffsets(gap: EditableGap, pointerDelta: number, precise: boolean): Record<string, Point> {
    const sign = gap.moves[0]?.factor === -1 ? -1 : 1;
    const original = gap.end - gap.start;
    const wanted = original + pointerDelta * sign;
    const target = precise ? Math.round(wanted) : snapToGrid(wanted);
    const delta = Math.max(-gap.minimum, target - original);
    return Object.fromEntries(gap.moves.map(({ id, factor }) => [id, { x: gap.axis === 'x' ? delta * factor : 0, y: gap.axis === 'y' ? delta * factor : 0 }]));
}

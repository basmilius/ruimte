import type { Camera, Point, Rect } from '@/canvas/math';

export type NodeDirection = 'left' | 'right' | 'up' | 'down';
export interface NavigationNode extends Rect {
    id: string;
}

function center(rect: Rect): Point {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function neighboringNode(nodes: readonly NavigationNode[], from: string | null, direction: NodeDirection, viewportCenter: Point): string | null {
    const origin = nodes.find((node) => node.id === from);
    if (!origin) {
        return (
            [...nodes].sort((first, second) => {
                const a = center(first);
                const b = center(second);
                return (
                    Math.hypot(a.x - viewportCenter.x, a.y - viewportCenter.y) - Math.hypot(b.x - viewportCenter.x, b.y - viewportCenter.y) ||
                    first.id.localeCompare(second.id)
                );
            })[0]?.id ?? null
        );
    }
    const horizontal = direction === 'left' || direction === 'right';
    const axis = horizontal ? 'x' : 'y';
    const cross = horizontal ? 'y' : 'x';
    const crossSize = horizontal ? 'h' : 'w';
    const sign = direction === 'left' || direction === 'up' ? -1 : 1;
    const start = center(origin);
    const candidates = nodes.flatMap((node) => {
        if (node.id === origin.id) {
            return [];
        }
        const target = center(node);
        const forward = (target[axis] - start[axis]) * sign;
        if (forward <= 0) {
            return [];
        }
        const overlap = Math.min(node[cross] + node[crossSize], origin[cross] + origin[crossSize]) - Math.max(node[cross], origin[cross]);
        return [
            {
                id: node.id,
                band: overlap > 0 ? 0 : 1,
                distance: Math.hypot(target.x - start.x, target.y - start.y),
                deviation: Math.abs(target[cross] - start[cross]) / forward
            }
        ];
    });
    candidates.sort(
        (first, second) =>
            first.band - second.band || first.distance - second.distance || first.deviation - second.deviation || first.id.localeCompare(second.id)
    );
    return candidates[0]?.id ?? null;
}

export function cameraToReveal(rect: Rect, camera: Camera, viewport: { w: number; h: number }, margin = 24): Camera {
    const next = { ...camera };
    for (const axis of ['x', 'y'] as const) {
        const size = axis === 'x' ? 'w' : 'h';
        const extent = rect[size] * camera.zoom;
        const start = rect[axis] * camera.zoom + camera[axis];
        const padding = Math.min(margin, viewport[size] / 4);
        if (extent + padding * 2 > viewport[size]) {
            next[axis] = (viewport[size] - extent) / 2 - rect[axis] * camera.zoom;
        } else if (start < padding) {
            next[axis] += padding - start;
        } else if (start + extent > viewport[size] - padding) {
            next[axis] -= start + extent - viewport[size] + padding;
        }
    }
    return next;
}

export const HANDLE_HIT_SIZE = 24;

// Overlapping targets on a small selection choose the closest visible handle.
export function nearestHandle<T extends string>(point: { x: number; y: number }, handles: readonly { kind: T; x: number; y: number }[]): T | null {
    let nearest: T | null = null;
    let distance = Infinity;
    for (const handle of handles) {
        const dx = point.x - handle.x;
        const dy = point.y - handle.y;
        const next = dx * dx + dy * dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) <= HANDLE_HIT_SIZE / 2 && next < distance) {
            nearest = handle.kind;
            distance = next;
        }
    }
    return nearest;
}

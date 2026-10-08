import { rectFromPoints } from '@adecore/drawing';
import { toWorld, type Camera, type Point, type Rect } from '@/canvas/math';

export interface BoxSelection {
    origin: Point;
    current: Point;
    previous: string[];
    additive: boolean;
}

export function startBoxSelection(camera: Camera, point: Point, previous: string[], additive: boolean): BoxSelection {
    return { origin: toWorld(camera, point), current: point, previous: [...previous], additive };
}

export function boxWorldRect(box: BoxSelection, camera: Camera): Rect {
    return rectFromPoints(box.origin, toWorld(camera, box.current));
}

export function boxScreenRect(box: BoxSelection, camera: Camera): Rect {
    return rectFromPoints({ x: box.origin.x * camera.zoom + camera.x, y: box.origin.y * camera.zoom + camera.y }, box.current);
}

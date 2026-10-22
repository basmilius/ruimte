import { unionOf, type Camera, type Point, type Rect } from '@/canvas/math';
import type { Viewport } from '@/canvas/camera-slice';
import type { CanvasNode } from '@/state/canvas-model';

/* The map itself, in screen pixels inside its card. */
export const MINIMAP_SIZE: Readonly<Viewport> = { w: 192, h: 128 };

// What the card adds around the map: a 4px padding and a 1px border on each side.
const CARD_EDGE = 5;
// The card stands this far from the cell's right and bottom edge, as the dock does from the bottom.
const CORNER_GAP = 16;
// The prompt stack (`max-w-xl`) is the widest thing the bottom center of a cell holds; the dock is narrower.
const BOTTOM_CENTER_WIDTH = 576;
// A rect at the edge of the map keeps its outline.
const MAP_INSET = 8;

const CARD_W = MINIMAP_SIZE.w + CARD_EDGE * 2;
const CARD_H = MINIMAP_SIZE.h + CARD_EDGE * 2;

/* Where the world lands on the map: a point on the map is the world point times `scale`, plus `x` and `y`. */
export interface MinimapScale {
    scale: number;
    x: number;
    y: number;
}

/*
 * Whether a cell of this size has a corner for the map: beside the prompt stack and the dock, which
 * share its bottom center, and in no more than a third of its height.
 */
export function minimapFits(viewport: Viewport): boolean {
    return viewport.w >= BOTTOM_CENTER_WIDTH + (CORNER_GAP + CARD_W + CORNER_GAP / 2) * 2 && viewport.h >= CARD_H * 3;
}

/* What the map draws, groups first so a frame lies under the nodes in it. A collapsed group's members are not drawn on the canvas either. */
export function mappedNodes(nodes: Readonly<Record<string, CanvasNode>>, hidden: ReadonlySet<string>): CanvasNode[] {
    const shown = Object.values(nodes).filter((node) => !hidden.has(node.id));
    return [...shown.filter((node) => node.kind === 'group'), ...shown.filter((node) => node.kind !== 'group')];
}

/* The nodes that carry a dot for what waits: a node the map draws carries its own, a member of a collapsed group the group it is shown as. */
export function waitingOnMap(nodes: Readonly<Record<string, CanvasNode>>, hidden: ReadonlySet<string>, waiting: Iterable<string>): CanvasNode[] {
    const heldBy = new Map<string, string>();
    for (const node of Object.values(nodes)) {
        if (node.kind === 'group' && node.collapsed) {
            for (const id of node.memberIds ?? []) {
                heldBy.set(id, node.id);
            }
        }
    }
    const marked = new Map<string, CanvasNode>();
    for (const id of waiting) {
        let shown: string | undefined = id;
        // A group collapsed inside another collapsed group is hidden in turn; the bound stops a cycle a hand-edited file could hold.
        for (let i = 0; shown !== undefined && hidden.has(shown) && i < heldBy.size; i++) {
            shown = heldBy.get(shown);
        }
        const node = shown === undefined || hidden.has(shown) ? undefined : nodes[shown];
        if (node !== undefined) {
            marked.set(node.id, node);
        }
    }
    return [...marked.values()];
}

/* The part of the world the map shows: every node and the view, so the frame never leaves the map. */
export function minimapWorld(nodes: Rect | null, visible: Rect): Rect {
    return nodes === null ? visible : unionOf([nodes, visible])!;
}

export function minimapScale(world: Rect, size: Viewport = MINIMAP_SIZE): MinimapScale {
    const scale = Math.min((size.w - MAP_INSET * 2) / Math.max(world.w, 1), (size.h - MAP_INSET * 2) / Math.max(world.h, 1));
    return {
        scale,
        x: (size.w - world.w * scale) / 2 - world.x * scale,
        y: (size.h - world.h * scale) / 2 - world.y * scale
    };
}

export function rectOnMap(map: MinimapScale, rect: Rect): Rect {
    return { x: rect.x * map.scale + map.x, y: rect.y * map.scale + map.y, w: rect.w * map.scale, h: rect.h * map.scale };
}

export function worldOnMap(map: MinimapScale, point: Point): Point {
    return { x: (point.x - map.x) / map.scale, y: (point.y - map.y) / map.scale };
}

/* The camera that looks at a world point from the middle of the viewport, at the zoom it had. */
export function cameraLookingAt(camera: Camera, viewport: Viewport, world: Point): Camera {
    return { zoom: camera.zoom, x: viewport.w / 2 - world.x * camera.zoom, y: viewport.h / 2 - world.y * camera.zoom };
}

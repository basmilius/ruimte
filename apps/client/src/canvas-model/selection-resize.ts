import type { Rect } from '@/canvas-model/math';

type Axis = 'x' | 'y';
type Size = Pick<Rect, 'w' | 'h'>;

const SIDE: Record<Axis, 'w' | 'h'> = { x: 'w', y: 'h' };

/*
 * How far each frame shifts along one axis so the room to the frame before it stays what it was. A
 * frame follows its nearest neighbors: the ones that stood wholly before it on this axis and beside it
 * on the other, with no other frame between them. It takes the largest of what each shifted and grew,
 * also when they shrink, so it closes up only as far as the neighbor that keeps it furthest lets it.
 */
function shiftsAlong(axis: Axis, before: Readonly<Record<string, Rect>>, sizes: Readonly<Record<string, Size>>): Record<string, number> {
    const other: Axis = axis === 'x' ? 'y' : 'x';
    const side = SIDE[axis];
    const across = SIDE[other];
    const ahead = (first: Rect, second: Rect): boolean => first[axis] + first[side] <= second[axis];
    const beside = (first: Rect, second: Rect): boolean => first[other] < second[other] + second[across] && second[other] < first[other] + first[across];
    const frames = Object.entries(before)
        .map(([id, rect]) => ({ id, rect, grows: (sizes[id]?.[side] ?? rect[side]) - rect[side] }))
        .sort((first, second) => first.rect[axis] - second.rect[axis]);
    // A frame that stood before another one comes first, so what it passes on is known by then.
    const placed: { rect: Rect; passes: number }[] = [];
    const shifts: Record<string, number> = {};

    for (const frame of frames) {
        const behind = placed.filter((entry) => ahead(entry.rect, frame.rect) && beside(entry.rect, frame.rect));
        const nearest = behind.filter((entry) => !behind.some((between) => ahead(entry.rect, between.rect) && beside(entry.rect, between.rect)));
        const shift = nearest.length === 0 ? 0 : Math.max(...nearest.map((entry) => entry.passes));

        shifts[frame.id] = shift;
        placed.push({ rect: frame.rect, passes: shift + frame.grows });
    }

    return shifts;
}

/*
 * The frames of a selection once each took the size `sizes` gives it, as they stood in `before`. The
 * room between two of them stays what it was, and all of them move together so the dragged frame lands
 * on `dragged`, which keeps its fixed edge under the hand.
 */
export function resizedSelection(
    before: Readonly<Record<string, Rect>>,
    sizes: Readonly<Record<string, Size>>,
    draggedId: string,
    dragged: Rect
): Record<string, Rect> {
    const start = before[draggedId];

    if (start === undefined) {
        return {};
    }

    const right = shiftsAlong('x', before, sizes);
    const down = shiftsAlong('y', before, sizes);
    const offset = { x: dragged.x - start.x - (right[draggedId] ?? 0), y: dragged.y - start.y - (down[draggedId] ?? 0) };

    return Object.fromEntries(
        Object.entries(before).map(([id, rect]) => [
            id,
            {
                x: rect.x + (right[id] ?? 0) + offset.x,
                y: rect.y + (down[id] ?? 0) + offset.y,
                w: sizes[id]?.w ?? rect.w,
                h: sizes[id]?.h ?? rect.h
            }
        ])
    );
}

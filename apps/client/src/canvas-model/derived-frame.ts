import type { Rect } from '@/canvas-model/math';

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/*
 * How a card drawn beside a node (`canvas/DerivedSet.tsx`) resizes from the handles a node has. A
 * resize goes to `apply`, never to the canvas's nodes, so it is never stored in the project and
 * leaves no undo step.
 */
export interface CardResize {
    /* The edges its layout leaves free: a card placed by its top-left corner offers only e, s and se. */
    edges: readonly ResizeEdge[];
    minimum: { w: number; h: number };
    /* Each new rect of a resize, on the grid and at least `minimum`. */
    apply(rect: Rect): void;
}

/*
 * A card drawn beside a node as the canvas knows it, by an id no node has (`DerivedSet.tsx`): where it
 * stands, for the resize handles and for moving between nodes with the keys, and never stored.
 */
export interface DerivedFrame {
    owner: string;
    rect: Rect;
    resize: CardResize | null;
}

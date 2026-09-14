/*
 * The graph the layout works on once every edge that skips a layer has a point per layer it passes
 * through. Internal to the package: the coordinates it ends in are what `layoutOf` hands out.
 */

/* A box or a point a long edge passes through, in the frame of a diagram that runs to the right. */
export interface Unit {
    layer: number;
    /* The index of the node in the file, or -1 for a point a long edge passes through. */
    node: number;
    /* The band of the group that holds it, or -1. */
    band: number;
    w: number;
    h: number;
    /* Room kept free across the flow on either side, so a neighbor stays this far off. */
    margin: number;
    /* For a point a long edge passes through, the index of that edge's line among `Layering.lines`; -1 for a box. */
    line: number;
    /* Units in the layer before and after that a hop joins this one to. */
    up: number[];
    down: number[];
}

/* One stretch of an edge, from a unit in one layer to a unit in the next. */
export interface Hop {
    edge: number;
    from: number;
    to: number;
}

/* A group seen across the flow: one block per layer it spans, at the same place in every one of them. */
export interface Band {
    /* The index of the group in the file. */
    group: number;
    first: number;
    last: number;
    /* The units inside, per layer from `first`, in order. */
    members: number[][];
    top: number;
    height: number;
    /* Room inside the border before the first member and after the last, across the flow. */
    before: number;
    after: number;
    /* Where the band stands among the others; the same in every layer, so no two bands swap places. */
    rank: number;
    labelWidth: number;
}

export interface Layering {
    units: Unit[];
    hops: Hop[];
    bands: Band[];
    /* The points of every long edge, first to last. */
    lines: number[][];
    /* Per layer the top-level entries in order: a unit, or `bandCode(band)` for the block of a group. */
    items: number[][];
}

export const bandCode = (band: number): number => -(band + 1);

export const bandOfCode = (code: number): number => -code - 1;

export const NODE_MARGIN = 16;
export const DUMMY_MARGIN = 8;
/* A node beside a group is this plus its own margin away from the border. */
export const BAND_MARGIN = 16;

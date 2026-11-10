import type { NodeSide } from '@ruimte/contracts';

/* The sides a line is held to, because a person drew it from that port. An end left out is free. */
export interface FixedSides {
    fromSide?: NodeSide;
    toSide?: NodeSide;
}

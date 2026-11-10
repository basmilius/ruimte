/*
 * The measures every set of cards beside a node shares (`DerivedSet`), so a routine's runs and a
 * chat's workflow stand at the same distance from their node and stack the same way.
 */

/* Between a node and the first column beside it, and between two columns. */
export const GUTTER = 72;
export const COLUMN_W = 440;
/* An open card grows with what it shows up to this, and scrolls inside past it. */
export const OPEN_H = 480;
/* Its header and a line of what it shows, while that is not measured yet or shorter. */
export const OPEN_MIN_H = 120;
/* A card that is only its header. */
export const LINE_H = 40;
export const STACK_GAP = 8;

import type { CSSProperties } from 'react';
import { accentShades } from '@/canvas/accents';

/* What every card beside a node draws in (`DerivedSet`): a node's frame and header, at the node's sizes. */
export const FRAME = 'flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-clip-padding shadow-node';
export const HEADER = 'flex h-[39px] shrink-0 items-center gap-2 border-b border-border bg-surface-raised pr-1 pl-3 text-sm text-text';

/* Where a line meets a card, and the node: the middle of a 39px header, which a collapsed card of 40 is all of. */
export const HEADER_MIDDLE = 20;
/* An open card's 39px header and the 1px border above and below it. */
export const CHROME_H = 41;

/* The style of a card's frame beside a colored node, the way that node's own frame wears it. */
export function frameStyle(accent: string | undefined): CSSProperties | undefined {
    return accent === undefined ? undefined : { borderColor: accentShades(accent).frameBorder };
}

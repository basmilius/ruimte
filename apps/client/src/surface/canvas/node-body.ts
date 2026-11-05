import { isNodeActive, type CanvasState } from '@/state/canvas';

export function derivedCardId(owner: string, key: string): string {
    return `derived:${owner}:${key}`;
}

/* Whether a card's content has the keyboard and the wheel: its owner's content does, and the card is where the keys stand. */
export function cardHolds(s: Pick<CanvasState, 'bodyFocusId' | 'navigationId' | 'derivedCards'>, cardId: string): boolean {
    const card = s.derivedCards[cardId];
    return card !== undefined && s.navigationId === cardId && isNodeActive(s.bodyFocusId, card.owner);
}

/* The id of the card beside a node a press or a key landed in, or null outside every card. */
export function derivedCardOf(el: EventTarget | null): string | null {
    return el instanceof HTMLElement ? (el.closest<HTMLElement>('[data-derived-card]')?.dataset.derivedCard ?? null) : null;
}

/* Tells a key or a press meant for a node's content (`data-node-body`) from one meant for the canvas around it. */
export function isInNodeBody(el: EventTarget | null): boolean {
    return el instanceof HTMLElement && el.closest('[data-node-body]') !== null;
}

/*
 * The node a card beside it belongs to (`data-derived-of`, `canvas/DerivedCards.tsx`). Such a card is
 * drawn from that node's data and is no node itself: a press in it hands that node the keyboard and
 * the wheel, and nothing selects, moves or links it.
 */
export function derivedOwnerOf(el: EventTarget | null): string | null {
    return el instanceof HTMLElement ? (el.closest<HTMLElement>('[data-derived-of]')?.dataset.derivedOf ?? null) : null;
}

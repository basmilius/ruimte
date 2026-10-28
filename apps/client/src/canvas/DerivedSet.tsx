import clsx from 'clsx';
import { useEffect, useRef, type ReactNode } from 'react';
import { QUIET_EDGE_LINE } from '@/canvas/accents';
import { routeEdge, type Obstacle } from '@/canvas/edge-route';
import { intersects, isMeasured, visibleRect, type Rect } from '@/canvas/math';
import type { CardResize } from '@/canvas/resize-handles';
import { cardHolds, derivedCardId } from '@/canvas/node-body';
import { useCanvas, type CanvasState } from '@/state/canvas';

export interface DerivedCard {
    key: string;
    rect: Rect;
    /* Where its line comes from: the node itself, the key of another card, or nothing for a card without one. */
    linkedFrom: 'node' | string | null;
    label: string;
    content: ReactNode;
    /* How far down its side its lines meet it, in world units from its top; the middle when absent. */
    lineDown?: number;
    /* Offered to the canvas's resize handles; a card without one keeps the size its layout gives it. */
    resize?: CardResize;
}

/*
 * The cards a node has drawn beside it from its own data (`DerivedCards`), and the lines from it or
 * from one card to another, which belong to the canvas as every line does. They route around the nodes and the other
 * cards, in the layer under the nodes, and only the cards are stacked with their node. A line here is
 * a plain stroke with nothing at either end, by Bas's choice: it carries nothing and points at
 * nothing, so it wears none of the looks in `edge-look.ts`. Neutral, unless the owner gives a `stroke`.
 */
export function DerivedSet({
    owner,
    z,
    cards,
    lineDown,
    stroke = QUIET_EDGE_LINE
}: {
    owner: string;
    z: number;
    cards: readonly DerivedCard[];
    lineDown?: number;
    stroke?: string;
}) {
    const node = useCanvas((s) => s.nodes[owner]);
    const nodes = useCanvas((s) => s.nodes);
    const hidden = useCanvas((s) => s.hidden);
    const leaveDerivedCard = useCanvas((s) => s.leaveDerivedCard);
    // By key, not by the cards: a card's own effect also lets go of it on every move or resize, which is not leaving.
    const keys = cards.map((card) => card.key).join('\n');
    const shownKeys = useRef<readonly string[]>([]);
    useEffect(() => {
        const now = keys === '' ? [] : keys.split('\n');
        const gone = shownKeys.current.filter((key) => !now.includes(key));
        shownKeys.current = now;
        // The keys go on from the first card that stays, or else the node the cards are drawn beside.
        const next = now[0] === undefined ? owner : derivedCardId(owner, now[0]);
        for (const key of gone) {
            leaveDerivedCard(derivedCardId(owner, key), next);
        }
    }, [keys, owner, leaveDerivedCard]);
    useEffect(
        () => () => {
            for (const key of shownKeys.current) {
                leaveDerivedCard(derivedCardId(owner, key), owner);
            }
        },
        [owner, leaveDerivedCard]
    );
    if (node === undefined) {
        return null;
    }
    const blocking: Obstacle[] = [
        ...Object.values(nodes)
            .filter((other) => other.id !== owner && other.kind !== 'group' && !hidden.has(other.id))
            .map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
        ...cards.map((card) => ({ id: card.key, ...card.rect }))
    ];
    const endOf = (from: string | null): { rect: Rect; down: number | undefined } | null => {
        if (from === 'node') {
            return { rect: node, down: lineDown };
        }
        const card = cards.find((candidate) => candidate.key === from);
        return card === undefined ? null : { rect: card.rect, down: card.lineDown };
    };
    const routes = cards.flatMap((card) => {
        const from = endOf(card.linkedFrom);
        if (from === null) {
            return [];
        }
        // Held to the right side, so the lines leave as one and fan out to the column beside.
        const route = routeEdge(
            from.rect,
            card.rect,
            blocking.filter((obstacle) => obstacle.id !== card.key && obstacle.id !== card.linkedFrom),
            { fromSide: 'right', toSide: 'left', fromDown: from.down, toDown: card.lineDown }
        );
        return [{ key: card.key, route }];
    });
    return (
        <>
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
                {routes.map(({ key, route }) => (
                    <path key={key} d={route.d} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                ))}
            </svg>
            {cards.map((card) => (
                <Card key={card.key} owner={owner} z={z} card={card} />
            ))}
        </>
    );
}

/* A card further than a viewport past every edge is left out, the way the canvas leaves out a far node (`farNodeKey`). */
function nearView(s: CanvasState, rect: Rect): boolean {
    return !isMeasured(s.viewport) || intersects(rect, visibleRect(s.camera, s.viewport, Math.max(s.viewport.w, s.viewport.h)));
}

function Card({ owner, z, card }: { owner: string; z: number; card: DerivedCard }) {
    const { x, y, w, h } = card.rect;
    const near = useCanvas((s) => nearView(s, { x, y, w, h }));
    const setDerivedCard = useCanvas((s) => s.setDerivedCard);
    const { resize } = card;
    // An id no node has, so a press on its handle or a step of the keys can never be read as one on a node.
    const cardId = derivedCardId(owner, card.key);
    // Its content has the keyboard and the wheel, after a press in it or Enter on it.
    const holds = useCanvas((s) => cardHolds(s, cardId));
    // Where the keys stand, or have the content: drawn the way a selected node is.
    const marked = useCanvas((s) => s.navigationId === cardId && (s.bodyFocusId === null || s.bodyFocusId === owner));
    const sectionRef = useRef<HTMLElement>(null);
    useEffect(() => {
        setDerivedCard(cardId, { owner, rect: { x, y, w, h }, resize: resize ?? null });
        return () => setDerivedCard(cardId, null);
    }, [cardId, h, owner, resize, setDerivedCard, w, x, y]);
    useEffect(() => {
        const section = sectionRef.current;
        // Enter on a card hands it the keyboard as a press would; a press already put it inside.
        if (holds && section !== null && !section.contains(document.activeElement)) {
            section.focus({ preventScroll: true });
        }
    }, [holds]);
    if (!near) {
        return null;
    }
    return (
        <section
            ref={sectionRef}
            data-derived-of={owner}
            data-derived-card={cardId}
            data-node-body
            aria-label={card.label}
            tabIndex={-1}
            // The canvas hands the wheel over a card to the card only while it holds the focus
            // (`useWheelCamera`), and a frame's page would take it before the canvas ever sees it.
            className={clsx(
                'absolute flex flex-col rounded-xl',
                marked ? 'node-selected' : 'focus-visible:outline-none',
                !holds && '[&_iframe]:pointer-events-none'
            )}
            style={{ left: x, top: y, width: w, height: h, zIndex: z }}
            // A card has no menu of its own, and the canvas's would offer to add a node under it.
            onContextMenu={(e) => e.stopPropagation()}
        >
            {card.content}
        </section>
    );
}

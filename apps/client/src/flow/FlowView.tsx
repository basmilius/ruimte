import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FlowPort } from '@ruimte/contracts';
import { GRID, snapToGrid, toWorld, type Point } from '@/canvas/math';
import { useWheelCamera } from '@/canvas/use-wheel-camera';
import { FlowCardBox } from '@/flow/FlowCardBox';
import { FlowDock } from '@/flow/FlowDock';
import { FlowInspector } from '@/flow/FlowInspector';
import { FlowLinkLayer, type FlowDraft } from '@/flow/FlowLinkLayer';
import { cardRect } from '@/flow/geometry';
import { useFlow, useFlowStore } from '@/state/flow';
import { isInFloatingLayer } from '@/ui/floating';

/* Screen pixels a press on a card may travel before it is a drag rather than a click. */
const DRAG_THRESHOLD = 3;

const isChrome = (target: EventTarget | null): boolean =>
    isInFloatingLayer(target) || (target instanceof Element && target.closest('[data-flow-chrome]') !== null);

const cardIdAt = (target: EventTarget | null): string | null =>
    target instanceof Element ? (target.closest('[data-flow-card]')?.getAttribute('data-flow-card') ?? null) : null;

const portAt = (target: EventTarget | null): { from: string; fromPort: FlowPort } | null => {
    if (!(target instanceof Element)) {
        return null;
    }
    const dot = target.closest('[data-flow-port]');
    const from = dot?.getAttribute('data-flow-port');
    const fromPort = dot?.getAttribute('data-flow-port-side');
    return from && fromPort ? { from, fromPort: fromPort as FlowPort } : null;
};

interface CardDrag {
    id: string;
    from: Point;
    origin: Point;
    moved: boolean;
}

/*
 * A flow on screen: cards in the DOM and the lines between them in the layer under them, the way a
 * canvas draws its nodes and its connectors. A person adds a card, drags it where it belongs, pulls
 * a line out of a port onto the next card, fills the fields in beside it and turns the flow on.
 */
export function FlowView({ id }: { id: string }) {
    const { t } = useTranslation('flow');
    /* The editor of this cell, never the focused one: two flows can stand side by side. */
    const store = useFlowStore();
    const rootRef = useRef<HTMLDivElement>(null);
    const panFrom = useRef<Point | null>(null);
    const drag = useRef<CardDrag | null>(null);
    const [gesture, setGesture] = useState<'pan' | 'drag' | 'link' | null>(null);
    const [pointer, setPointer] = useState<Point | null>(null);
    const [draft, setDraft] = useState<FlowDraft | null>(null);
    const [hovered, setHovered] = useState<string | null>(null);
    const camera = useFlow((s) => s.camera);
    const content = useFlow((s) => s.content);
    const selection = useFlow((s) => s.selection);
    const viewId = useFlow((s) => s.viewId);

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const observer = new ResizeObserver(([entry]) => {
            store.getState().setViewport({ w: entry!.contentRect.width, h: entry!.contentRect.height });
        });
        observer.observe(root);
        return () => observer.disconnect();
    }, [store]);

    useWheelCamera(rootRef, store);

    const worldOf = (e: React.PointerEvent<HTMLDivElement>): Point => {
        const box = e.currentTarget.getBoundingClientRect();
        return toWorld(store.getState().camera, { x: e.clientX - box.left, y: e.clientY - box.top });
    };

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
        if ((e.button !== 0 && e.button !== 1) || !e.currentTarget.contains(e.target as Node) || isChrome(e.target)) {
            return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        const port = e.button === 0 ? portAt(e.target) : null;
        if (port !== null) {
            setDraft({ ...port, at: worldOf(e) });
            setGesture('link');
            return;
        }
        const cardId = e.button === 0 ? cardIdAt(e.target) : null;
        const card = cardId === null ? undefined : content.cards[cardId];
        if (cardId !== null && card !== undefined) {
            store.getState().select([cardId], e.shiftKey);
            drag.current = { id: cardId, from: { x: e.clientX, y: e.clientY }, origin: { x: card.x, y: card.y }, moved: false };
            setGesture('drag');
            return;
        }
        if (e.button === 0 && !e.shiftKey) {
            store.getState().select([]);
        }
        panFrom.current = { x: e.clientX, y: e.clientY };
        setGesture('pan');
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
        setPointer(worldOf(e));
        if (draft !== null) {
            setDraft({ ...draft, at: worldOf(e) });
            return;
        }
        const moving = drag.current;
        if (moving !== null) {
            const dx = e.clientX - moving.from.x;
            const dy = e.clientY - moving.from.y;
            if (!moving.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
                return;
            }
            const { zoom } = store.getState().camera;
            store.getState().moveCard(moving.id, { x: moving.origin.x + dx / zoom, y: moving.origin.y + dy / zoom }, !moving.moved);
            moving.moved = true;
            return;
        }
        const from = panFrom.current;
        if (from === null) {
            return;
        }
        store.getState().panBy(e.clientX - from.x, e.clientY - from.y);
        panFrom.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
        if (draft !== null) {
            /* A line lands on a card, wherever on it the pointer let go: a card has one way in. */
            const at = worldOf(e);
            const landed = Object.entries(store.getState().content.cards).find(([, card]) => {
                const rect = cardRect(card);
                return at.x >= rect.x && at.x <= rect.x + rect.w && at.y >= rect.y && at.y <= rect.y + rect.h;
            });
            if (landed !== undefined) {
                store.getState().link(draft.from, draft.fromPort, landed[0]);
            }
            setDraft(null);
        }
        const moving = drag.current;
        if (moving !== null && moving.moved) {
            // The card settles on the grid once it is let go, so a worksheet stays lined up.
            const card = store.getState().content.cards[moving.id];
            if (card !== undefined) {
                store.getState().moveCard(moving.id, { x: snapToGrid(card.x), y: snapToGrid(card.y) }, false);
            }
        }
        panFrom.current = null;
        drag.current = null;
        setGesture(null);
    };

    const gridStep = GRID * 3 * camera.zoom;
    // Nothing to say until the file has been read, or an empty worksheet would flash before a full one.
    const empty = viewId === id && Object.keys(content.cards).length === 0;

    return (
        <div
            ref={rootRef}
            className="relative h-full w-full touch-none overflow-hidden bg-canvas-bg bg-[image:radial-gradient(circle,var(--canvas-dot)_1px,transparent_1px)]"
            style={{
                backgroundSize: `${gridStep}px ${gridStep}px`,
                backgroundPosition: `${camera.x}px ${camera.y}px`,
                cursor: gesture === 'pan' ? 'grabbing' : gesture === 'drag' ? 'move' : gesture === 'link' ? 'crosshair' : 'grab'
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setPointer(null)}
        >
            {/* The lines and the ports go under the cards, which is where a connector belongs. */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
                <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
                    <FlowLinkLayer
                        content={content}
                        zoom={camera.zoom}
                        pointer={pointer}
                        draft={draft}
                        hovered={hovered}
                        onHover={setHovered}
                        onRemove={(link) => store.getState().unlink(link.from, link.fromPort, link.to)}
                    />
                </g>
            </svg>
            <div
                className="pointer-events-none absolute top-0 left-0 origin-top-left"
                style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
            >
                {Object.entries(content.cards).map(([cardId, card]) => (
                    <FlowCardBox key={cardId} id={cardId} card={card} content={content} selected={selection.includes(cardId)} />
                ))}
            </div>

            {empty && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 pb-20">
                    <p className="max-w-sm text-center text-sm text-text-muted">{t('empty.description')}</p>
                </div>
            )}

            <FlowInspector />
            <FlowDock viewId={id} />
        </div>
    );
}

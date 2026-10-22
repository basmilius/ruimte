import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Surface } from '@adecore/ui';
import { useChats } from '@adecore/agents-react/state';
import { unionOf, visibleRect, type Point } from '@/canvas/math';
import {
    cameraLookingAt,
    mappedNodes,
    MINIMAP_SIZE,
    minimapFits,
    minimapScale,
    minimapWorld,
    rectOnMap,
    waitingOnMap,
    worldOnMap,
    type MinimapScale
} from '@/canvas/minimap-geometry';
import { groupAttention } from '@/state/attention';
import { maximizedNodeOf, useCanvas, useCanvasStore, type CanvasNode, type CanvasState } from '@/state/canvas';
import { useEndpointId } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { useSettings } from '@/state/settings';
import { useSnoozes } from '@/state/snooze';

// The snoozed nodes stay out of the dots the way they stay out of every count; nothing is unseen here.
const NO_UNSEEN: Readonly<Record<string, true>> = {};

interface MapDrag {
    pointerId: number;
    // Where in the frame the pointer took hold, so the frame does not jump under it.
    grab: Point;
    // The map holds still under a drag, or the frame would run away from the pointer as the world grows.
    scale: MinimapScale;
}

/* A dot on every node that waits on a person, in its own render so a status change leaves the rects alone. */
function NeedsYouDots({ nodes, hidden }: { readonly nodes: Readonly<Record<string, CanvasNode>>; readonly hidden: ReadonlySet<string> }) {
    const endpointId = useEndpointId();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.statusByKey);
    const snoozes = useSnoozes((s) => s.byKey);
    const waiting = groupAttention(Object.values(nodes), sessions, chats, endpointId, NO_UNSEEN, snoozes).needsYou;
    return waitingOnMap(nodes, hidden, waiting).map((node) => (
        /* A path of no length with a round cap draws a dot the size of its stroke, which keeps its
           screen size under the layer's scale where a circle's radius would not. */
        <path
            key={node.id}
            data-minimap-waiting={node.id}
            d={`M${node.x + node.w / 2} ${node.y + node.h / 2}h0`}
            stroke="var(--status-needs-you)"
            strokeWidth={6}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
        />
    ));
}

/*
 * A map of the whole canvas in the bottom right corner of its cell, which a person turns on in
 * Settings, Views. A click looks at that spot and a drag of the frame pans, at the zoom the view has.
 * The camera moves it by hand, the way the canvas moves its world, so a pan renders nothing here.
 */
export function Minimap() {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const on = useSettings((s) => s.canvasMinimap);
    const fits = useCanvas((s) => minimapFits(s.viewport));
    // A maximized node is all the canvas shows, and it covers the corner.
    const maximized = useCanvas((s) => maximizedNodeOf(s) !== null);
    const panLocked = useCanvas((s) => s.locks.pan);
    const nodes = useCanvas((s) => s.nodes);
    const hidden = useCanvas((s) => s.hidden);
    const layerRef = useRef<SVGGElement>(null);
    const frameRef = useRef<SVGRectElement>(null);
    const scaleRef = useRef<MinimapScale | null>(null);
    const dragRef = useRef<MapDrag | null>(null);

    const mapped = mappedNodes(nodes, hidden);
    const bounds = unionOf(mapped);
    const shown = on && fits && !maximized && bounds !== null;

    const paint = (state: CanvasState): void => {
        const visible = visibleRect(state.camera, state.viewport);
        const scale = dragRef.current?.scale ?? minimapScale(minimapWorld(bounds, visible));
        scaleRef.current = scale;
        layerRef.current?.setAttribute('transform', `translate(${scale.x} ${scale.y}) scale(${scale.scale})`);
        const frame = rectOnMap(scale, visible);
        frameRef.current?.setAttribute('x', String(frame.x));
        frameRef.current?.setAttribute('y', String(frame.y));
        frameRef.current?.setAttribute('width', String(frame.w));
        frameRef.current?.setAttribute('height', String(frame.h));
    };

    useLayoutEffect(() => {
        if (!shown) {
            return;
        }
        paint(canvasStore.getState());
        return canvasStore.subscribe((state, previous) => {
            if (state.camera !== previous.camera || state.viewport !== previous.viewport) {
                paint(state);
            }
        });
    });

    // The map can go mid-drag (the cell narrows, a node is maximized, the setting goes off), and no pointer up reaches it then.
    useEffect(() => {
        if (!shown) {
            return;
        }
        return () => {
            if (dragRef.current !== null) {
                dragRef.current = null;
                canvasStore.getState().setPanning(false);
            }
        };
    }, [shown, canvasStore]);

    if (!shown) {
        return null;
    }

    const pointOf = (event: ReactPointerEvent<SVGSVGElement>): Point => {
        const box = event.currentTarget.getBoundingClientRect();
        return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    const lookAt = (point: Point, drag: MapDrag): void => {
        const state = canvasStore.getState();
        const world = worldOnMap(drag.scale, { x: point.x - drag.grab.x, y: point.y - drag.grab.y });
        const target = cameraLookingAt(state.camera, state.viewport, world);
        // Through the pan, so the camera's history counts the jump and the drag as one move it can step back from.
        state.panBy(target.x - state.camera.x, target.y - state.camera.y);
    };

    const endDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
        const drag = dragRef.current;
        if (drag === null || drag.pointerId !== event.pointerId) {
            return;
        }
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        canvasStore.getState().setPanning(false);
        paint(canvasStore.getState());
    };

    const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
        const scale = scaleRef.current;
        if (event.button !== 0 || panLocked || scale === null || dragRef.current !== null) {
            return;
        }
        event.preventDefault();
        const point = pointOf(event);
        const state = canvasStore.getState();
        const frame = rectOnMap(scale, visibleRect(state.camera, state.viewport));
        const inFrame = point.x >= frame.x && point.x <= frame.x + frame.w && point.y >= frame.y && point.y <= frame.y + frame.h;
        const drag: MapDrag = {
            pointerId: event.pointerId,
            grab: inFrame ? { x: point.x - (frame.x + frame.w / 2), y: point.y - (frame.y + frame.h / 2) } : { x: 0, y: 0 },
            scale
        };
        dragRef.current = drag;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        state.setPanning(true);
        lookAt(point, drag);
    };

    const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
        const drag = dragRef.current;
        if (drag !== null && drag.pointerId === event.pointerId) {
            lookAt(pointOf(event), drag);
        }
    };

    return (
        <Surface
            className="pointer-events-auto absolute right-4 bottom-4 rounded-xl p-1"
            // The card stands over the canvas, which would read a press, a move or a click on it as its own.
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            <svg
                role="img"
                aria-label={t('minimap.label')}
                width={MINIMAP_SIZE.w}
                height={MINIMAP_SIZE.h}
                className={clsx('block touch-none overflow-hidden rounded-lg', !panLocked && 'cursor-pointer')}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
            >
                <g ref={layerRef}>
                    {mapped.map((node) =>
                        node.kind === 'group' ? (
                            <rect
                                key={node.id}
                                data-minimap-node={node.id}
                                x={node.x}
                                y={node.y}
                                width={node.w}
                                height={node.h}
                                rx={16}
                                fill="none"
                                stroke="var(--text-faint)"
                                strokeWidth={1}
                                vectorEffect="non-scaling-stroke"
                            />
                        ) : (
                            <rect
                                key={node.id}
                                data-minimap-node={node.id}
                                x={node.x}
                                y={node.y}
                                width={node.w}
                                height={node.h}
                                rx={16}
                                fill="var(--text-faint)"
                                fillOpacity={0.5}
                            />
                        )
                    )}
                    <NeedsYouDots nodes={nodes} hidden={hidden} />
                </g>
                <rect ref={frameRef} data-minimap-frame rx={2} fill="var(--text)" fillOpacity={0.06} stroke="var(--text-muted)" strokeWidth={1} />
            </svg>
        </Surface>
    );
}

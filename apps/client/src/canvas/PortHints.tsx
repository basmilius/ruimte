import { useEffect, useMemo, useState, type RefObject } from 'react';
import { textRect } from '@/canvas/edge-lines';
import { toWorld, type Point, type Rect } from '@/canvas/math';
import { HINT_HOT, HINT_REACH, portHints, portKey, takenPorts } from '@/canvas/port-hints';
import { PortDot } from '@/canvas/PortDot';
import { useCanvas, useCanvasStore } from '@/state/canvas';

/*
 * The ports a node offers the pointer that comes near one. They are drawn here and not in the frame,
 * so a port sits beside its node in the same layer as the line it starts, and a node holds nothing
 * of the canvas around it.
 */
export function PortHints({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
    const canvasStore = useCanvasStore();
    const nodes = useCanvas((s) => s.nodes);
    const texts = useCanvas((s) => s.texts);
    const edges = useCanvas((s) => s.edges);
    const hidden = useCanvas((s) => s.hidden);
    const zoom = useCanvas((s) => s.camera.zoom);
    // Nothing is offered while a gesture is running: a port that lights up under a node being dragged is noise.
    const quiet = useCanvas((s) => s.gesturing || s.linkDraft !== null);
    const [point, setPoint] = useState<Point | null>(null);

    useEffect(() => {
        const el = rootRef.current;
        if (!el) {
            return;
        }
        let frame: number | null = null;
        let latest: Point | null = null;
        const onMove = (e: PointerEvent): void => {
            const rect = el.getBoundingClientRect();
            latest = toWorld(canvasStore.getState().camera, { x: e.clientX - rect.left, y: e.clientY - rect.top });
            // A port lighting up must not re-render on every sample the pointer sends.
            if (frame === null) {
                frame = window.requestAnimationFrame(() => {
                    frame = null;
                    setPoint(latest);
                });
            }
        };
        const onLeave = (): void => setPoint(null);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerleave', onLeave);
        return () => {
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerleave', onLeave);
            if (frame !== null) {
                window.cancelAnimationFrame(frame);
            }
        };
    }, [canvasStore, rootRef]);

    /* A group is a frame under its nodes, never something you draw a line from by brushing past its border. */
    const open = useMemo(() => Object.values(nodes).filter((node) => node.kind !== 'group' && !hidden.has(node.id)), [hidden, nodes]);

    const hints = useMemo(() => (point === null || quiet ? [] : portHints(open, point, HINT_REACH / zoom)), [open, point, quiet, zoom]);

    /* A side a line already leaves from has its dot drawn by that line, so this one only takes the press.
       Nothing is offered while a gesture runs, which is also when the routes move on every frame. */
    const taken = useMemo(() => {
        if (quiet) {
            return new Set<string>();
        }
        const rectOf = (id: string): Rect | null => {
            if (hidden.has(id)) {
                return null;
            }
            const text = texts[id];
            return nodes[id] ?? (text === undefined ? null : textRect(text));
        };
        return takenPorts(
            edges,
            rectOf,
            open.map(({ id, x, y, w, h }) => ({ id, x, y, w, h }))
        );
    }, [edges, hidden, nodes, open, quiet, texts]);

    if (hints.length === 0) {
        return null;
    }
    return (
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            {hints.map((hint) => {
                const hot = hint.distance * zoom <= HINT_HOT;
                const occupied = taken.has(portKey(hint.nodeId, hint.side));
                return (
                    <PortDot
                        key={`${hint.nodeId}:${hint.side}`}
                        at={hint.at}
                        zoom={zoom}
                        strength={hint.strength}
                        hot={hot}
                        ring={!occupied || hot}
                        rest={0}
                        data={{ 'data-port': hint.nodeId, 'data-port-side': hint.side }}
                    />
                );
            })}
        </svg>
    );
}

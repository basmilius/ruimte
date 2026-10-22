import clsx from 'clsx';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { HINT_HOT } from '@/canvas/port-hints';
import {
    handleRail,
    heldHandle,
    RESIZE_CORNER,
    resizeHandle,
    type HandleRail,
    type ResizeCandidate,
    type ResizeEdge,
    type ResizeHandle
} from '@/canvas/resize-handles';
import { useWorldPointer } from '@/canvas/use-world-pointer';
import { useCanvas } from '@/state/canvas';

/* As long as `duration-150` on the path and the fades. */
const MORPH_MS = 150;

interface Shown {
    handle: ResizeHandle;
    rail: HandleRail;
}

const CURSOR: Record<ResizeEdge, string> = {
    n: 'cursor-ns-resize',
    s: 'cursor-ns-resize',
    e: 'cursor-ew-resize',
    w: 'cursor-ew-resize',
    ne: 'cursor-nesw-resize',
    sw: 'cursor-nesw-resize',
    nw: 'cursor-nwse-resize',
    se: 'cursor-nwse-resize'
};

/*
 * The resize handle a node offers the pointer that comes near it, outside its frame so the content
 * keeps every pixel. Like a port it belongs to the canvas: one handle at a time, on the nearest node.
 */
export function ResizeHandles({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
    const nodes = useCanvas((s) => s.nodes);
    const hidden = useCanvas((s) => s.hidden);
    const zoom = useCanvas((s) => s.camera.zoom);
    const locked = useCanvas((s) => s.locks.resize);
    const resizing = useCanvas((s) => s.resizing);
    const quiet = useCanvas((s) => (s.gesturing && s.resizing === null) || s.linkDraft !== null);
    const point = useWorldPointer(rootRef);
    // The edge a press took, so a running resize keeps it whatever the pointer passes over.
    const [grabbed, setGrabbed] = useState<{ nodeId: string; edge: ResizeEdge } | null>(null);

    const candidates = useMemo<ResizeCandidate[]>(
        () =>
            Object.values(nodes)
                .filter((node) => !hidden.has(node.id) && !(node.kind === 'group' && node.collapsed === true))
                .map(({ id, x, y, w, h, kind }) => ({ id, x, y, w, h, group: kind === 'group' })),
        [hidden, nodes]
    );

    const handle = useMemo(() => {
        if (locked || point === null) {
            return null;
        }
        if (resizing !== null) {
            const node = nodes[resizing];
            return grabbed?.nodeId === resizing && node !== undefined ? heldHandle(node, grabbed.edge, point, zoom) : null;
        }
        return quiet ? null : resizeHandle(candidates, point, zoom);
    }, [candidates, grabbed, locked, nodes, point, quiet, resizing, zoom]);

    /* Only a change of shape glides: a pill following the pointer along an edge would trail behind it. */
    const shape = handle === null ? null : `${handle.nodeId}:${handle.edge}`;
    const [lastShape, setLastShape] = useState(shape);
    const [morphing, setMorphing] = useState(false);
    if (shape !== lastShape) {
        setLastShape(shape);
        setMorphing(shape !== null && lastShape !== null && shape.split(':')[0] === lastShape.split(':')[0]);
    }
    useEffect(() => {
        if (!morphing) {
            return;
        }
        const timer = window.setTimeout(() => setMorphing(false), MORPH_MS);
        return () => window.clearTimeout(timer);
    }, [morphing, lastShape]);

    const current = useMemo(() => (handle === null ? null : { handle, rail: handleRail(nodes[handle.nodeId]!, handle, zoom) }), [handle, nodes, zoom]);

    /* A handle that jumps to the node beside it fades out where it was while the new one fades in. */
    const previous = useRef<Shown | null>(null);
    const [leaving, setLeaving] = useState<Shown | null>(null);
    useLayoutEffect(() => {
        const last = previous.current;
        previous.current = current;
        if (last !== null && current !== null && last.handle.nodeId !== current.handle.nodeId) {
            setLeaving(last);
        }
    }, [current]);
    useEffect(() => {
        if (leaving === null) {
            return;
        }
        const timer = window.setTimeout(() => setLeaving(null), MORPH_MS);
        return () => window.clearTimeout(timer);
    }, [leaving]);

    if (current === null && leaving === null) {
        return null;
    }
    return (
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            {leaving !== null && (
                <g key={`leaving:${leaving.handle.nodeId}`} style={{ opacity: leaving.handle.strength }}>
                    <g className="opacity-0 transition-opacity duration-150 ease-out starting:opacity-100 motion-reduce:transition-none">
                        <HandleStroke shown={leaving} zoom={zoom} morphing={false} />
                    </g>
                </g>
            )}
            {current !== null && (
                <g
                    key={current.handle.nodeId}
                    style={{ opacity: current.handle.strength }}
                    onPointerDown={() => setGrabbed({ nodeId: current.handle.nodeId, edge: current.handle.edge })}
                >
                    <g className="transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none">
                        {current.handle.edge.length === 2 ? (
                            <CornerArea handle={current.handle} zoom={zoom} />
                        ) : (
                            <PillArea handle={current.handle} zoom={zoom} />
                        )}
                        <HandleStroke shown={current} zoom={zoom} morphing={morphing} />
                    </g>
                </g>
            )}
        </svg>
    );
}

/* The whole rail, of which only the handle's stretch is drawn: a change of shape slides along it.
   Keyed on the zoom, or a zoom step would glide where it should jump. */
function HandleStroke({ shown, zoom, morphing }: { shown: Shown; zoom: number; morphing: boolean }) {
    const { handle, rail } = shown;
    return (
        <path
            key={zoom}
            d={rail.path}
            fill="none"
            stroke={handle.hot ? 'var(--accent)' : 'var(--edge-line)'}
            strokeWidth={4 / zoom}
            strokeLinecap="round"
            // In style and not as attributes, so a change is one a transition sees.
            style={{ strokeDasharray: `${rail.length} ${rail.perimeter - rail.length}`, strokeDashoffset: -rail.from }}
            className={clsx(
                morphing ? 'transition-[stroke-dasharray,stroke-dashoffset,stroke]' : 'transition-[stroke]',
                'duration-150 ease-out motion-reduce:transition-none'
            )}
        />
    );
}

function PillArea({ handle, zoom }: { handle: ResizeHandle; zoom: number }) {
    const horizontal = handle.edge === 'n' || handle.edge === 's';
    const band = HINT_HOT / zoom;
    const along = handle.length;
    return (
        <rect
            data-resize={handle.edge}
            data-resize-node={handle.nodeId}
            x={handle.at.x - (horizontal ? along : band) / 2}
            y={handle.at.y - (horizontal ? band : along) / 2}
            width={horizontal ? along : band}
            height={horizontal ? band : along}
            fill="transparent"
            className={`pointer-events-auto ${CURSOR[handle.edge]}`}
        />
    );
}

function CornerArea({ handle, zoom }: { handle: ResizeHandle; zoom: number }) {
    const sx = handle.edge.includes('w') ? -1 : 1;
    const sy = handle.edge.includes('n') ? -1 : 1;
    const { x, y } = handle.at;
    const band = HINT_HOT / zoom;
    const reach = RESIZE_CORNER / zoom;
    // An L around the outside of the corner: a press beside either edge near it, or past the corner itself.
    const area = [
        [x + sx * band, y + sy * band],
        [x - sx * reach, y + sy * band],
        [x - sx * reach, y],
        [x, y],
        [x, y - sy * reach],
        [x + sx * band, y - sy * reach]
    ]
        .map(([px, py]) => `${px},${py}`)
        .join(' ');
    return (
        <polygon
            data-resize={handle.edge}
            data-resize-node={handle.nodeId}
            points={area}
            fill="transparent"
            className={`pointer-events-auto ${CURSOR[handle.edge]}`}
        />
    );
}

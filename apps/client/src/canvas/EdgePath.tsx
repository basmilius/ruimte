import type { MouseEvent, PointerEvent, ReactNode } from 'react';
import { EdgeMarker } from '@/canvas/EdgeMarker';
import { edgeStroke, EDGE_WIDTH, type EdgeLook } from '@/canvas/edge-look';
import type { EdgeRoute } from '@/canvas/edge-route';

/* Everything below is in screen pixels: a line is the same weight at every zoom, only its place is
   in the world. What a person aims at with a pointer does not belong to the drawing. */

/* How wide the aim at a line is: the line itself is two across and a pointer is not that precise. */
const HIT_WIDTH = 14;

/* The dash of a line that is dashed, and of a draft, which is the shorter of the two. */
const DASH = 6;
const DRAFT_DASH = 4;

/* The plate the cross sits on and how far its arms reach from the middle of it. */
const CROSS_R = 9;
const CROSS_ARM = 3;

interface EdgePathProps {
    route: EdgeRoute;
    look: EdgeLook;
    zoom: number;
    /* Pointed at or picked: the line is drawn a step heavier and in the livelier of its two colors. */
    active: boolean;
    /* The cross on the middle, left out wherever the line cannot be removed right now. */
    onRemove?: () => void;
    /* How far right of the middle that cross sits, in screen pixels, to clear a label riding there. */
    removeOffset?: number;
    removeLabel?: string;
    onPress?: (e: PointerEvent<SVGPathElement>) => void;
    onDoubleClick?: (e: MouseEvent<SVGPathElement>) => void;
    onEnter?: () => void;
    onLeave?: () => void;
    /* What rides along with the line, which on a canvas is the name a person wrote on it. */
    children?: ReactNode;
}

/*
 * One line, wherever it is drawn: the stroke its look asks for, a marker in the gap at either end, a
 * wide invisible path that takes the pointer, and the cross that removes it. A connector belongs to
 * the surface under the nodes, so this is the whole of what that surface draws for one line.
 */
export function EdgePath({
    route,
    look,
    zoom,
    active,
    onRemove,
    removeOffset = 0,
    removeLabel,
    onPress,
    onDoubleClick,
    onEnter,
    onLeave,
    children
}: EdgePathProps) {
    const stroke = edgeStroke(look, active);
    const dash = DASH / zoom;
    return (
        <g onPointerEnter={onEnter} onPointerLeave={onLeave}>
            <path
                d={route.d}
                fill="none"
                stroke="transparent"
                strokeWidth={HIT_WIDTH / zoom}
                className="pointer-events-auto cursor-pointer"
                onPointerDown={onPress}
                onDoubleClick={onDoubleClick}
            />
            <path
                d={route.d}
                fill="none"
                stroke={stroke}
                strokeWidth={(active ? look.width + 1 : look.width) / zoom}
                strokeDasharray={look.dashed ? `${dash} ${dash}` : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <EdgeMarker shape={look.tail} at={route.from} side={route.fromSide} stroke={stroke} zoom={zoom} />
            <EdgeMarker shape={look.head} at={route.to} side={route.toSide} stroke={stroke} zoom={zoom} />
            {children}
            {active && onRemove !== undefined && (
                <g
                    transform={`translate(${route.mid.x + removeOffset / zoom} ${route.mid.y}) scale(${1 / zoom})`}
                    className="pointer-events-auto cursor-pointer"
                    {...(removeLabel === undefined ? {} : { role: 'button', 'aria-label': removeLabel })}
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                >
                    <circle r={CROSS_R} fill="var(--surface-raised)" stroke="var(--border-strong)" />
                    <path
                        d={`M -${CROSS_ARM} -${CROSS_ARM} L ${CROSS_ARM} ${CROSS_ARM} M ${CROSS_ARM} -${CROSS_ARM} L -${CROSS_ARM} ${CROSS_ARM}`}
                        fill="none"
                        stroke="var(--text-muted)"
                        strokeWidth="2"
                        strokeLinecap="round"
                    />
                </g>
            )}
        </g>
    );
}

/*
 * The line being pulled right now, drawn to wherever the pointer is. Nothing on it takes a pointer:
 * the pointer is what is drawing it, and a press belongs to whatever it lands on.
 */
export function DraftEdge({ route, zoom }: { route: EdgeRoute; zoom: number }) {
    const dash = DRAFT_DASH / zoom;
    return (
        <>
            <path
                d={route.d}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={EDGE_WIDTH / zoom}
                strokeDasharray={`${dash} ${dash}`}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <EdgeMarker shape="dot" at={route.from} side={route.fromSide} stroke="var(--accent)" zoom={zoom} />
        </>
    );
}

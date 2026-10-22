import { type RefObject } from 'react';
import { lineRoutes } from '@/canvas/line-routes';
import { HINT_HOT, HINT_REACH, portHints, portKey, takenPorts } from '@/canvas/port-hints';
import { useWorldPointer } from '@/canvas/use-world-pointer';
import { useCanvas } from '@/state/canvas';

/*
 * The ports a node offers the pointer that comes near one. They are drawn here and not in the frame,
 * so a port sits beside its node in the same layer as the line it starts, and a node holds nothing
 * of the canvas around it.
 */
export function PortHints({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
    const nodes = useCanvas((s) => s.nodes);
    const texts = useCanvas((s) => s.texts);
    const edges = useCanvas((s) => s.edges);
    const hidden = useCanvas((s) => s.hidden);
    const zoom = useCanvas((s) => s.camera.zoom);
    // Nothing is offered while a gesture is running: a port that lights up under a node being dragged is noise.
    const quiet = useCanvas((s) => s.gesturing || s.linkDraft !== null);
    const point = useWorldPointer(rootRef);

    /* A group is a frame under its nodes, never something you draw a line from by brushing past its border. */
    const open = Object.values(nodes).filter((node) => node.kind !== 'group' && !hidden.has(node.id));

    const hints = point === null || quiet ? [] : portHints(open, point, HINT_REACH / zoom);

    /* A side a line already leaves from has its dot drawn by that line, so this one only takes the press. */
    const taken = quiet ? new Set<string>() : takenPorts(lineRoutes(edges, nodes, texts, hidden));

    if (hints.length === 0) {
        return null;
    }
    return (
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            {hints.map((hint) => {
                const hot = hint.distance * zoom <= HINT_HOT;
                const occupied = taken.has(portKey(hint.nodeId, hint.side));
                return (
                    <g key={`${hint.nodeId}:${hint.side}`} style={{ opacity: hint.strength }}>
                        {/* The dot is small on purpose; what you aim at is this, which stays the same size at every zoom.
                            It sits over the line that ends here, so a port is a port even where one already lands. */}
                        <circle
                            data-port={hint.nodeId}
                            data-port-side={hint.side}
                            cx={hint.at.x}
                            cy={hint.at.y}
                            r={12 / zoom}
                            fill="transparent"
                            className="pointer-events-auto cursor-crosshair"
                        />
                        {(!occupied || hot) && (
                            <circle
                                cx={hint.at.x}
                                cy={hint.at.y}
                                r="5"
                                fill="var(--canvas-bg)"
                                stroke={hot ? 'var(--accent)' : 'var(--edge-line)'}
                                strokeWidth="2"
                            />
                        )}
                    </g>
                );
            })}
        </svg>
    );
}

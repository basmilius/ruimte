import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { FlowContent, FlowLink, FlowPort } from '@ruimte/contracts';
import { portsOf } from '@ruimte/flow';
import { routeDraft, routeEdge, type EdgeRoute } from '@/canvas/edge-route';
import { bandOf, cardRect, obstaclesOf, portDot } from '@/flow/geometry';
import type { Point } from '@/canvas/math';

/* How close a pointer comes before a port opens up to be pulled from, in world units. */
const PORT_REACH = 90;

const PORT_R = 4.5;
const PORT_R_NEAR = 7;

export interface FlowDraft {
    from: string;
    fromPort: FlowPort;
    at: Point;
}

interface FlowLinkLayerProps {
    content: FlowContent;
    zoom: number;
    /* Where the pointer is on the worksheet, so a port it comes near opens up. Null once it left. */
    pointer: Point | null;
    /* The line being pulled right now, drawn to wherever the pointer is. */
    draft: FlowDraft | null;
    hovered: string | null;
    onHover(key: string | null): void;
    onRemove(link: FlowLink): void;
}

/* One line, from a port to the one way in of the card it points at. */
const routeOf = (content: FlowContent, link: FlowLink): EdgeRoute | null => {
    const from = content.cards[link.from];
    const to = content.cards[link.to];
    if (from === undefined || to === undefined) {
        return null;
    }
    const band = bandOf(from, link.fromPort);
    const obstacles = obstaclesOf(content).filter((obstacle) => obstacle.id !== link.from && obstacle.id !== link.to);
    return routeEdge(band, cardRect(to), obstacles, { fromSide: 'right', toSide: 'left' });
};

export const linkKey = (link: FlowLink): string => `${link.from}:${link.fromPort}:${link.to}`;

/*
 * The lines and the ports, in the layer under the cards: a line belongs to the worksheet and never to
 * a card, which is the same rule a canvas keeps. The way out a run takes is drawn through, the way
 * it does not is dashed, and the color is only ever an extra: a flow has to read in a screenshot.
 */
export function FlowLinkLayer({ content, zoom, pointer, draft, hovered, onHover, onRemove }: FlowLinkLayerProps) {
    const { t } = useTranslation('flow');
    const taken = new Set(content.links.map((link) => `${link.from}:${link.fromPort}`));
    const obstacles = obstaclesOf(content);
    const draftRoute =
        draft === null || content.cards[draft.from] === undefined
            ? null
            : routeDraft(
                  bandOf(content.cards[draft.from]!, draft.fromPort),
                  draft.at,
                  obstacles.filter((obstacle) => obstacle.id !== draft.from),
                  { fromSide: 'right' }
              );

    return (
        <g>
            {content.links.map((link) => {
                const route = routeOf(content, link);
                if (route === null) {
                    return null;
                }
                const key = linkKey(link);
                const dashed = link.fromPort === 'false' || link.fromPort === 'error';
                return (
                    <g key={key} className="pointer-events-auto" onPointerEnter={() => onHover(key)} onPointerLeave={() => onHover(null)}>
                        {/* A line is three pixels wide and a pointer is not, so a wider path takes the presses. */}
                        <path d={route.d} className="fill-none stroke-transparent" strokeWidth={14 / zoom} />
                        <path
                            d={route.d}
                            className={clsx('fill-none', dashed ? 'stroke-text-faint' : 'stroke-accent', hovered === key && 'stroke-accent')}
                            strokeWidth={2 / zoom}
                            strokeLinecap="round"
                            strokeDasharray={dashed ? `${6 / zoom} ${5 / zoom}` : undefined}
                        />
                        <circle cx={route.to.x} cy={route.to.y} r={PORT_R / zoom} className={dashed ? 'fill-text-faint' : 'fill-accent'} />
                        {hovered === key && (
                            <g
                                className="cursor-pointer"
                                role="button"
                                aria-label={t('link.remove')}
                                onPointerDown={(e) => {
                                    e.stopPropagation();
                                    onRemove(link);
                                }}
                            >
                                <circle cx={route.mid.x} cy={route.mid.y} r={9 / zoom} className="fill-surface-raised stroke-border" strokeWidth={1 / zoom} />
                                <path
                                    d={`M${route.mid.x - 3.5 / zoom} ${route.mid.y - 3.5 / zoom}L${route.mid.x + 3.5 / zoom} ${route.mid.y + 3.5 / zoom}M${route.mid.x + 3.5 / zoom} ${route.mid.y - 3.5 / zoom}L${route.mid.x - 3.5 / zoom} ${route.mid.y + 3.5 / zoom}`}
                                    className="fill-none stroke-text-muted"
                                    strokeWidth={1.5 / zoom}
                                    strokeLinecap="round"
                                />
                            </g>
                        )}
                    </g>
                );
            })}

            {draftRoute !== null && (
                <path d={draftRoute.d} className="fill-none stroke-accent" strokeWidth={2 / zoom} strokeDasharray={`${4 / zoom} ${4 / zoom}`} />
            )}

            {Object.entries(content.cards).flatMap(([id, card]) => {
                return portsOf(card).map((port) => {
                    const at = portDot(card, port);
                    const near = pointer !== null && Math.hypot(pointer.x - at.x, pointer.y - at.y) < PORT_REACH;
                    const filled = taken.has(`${id}:${port}`);
                    return (
                        <circle
                            key={`${id}:${port}`}
                            data-flow-port={id}
                            data-flow-port-side={port}
                            cx={at.x}
                            cy={at.y}
                            r={(near ? PORT_R_NEAR : PORT_R) / zoom}
                            strokeWidth={1.5 / zoom}
                            className={clsx(
                                'pointer-events-auto cursor-crosshair transition-[r]',
                                filled ? 'fill-accent stroke-accent' : 'fill-surface-raised stroke-border-strong',
                                near && 'stroke-accent'
                            )}
                        />
                    );
                });
            })}
        </g>
    );
}

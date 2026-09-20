import { useTranslation } from 'react-i18next';
import type { FlowContent, FlowLink, FlowPort } from '@ruimte/contracts';
import { portsOf } from '@ruimte/flow';
import { flowLook } from '@/canvas/edge-look';
import { DraftEdge, EdgePath } from '@/canvas/EdgePath';
import { routeDraft, routeEdge, type EdgeRoute } from '@/canvas/edge-route';
import { HINT_HOT, HINT_REACH, hintStrength } from '@/canvas/port-hints';
import { PortDot } from '@/canvas/PortDot';
import { bandOf, cardRect, obstaclesOf, portDot } from '@/flow/geometry';
import type { Point } from '@/canvas/math';

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
    /* The line a person picked, by its key, which is what Delete acts on. */
    selected: string | null;
    onHover(key: string | null): void;
    onSelect(link: FlowLink): void;
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
 * a card, which is the same rule a canvas keeps. It is drawn with what the canvas draws with, down to
 * the distance a port opens up over, so the two surfaces are one drawing with two tables of looks.
 */
export function FlowLinkLayer({ content, zoom, pointer, draft, hovered, selected, onHover, onSelect, onRemove }: FlowLinkLayerProps) {
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

    /* A port opens up over the same distance as on a canvas, which is in screen pixels: how near the
       pointer is to a dot is a thing of the screen, not of the worksheet under it. */
    const reach = HINT_REACH / zoom;

    return (
        <g>
            {content.links.map((link) => {
                const route = routeOf(content, link);
                if (route === null) {
                    return null;
                }
                const key = linkKey(link);
                const active = hovered === key || selected === key;
                return (
                    <EdgePath
                        key={key}
                        route={route}
                        look={flowLook(link.fromPort)}
                        zoom={zoom}
                        active={active}
                        onEnter={() => onHover(key)}
                        onLeave={() => onHover(null)}
                        onPress={(e) => {
                            e.stopPropagation();
                            onSelect(link);
                        }}
                        removeLabel={t('link.remove')}
                        onRemove={() => onRemove(link)}
                    />
                );
            })}

            {draftRoute !== null && <DraftEdge route={draftRoute} zoom={zoom} />}

            {Object.entries(content.cards).flatMap(([id, card]) =>
                portsOf(card).map((port) => {
                    const at = portDot(card, port);
                    const distance = pointer === null ? Infinity : Math.hypot(pointer.x - at.x, pointer.y - at.y);
                    const hot = distance * zoom <= HINT_HOT;
                    return (
                        <PortDot
                            key={`${id}:${port}`}
                            at={at}
                            zoom={zoom}
                            strength={hintStrength(distance, reach)}
                            hot={hot}
                            /* The line that leaves here draws its own dot on this spot, so the port
                               only takes the press until the pointer is on it. */
                            ring={!taken.has(`${id}:${port}`) || hot}
                            /* Every port a card has is on show: which ways out it offers is what a
                               person reads a worksheet by, before ever reaching for one. */
                            rest={1}
                            data={{ 'data-flow-port': id, 'data-flow-port-side': port }}
                        />
                    );
                })
            )}
        </g>
    );
}

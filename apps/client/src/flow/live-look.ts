import type { FlowContent, FlowLink } from '@ruimte/contracts';
import { cardStatuses } from '@ruimte/flow';
import { linkKey } from '@/flow/FlowLinkLayer';
import type { FlowLiveRun } from '@/flow/use-live-run';

/* A card the run passed, or one it can no longer reach because every line into it died. */
export type CardLight = 'ran' | 'dead';

/* A line the run went along, or one whose branch is over. */
export type LinkLight = 'live' | 'dead';

export interface FlowLights {
    cards: Record<string, CardLight>;
    links: Record<string, LinkLight>;
    /* The card that settled last, which flashes once. */
    pulse: string | null;
}

/*
 * What a run that is going on right now does to the worksheet. The path it took is drawn rather than
 * listed: with twenty cards on a worksheet "which way did it go" is the question, and a graph that
 * lights up answers it in a glance. A branch that reached a port nobody drew from is not a failure,
 * so it fades back instead of turning red.
 */
export const flowLights = (content: FlowContent, live: FlowLiveRun | null): FlowLights | null => {
    if (live === null) {
        return null;
    }
    const statuses = cardStatuses(content, { entry: live.entry, settled: live.settled, running: live.waiting });
    const cards: Record<string, CardLight> = {};
    for (const id of Object.keys(content.cards)) {
        if (statuses[id] === 'dead') {
            cards[id] = 'dead';
        } else if (id === live.entry || Object.hasOwn(live.settled, id) || live.waiting.includes(id)) {
            cards[id] = 'ran';
        }
    }
    const links: Record<string, LinkLight> = {};
    for (const link of content.links) {
        const port = live.settled[link.from];
        if (Object.hasOwn(live.settled, link.from)) {
            links[linkKey(link)] = port === link.fromPort ? 'live' : 'dead';
        } else if (cards[link.from] === 'dead') {
            links[linkKey(link)] = 'dead';
        }
    }
    return { cards, links, pulse: live.lastCard };
};

/* Whether this line carried the run, for a reader that has no lights at all. */
export const linkLight = (lights: FlowLights | null, link: FlowLink): LinkLight | null => lights?.links[linkKey(link)] ?? null;

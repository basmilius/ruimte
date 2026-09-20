import type { FlowContent, FlowPort } from '@ruimte/contracts';
import { linksTo } from './graph.ts';

/*
 * Where a run stands, as something that can be written down. It rides on the outbox entry of the run
 * it belongs to, so a machine that restarts halfway picks the same branches back up.
 */
export interface FlowRunState {
    /* The card the run began at. */
    entry: string;
    /* The port each card that is done left by, or null when it went nowhere at all. */
    settled: Record<string, FlowPort | null>;
    /* Cards handed out and not answered yet, which is what a wait card leaves behind. */
    running: string[];
}

/* Whether a card has been reached, can no longer be reached, or is still waiting on what is above it. */
export type FlowCardStatus = 'reached' | 'open' | 'dead';

export const startRun = (entry: string): FlowRunState => ({ entry, settled: {}, running: [] });

/*
 * What every card on the worksheet is, given what has run so far. A card is reached as soon as one
 * line into it carried a run, and dead once every line into it is dead. An `all` card is the one
 * exception: it holds until no line into it is open any more, which is what makes it a join.
 */
export const cardStatuses = (content: FlowContent, state: FlowRunState): Record<string, FlowCardStatus> => {
    const ids = Object.keys(content.cards);
    const status: Record<string, FlowCardStatus> = {};
    for (const id of ids) {
        status[id] = id === state.entry || Object.hasOwn(state.settled, id) || state.running.includes(id) ? 'reached' : 'open';
    }
    /*
     * Deciding one card can settle another, so this runs until nothing moves. Every pass turns an
     * `open` into a `reached` or a `dead` and never back, so it stops within one pass per card.
     */
    for (let pass = 0; pass <= ids.length; pass += 1) {
        let moved = false;
        for (const id of ids) {
            if (status[id] !== 'open') {
                continue;
            }
            const incoming = linksTo(content, id);
            if (incoming.length === 0) {
                // Nothing leads here and the run did not start here: an island this run never enters.
                status[id] = 'dead';
                moved = true;
                continue;
            }
            const states = incoming.map((link) => {
                if (status[link.from] === 'dead') {
                    return 'dead';
                }
                if (!Object.hasOwn(state.settled, link.from)) {
                    return 'open';
                }
                return state.settled[link.from] === link.fromPort ? 'live' : 'dead';
            });
            const waiting = content.cards[id]?.kind === 'all' ? states.includes('open') : !states.includes('live') && states.includes('open');
            if (waiting) {
                continue;
            }
            status[id] = states.includes('live') ? 'reached' : 'dead';
            moved = true;
        }
        if (!moved) {
            break;
        }
    }
    return status;
};

/* The cards that may run now. Two of them are two branches side by side, not an order. */
export const readyCards = (content: FlowContent, state: FlowRunState): string[] => {
    const status = cardStatuses(content, state);
    return Object.keys(content.cards)
        .filter((id) => status[id] === 'reached' && !Object.hasOwn(state.settled, id) && !state.running.includes(id))
        .sort();
};

/* Hands a card out. A card reached by two branches is handed out once, which is what keeps it to one run. */
export const beginCard = (state: FlowRunState, cardId: string): FlowRunState =>
    state.running.includes(cardId) || Object.hasOwn(state.settled, cardId) ? state : { ...state, running: [...state.running, cardId] };

/* Writes down how a card ended. A null port is a card that went nowhere, so every line out of it dies. */
export const settleCard = (state: FlowRunState, cardId: string, port: FlowPort | null): FlowRunState => ({
    ...state,
    settled: { ...state.settled, [cardId]: port },
    running: state.running.filter((id) => id !== cardId)
});

/* A run is over once no branch is still going: nothing is out, and nothing new can start. */
export const runFinished = (content: FlowContent, state: FlowRunState): boolean => state.running.length === 0 && readyCards(content, state).length === 0;

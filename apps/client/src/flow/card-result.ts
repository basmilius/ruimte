import type { FlowPort, FlowRunStep } from '@ruimte/contracts';

/* What one card did the last time a run reached it. */
export interface FlowCardResult {
    /* How long the card itself took, when it did work worth timing. */
    ms?: number;
    /* The port it left by, or absent for a card that went nowhere at all. */
    port?: FlowPort;
    /* The one sentence it wrote down, which in a dry run is what it would have done. */
    note?: string;
    /* Written down rather than carried out. */
    dry: boolean;
    /* The moment it settled, so the newest run wins when two of them are on screen. */
    at: number;
}

/*
 * What every card did in one run, read off the steps that run wrote. A card reached twice keeps the
 * last time, because that is the one a person is looking at.
 *
 * It is the same stream the worksheet lights up from, read a second time: the run says what happened
 * and the cards say it where the question was asked, rather than in a list somewhere else.
 */
export const cardResultsOf = (steps: readonly FlowRunStep[]): Record<string, FlowCardResult> => {
    const results: Record<string, FlowCardResult> = {};
    for (const step of steps) {
        const before = results[step.cardId];
        if (before !== undefined && before.at > step.at) {
            continue;
        }
        results[step.cardId] = {
            ...(step.ms === undefined ? {} : { ms: step.ms }),
            ...(step.port === undefined ? {} : { port: step.port }),
            ...(step.note === undefined ? {} : { note: step.note }),
            dry: step.dry === true,
            at: step.at
        };
    }
    return results;
};

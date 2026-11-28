/*
 * The Pulseboard service, as this extension would reach it over the network: the history an account keeps, as fixed
 * data. It names no dates, so what a person sees does not depend on the day it is read.
 */

export interface History {
    /* Turns per day over the last two weeks, oldest first. */
    turns: number[];
    days: string[];
    parts: string[];

    /* Turns per day of the week, in the order of `days`, and per part of the day, in the order of `parts`. */
    byPart: number[][];
}

export const HISTORY: History = {
    turns: [12, 18, 9, 22, 30, 4, 0, 16, 21, 27, 19, 33, 6, 2],
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    parts: ['Morning', 'Afternoon', 'Evening'],
    byPart: [
        [10, 14, 4],
        [13, 21, 5],
        [8, 16, 12],
        [17, 19, 5],
        [24, 31, 8],
        [2, 6, 2],
        [0, 1, 1]
    ]
};

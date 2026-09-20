import type { FlowArgDefinition, FlowCard, FlowContent } from '@ruimte/contracts';
import { argApplies, argsOf, textArg } from './cards.ts';
import { brokenTokenRefsIn, visibleTokens, type FlowVisibleToken } from './tokens.ts';

/*
 * What is wrong with a field: it is asked for and empty, or it holds something the card cannot work
 * with. The editor draws the two apart, because a field nobody got to yet is not a mistake.
 */
export type FlowArgProblem = 'missing' | 'invalid';

/* `HH:MM` on a 24 hour clock, which is what a `time` field is stored as wherever it is read. */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/*
 * Whether what this field holds can be read back as the type the card asked for. An empty field is
 * not this question's business: that one is answered before it, so a card a person just put down
 * does not read as broken.
 */
const isWellFormed = (card: FlowCard, arg: FlowArgDefinition): boolean => {
    const value = card.args[arg.name];
    switch (arg.type) {
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'time':
            return TIME.test(textArg(card, arg.name));
        case 'choice':
            return (arg.choices ?? []).includes(textArg(card, arg.name));
        default:
            return true;
    }
};

/*
 * Everything wrong on this worksheet, by card and then by field. One pass over the whole content
 * rather than a question per field: whether a token reference still holds depends on every line
 * drawn, so asking per field would work the graph out again for each of them.
 */
export const argProblemsOf = (content: FlowContent): Record<string, Record<string, FlowArgProblem>> => {
    const problems: Record<string, Record<string, FlowArgProblem>> = {};
    const note = (cardId: string, name: string, problem: FlowArgProblem): void => {
        problems[cardId] = { ...problems[cardId], [name]: problem };
    };
    for (const [id, card] of Object.entries(content.cards)) {
        for (const arg of argsOf(card)) {
            if (!argApplies(card, arg)) {
                continue;
            }
            if (textArg(card, arg.name).trim() === '') {
                if (arg.optional !== true) {
                    note(id, arg.name, 'missing');
                }
            } else if (!isWellFormed(card, arg)) {
                note(id, arg.name, 'invalid');
            }
        }
    }
    /* A reference to a card that is not on every path here is a value that is empty half the time,
       and the line that broke it was drawn somewhere else entirely. */
    for (const ref of brokenTokenRefsIn(content)) {
        note(ref.on, ref.arg, 'invalid');
    }
    return problems;
};

/* Whether anything on this card stops it, which is what marks it on the worksheet. */
export const cardHasProblem = (problems: Readonly<Record<string, Record<string, FlowArgProblem>>>, cardId: string): boolean =>
    Object.keys(problems[cardId] ?? {}).length > 0;

/*
 * The field that opens the moment a card is put down. Filling a card in is the point of adding one,
 * so the first field waiting for an answer asks for it rather than sitting there quietly. A card
 * that has nothing left to answer opens nothing.
 */
export const firstEmptyArgOf = (card: FlowCard): string | null =>
    argsOf(card).find((arg) => argApplies(card, arg) && textArg(card, arg.name).trim() === '')?.name ?? null;

/*
 * The tokens this one field may stand a reference to. A field that takes no tokens offers none, and
 * for the rest it is the intersection every path to this card passes, never a wider list.
 */
export const tokensForArg = (content: FlowContent, cardId: string, arg: FlowArgDefinition): FlowVisibleToken[] =>
    arg.tokens === true ? visibleTokens(content, cardId) : [];

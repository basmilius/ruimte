import { flowCardDefinition, type FlowCard, type FlowContent, type FlowTestScope } from '@ruimte/contracts';
import { argApplies, argsOf, isCatalogCard } from './cards.ts';
import { parseTokenRefs, tokenKey, visibleTokens, type FlowVisibleToken } from './tokens.ts';

/* Every card a run that began at this one could still reach, itself left out. */
export const downstreamOf = (content: FlowContent, from: string): Set<string> => {
    const reached = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
        const id = queue.shift() as string;
        for (const link of content.links) {
            if (link.from === id && content.cards[link.to] !== undefined && link.to !== from && !reached.has(link.to)) {
                reached.add(link.to);
                queue.push(link.to);
            }
        }
    }
    return reached;
};

/* The cards a test would actually run: one card on its own, or that card and everything after it. */
export const cardsInTest = (content: FlowContent, from: string, scope: FlowTestScope): Set<string> =>
    scope === 'card' ? new Set([from]) : new Set([from, ...downstreamOf(content, from)]);

/*
 * The tokens a test has to be given before it can start. Testing from the fourth card down means the
 * three above it never ran, so whatever they would have published has to come from somewhere; this
 * says what that somewhere owes, and nothing more. A test that reaches for no value from above asks
 * nothing and runs straight away.
 *
 * It is the same intersection that decides which tokens a card may use at all, so a reference the
 * editor would paint red is not something a test asks a person to fill in either.
 */
export const neededTokens = (content: FlowContent, from: string, scope: FlowTestScope): FlowVisibleToken[] => {
    const running = cardsInTest(content, from, scope);
    const wanted = new Set<string>();
    for (const id of running) {
        const card = content.cards[id];
        if (card === undefined) {
            continue;
        }
        for (const arg of argsOf(card)) {
            const value = card.args[arg.name];
            if (arg.tokens !== true || typeof value !== 'string' || !argApplies(card, arg)) {
                continue;
            }
            for (const ref of parseTokenRefs(value)) {
                // A card that runs in this test publishes its own tokens, so only the ones above it are owed.
                if (!running.has(ref.cardId)) {
                    wanted.add(tokenKey(ref.cardId, ref.token));
                }
            }
        }
    }
    return visibleTokens(content, from).filter((entry) => wanted.has(tokenKey(entry.cardId, entry.token.name)));
};

/*
 * Whether this card acts with the permission of whoever turned the flow on. A run without a ceiling
 * on it refuses such a card, which is what keeps a real test from being the way round the question
 * that turning a flow on asks.
 */
export const needsCeiling = (card: FlowCard): boolean => isCatalogCard(card) && card.card !== undefined && flowCardDefinition(card.card)?.needsCeiling === true;

/*
 * Whether this card is carried out for real in a dry run. A condition always is: it changes nothing,
 * and that is exactly what makes a dry test honest, since the path the test takes is the path the
 * real run would take. Every other card says for itself, and saying nothing reads as dry.
 */
export const runsForReal = (card: FlowCard, dry: boolean): boolean => {
    if (!dry || card.kind === 'condition') {
        return true;
    }
    return card.card !== undefined && flowCardDefinition(card.card)?.test === 'real';
};

/* Whether a dry run walks straight past this card. A test of thirty minutes is not a test. */
export const skippedWhenDry = (card: FlowCard, dry: boolean): boolean =>
    dry && (card.kind === 'delay' || (card.card !== undefined && flowCardDefinition(card.card)?.test === 'skip'));

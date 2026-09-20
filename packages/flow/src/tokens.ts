import type { FlowArgValue, FlowContent, FlowTokenDefinition } from '@ruimte/contracts';
import { argApplies, argsOf, isTriggerCard, tokensOf } from './cards.ts';
import { linksTo } from './graph.ts';

/*
 * How a token is written inside a text: `@[<cardId>.<token>]`. A person never types this, the editor
 * puts a chip there, and the notation only has to stay out of the way of what the text goes into.
 * Double brackets and double braces both fight with markdown and with a prompt, and a text on a flow
 * is usually on its way into one.
 */
const TOKEN_PATTERN = /@\[([^\s.[\]]+)\.([^\s[\]]+)\]/g;

export interface FlowTokenRef {
    cardId: string;
    token: string;
    /* The reference as it stands in the text, which is what a replacement looks for. */
    text: string;
}

export const tokenRef = (cardId: string, token: string): string => `@[${cardId}.${token}]`;

/* The key a filled-in value is looked up under, which is the reference without its brackets. */
export const tokenKey = (cardId: string, token: string): string => `${cardId}.${token}`;

export const parseTokenRefs = (text: string): FlowTokenRef[] =>
    [...text.matchAll(TOKEN_PATTERN)].map((match) => ({ cardId: match[1] as string, token: match[2] as string, text: match[0] }));

/*
 * The text with its references replaced. A reference nobody has a value for becomes empty rather than
 * staying as it is: a person reading a notification should not be shown the plumbing.
 */
export const fillTokens = (text: string, values: Readonly<Record<string, FlowArgValue>>): string =>
    text.replace(TOKEN_PATTERN, (_whole, cardId: string, token: string) => {
        const value = values[tokenKey(cardId, token)];
        return value === undefined ? '' : String(value);
    });

const intersect = (one: ReadonlySet<string>, other: ReadonlySet<string>): Set<string> => new Set([...one].filter((entry) => other.has(entry)));

/* Every card that can be reached from a trigger, since the rest is not part of any run. */
const reachableCards = (content: FlowContent): Set<string> => {
    const reached = new Set<string>();
    const queue = Object.entries(content.cards)
        .filter(([, card]) => isTriggerCard(card))
        .map(([id]) => id);
    for (const id of queue) {
        reached.add(id);
    }
    while (queue.length > 0) {
        const id = queue.shift() as string;
        for (const link of content.links) {
            if (link.from === id && content.cards[link.to] !== undefined && !reached.has(link.to)) {
                reached.add(link.to);
                queue.push(link.to);
            }
        }
    }
    return reached;
};

/*
 * The cards that lie on every path to this one, itself included. A card reached by two branches only
 * shares what both branches passed, which is the whole reason this is an intersection and not a
 * union: a token that exists on one branch is an empty value half the time, at four in the morning.
 */
const dominatorsOf = (content: FlowContent): Record<string, Set<string>> => {
    const reachable = reachableCards(content);
    const ids = [...reachable].sort();
    const dominators: Record<string, Set<string>> = {};
    for (const id of ids) {
        dominators[id] = isTriggerCard(content.cards[id]!) ? new Set([id]) : new Set(ids);
    }
    for (let pass = 0; pass <= ids.length; pass += 1) {
        let moved = false;
        for (const id of ids) {
            if (isTriggerCard(content.cards[id]!)) {
                continue;
            }
            const preds = linksTo(content, id)
                .map((link) => link.from)
                .filter((from) => reachable.has(from));
            let next: Set<string> | null = null;
            for (const pred of preds) {
                const above = dominators[pred] as Set<string>;
                next = next === null ? new Set(above) : intersect(next, above);
            }
            const settled = next === null ? new Set([id]) : new Set([...next, id]);
            if (settled.size !== (dominators[id] as Set<string>).size) {
                dominators[id] = settled;
                moved = true;
            }
        }
        if (!moved) {
            break;
        }
    }
    return dominators;
};

export interface FlowVisibleToken {
    cardId: string;
    token: FlowTokenDefinition;
}

/*
 * The tokens this card may use, in the order the run passes the cards that publish them. A card that
 * no trigger reaches sees nothing, because no run ever gets there.
 */
export const visibleTokens = (content: FlowContent, cardId: string): FlowVisibleToken[] => visibleFrom(content, dominatorsOf(content), cardId);

const visibleFrom = (content: FlowContent, dominators: Record<string, Set<string>>, cardId: string): FlowVisibleToken[] => {
    const mine = dominators[cardId];
    if (mine === undefined) {
        return [];
    }
    return [...mine]
        .filter((id) => id !== cardId)
        .sort((one, other) => {
            // The further from the trigger, the more cards dominate it: the count is the reading order.
            const depth = (dominators[one] as Set<string>).size - (dominators[other] as Set<string>).size;
            return depth === 0 ? one.localeCompare(other) : depth;
        })
        .flatMap((id) => tokensOf(content.cards[id]!).map((token) => ({ cardId: id, token })));
};

export interface FlowBrokenRef extends FlowTokenRef {
    /* The card whose text holds the reference. */
    on: string;
    arg: string;
}

/*
 * Every reference that cannot hold: one to a card that is gone, to a token that card does not publish,
 * or to a card that is not on every path here. The editor paints these red the moment a line changes.
 */
export const brokenTokenRefsIn = (content: FlowContent): FlowBrokenRef[] => {
    const broken: FlowBrokenRef[] = [];
    const dominators = dominatorsOf(content);
    for (const [id, card] of Object.entries(content.cards)) {
        const visible = visibleFrom(content, dominators, id);
        for (const arg of argsOf(card)) {
            const value = card.args[arg.name];
            if (arg.tokens !== true || typeof value !== 'string' || !argApplies(card, arg)) {
                continue;
            }
            for (const ref of parseTokenRefs(value)) {
                if (!visible.some((entry) => entry.cardId === ref.cardId && entry.token.name === ref.token)) {
                    broken.push({ ...ref, on: id, arg: arg.name });
                }
            }
        }
    }
    return broken;
};

import type { FlowCard, FlowContent } from '@ruimte/contracts';

const cardLine = (id: string, card: FlowCard): string => {
    const args = Object.keys(card.args)
        .sort()
        .map((name) => `${name}=${JSON.stringify(card.args[name])}`)
        .join('\u0001');
    return [id, card.kind, card.card ?? '', card.inverted === true ? 'inverted' : '', args].join('\u0000');
};

/*
 * The recipe as one text, in an order two machines agree on, with `x` and `y` left out.
 *
 * This is what the switch of a flow is hashed against, so moving a card leaves a running flow alone
 * and every change to what it actually does turns it off and asks again. Which of the two a change is
 * is not a judgement per card kind: such a list gets filled in wrong once, and then a flow keeps
 * running under a recipe nobody said yes to.
 */
export const recipeFingerprint = (content: FlowContent): string => {
    const cards = Object.keys(content.cards)
        .sort()
        .map((id) => cardLine(id, content.cards[id] as FlowCard));
    const links = content.links.map((link) => [link.from, link.fromPort, link.to].join('\u0000')).sort();
    return [`folder=${content.folder ?? ''}`, ...cards, '--', ...links].join('\n');
};

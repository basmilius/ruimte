import { flowCardDefinition, type FlowContent, type FlowLink, type FlowPort } from '@ruimte/contracts';
import { isCatalogCard, isTriggerCard, portsOf, takesInput } from './cards.ts';

export const linksFrom = (content: FlowContent, cardId: string, port?: FlowPort): FlowLink[] =>
    content.links.filter((link) => link.from === cardId && (port === undefined || link.fromPort === port));

export const linksTo = (content: FlowContent, cardId: string): FlowLink[] => content.links.filter((link) => link.to === cardId);

/* Every card a run could start at, in a fixed order so two machines walk the same worksheet alike. */
export const triggerIdsIn = (content: FlowContent): string[] =>
    Object.entries(content.cards)
        .filter(([, card]) => isTriggerCard(card))
        .map(([id]) => id)
        .sort();

/*
 * What is wrong with this recipe, as the sentence a refusal carries, or null when it is sound.
 *
 * A card whose catalog id this build does not know is not a problem: the catalog grows with every
 * release and a flow written by a newer one must still open, show and be written back. Such a card
 * refuses to run, in the timeline, rather than making the file unreadable.
 */
export const flowProblemIn = (content: FlowContent): string | null => {
    const seen = new Set<string>();
    for (const link of content.links) {
        const from = content.cards[link.from];
        const to = content.cards[link.to];
        if (from === undefined) {
            return `A line leaves card ${link.from}, which is not on the worksheet`;
        }
        if (to === undefined) {
            return `A line lands on card ${link.to}, which is not on the worksheet`;
        }
        if (!takesInput(to)) {
            return `A line lands on card ${link.to}, which takes nothing in`;
        }
        const known = !isCatalogCard(from) || (from.card !== undefined && flowCardDefinition(from.card) !== null);
        if (known && !portsOf(from).includes(link.fromPort)) {
            return `Card ${link.from} has no ${link.fromPort} port`;
        }
        const key = `${link.from}\u0000${link.fromPort}\u0000${link.to}`;
        if (seen.has(key)) {
            return `Card ${link.from} and card ${link.to} are joined twice by the same port`;
        }
        seen.add(key);
    }
    for (const [id, card] of Object.entries(content.cards)) {
        if (isCatalogCard(card) && card.card === undefined) {
            return `Card ${id} is a ${card.kind} without a card behind it`;
        }
    }
    return null;
};

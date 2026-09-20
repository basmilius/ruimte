import { flowCardDefinition, type FlowCard, type FlowCardSource } from '@ruimte/contracts';

/* A card about the graph itself has no source in the catalog, so it stands under its own name. */
export type FlowSourceKey = FlowCardSource | 'flow';

export const sourceOf = (card: FlowCard): FlowSourceKey => (card.card === undefined ? 'flow' : (flowCardDefinition(card.card)?.source ?? 'flow'));

/*
 * The plate the source icon sits in, one color per source. The shape of a card says what kind it is
 * and the color only says where its signal comes from, so a full worksheet reads before a word on it
 * does. Every one is a token from `styles.css` and nothing here holds a color of its own.
 */
const PLATE: Record<FlowSourceKey, string> = {
    time: 'bg-flow-source-time',
    files: 'bg-flow-source-files',
    text: 'bg-flow-source-text',
    chat: 'bg-flow-source-chat',
    person: 'bg-flow-source-person',
    flow: 'bg-flow-source-flow'
};

export const plateClass = (card: FlowCard): string => PLATE[sourceOf(card)];

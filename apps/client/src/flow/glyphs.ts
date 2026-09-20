import { Clock, FileText, GitMerge, MessageSquare, Play, Split, StickyNote, Timer, Type, User, Workflow, type LucideIcon } from 'lucide-react';
import { flowCardDefinition, type FlowCard, type FlowCardKind, type FlowCardSource } from '@ruimte/contracts';

/*
 * The mark of a card is where its signal comes from, never what kind of card it is: the kind is the
 * shape of the card, and drawing it twice would only take the room the source needs.
 */
const SOURCE_GLYPHS: Record<FlowCardSource, LucideIcon> = {
    time: Clock,
    files: FileText,
    text: Type,
    chat: MessageSquare,
    person: User
};

/* A card without a source says something about the graph itself, so it carries its own mark. */
const BUILT_IN_GLYPHS: Partial<Record<FlowCardKind, LucideIcon>> = {
    start: Play,
    delay: Timer,
    any: Split,
    all: GitMerge,
    note: StickyNote
};

export const cardGlyph = (kind: FlowCardKind, card: string | undefined): LucideIcon => {
    const builtIn = BUILT_IN_GLYPHS[kind];
    if (builtIn !== undefined) {
        return builtIn;
    }
    const source = card === undefined ? null : flowCardDefinition(card)?.source;
    return source === null || source === undefined ? Workflow : SOURCE_GLYPHS[source];
};

export const glyphOf = (card: FlowCard): LucideIcon => cardGlyph(card.kind, card.card);

import type { TFunction } from 'i18next';
import { flowCardDefinition, type FlowCard, type FlowContent } from '@ruimte/contracts';
import { argApplies, argsOf, numberArg, parseTokenRefs, textArg } from '@ruimte/flow';

/*
 * A card is `files.changed` in the catalog and `files_changed` in the words: a key reads a dot as a
 * step into the file, and a card id is one name.
 */
export const cardKey = (id: string): string => id.replace(/\./g, '_');

/* A piece of the sentence on a card: the words a person reads, and the values they filled in. */
export interface SentencePart {
    text: string;
    value: boolean;
    /* The field this piece stands for, so the editor can put its control in the sentence itself. */
    arg?: string;
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/*
 * The sentence of a card, split so the words and the values can be drawn apart. A value nobody filled
 * in reads as a placeholder rather than as a hole, so a card that is not finished says so.
 */
export const sentenceParts = (template: string, values: Readonly<Record<string, string>>, blank = '…'): SentencePart[] => {
    const parts: SentencePart[] = [];
    let at = 0;
    for (const match of template.matchAll(PLACEHOLDER)) {
        const index = match.index;
        if (index > at) {
            parts.push({ text: template.slice(at, index), value: false });
        }
        const name = match[1] as string;
        const filled = values[name] ?? '';
        parts.push({ text: filled === '' ? blank : filled, value: true, arg: name });
        at = index + match[0].length;
    }
    if (at < template.length) {
        parts.push({ text: template.slice(at), value: false });
    }
    return parts;
};

/* Where the words of this card live: its entry in the catalog, or the table of built-in cards. */
const keyOf = (card: FlowCard): string => (card.card === undefined ? `builtIn.${card.kind}` : `cards.${cardKey(card.card)}`);

export const cardLabel = (t: TFunction, card: FlowCard): string => t(`${keyOf(card)}.label`, { defaultValue: card.card ?? card.kind });

/*
 * What a card says above its sentence: where its signal comes from. The source is in the catalog, so
 * the words only have to name it, and a card without one is about the graph itself.
 */
export const cardSource = (t: TFunction, card: FlowCard): string => {
    const source = card.card === undefined ? null : flowCardDefinition(card.card)?.source;
    return t(`sources.${source ?? 'flow'}`);
};

/*
 * The number a card's sentence is written around, when it has one. "every 1 minutes" is not a
 * sentence, so the words are asked for in the plural of the number on the card. A card with no
 * number in it hands nothing over and reads the one form it has.
 */
export const countOf = (card: FlowCard): number | undefined => {
    const counted = argsOf(card).find((arg) => arg.type === 'number' && argApplies(card, arg));
    return counted === undefined ? undefined : numberArg(card, counted.name, 0);
};

/*
 * The sentence of a card, with the values it holds. A card with a choice among its fields reads a
 * sentence per choice, because "every day at 08:00" and "every 15 minutes" are not one sentence.
 */
export const cardSentence = (t: TFunction, content: FlowContent, card: FlowCard): SentencePart[] => {
    const choice = argsOf(card).find((arg) => arg.type === 'choice');
    const key = keyOf(card);
    /* The values are drawn as controls rather than written into the words, so the interpolation is
       ours; the count still goes in, because that is what picks the plural of the words. */
    const options = { defaultValue: '', skipInterpolation: true, count: countOf(card) };
    const variant = choice === undefined ? '' : t(`${key}.sentence_${textArg(card, choice.name)}`, options);
    const template = variant === '' ? t(`${key}.sentence`, options) : variant;
    const values = Object.fromEntries(argsOf(card).map((arg) => [arg.name, withTokenLabels(t, content, argValue(t, card, arg.name))]));
    return sentenceParts(String(template), values);
};

/* What a field holds, in the words a person picked it with. */
export const argValue = (t: TFunction, card: FlowCard, name: string): string => {
    const arg = argsOf(card).find((candidate) => candidate.name === name);
    const raw = textArg(card, name);
    if (arg?.type !== 'choice' || raw === '') {
        return raw;
    }
    return choiceLabel(t, card, raw, countOf(card));
};

export const argLabel = (t: TFunction, card: FlowCard, name: string): string => t(`${keyOf(card)}.args.${name}`, { defaultValue: name });

/* A choice a person reads, in the plural of the number beside it when the card carries one. */
export const choiceLabel = (t: TFunction, card: FlowCard, value: string, count?: number): string =>
    t(`${keyOf(card)}.choices.${value}`, { defaultValue: value, count });

/*
 * A text with its token references written out as the words they stand for. A person never reads
 * `@[card-a.content]` on a card: the editor puts what it means there, and the field behind it is
 * where the reference itself is edited.
 */
export const withTokenLabels = (t: TFunction, content: FlowContent, text: string): string => {
    let written = text;
    for (const ref of parseTokenRefs(text)) {
        const card = content.cards[ref.cardId];
        written = written.replaceAll(ref.text, card === undefined ? t('inspector.brokenToken') : tokenLabel(t, card, ref.token));
    }
    return written;
};

/* The name of a token as the card that publishes it calls it. */
export const tokenLabel = (t: TFunction, card: FlowCard, token: string): string => t(`${keyOf(card)}.tokens.${token}`, { defaultValue: token });

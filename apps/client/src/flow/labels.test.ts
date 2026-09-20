import { describe, expect, test } from 'bun:test';
import i18next from 'i18next';
import type { FlowCard, FlowContent } from '@ruimte/contracts';
import { tokenRef } from '@ruimte/flow';
import { cardLabel, cardSentence, cardSource, sentenceParts, withTokenLabels } from '@/flow/labels';

const t = i18next.getFixedT(null, 'flow');

const card = (over: Partial<FlowCard> & Pick<FlowCard, 'kind'>): FlowCard => ({ args: {}, x: 0, y: 0, ...over });

const flow = (cards: Record<string, FlowCard>): FlowContent => ({ cards, links: [] });

/* What a person reads on the card, with the values run together again. */
const reads = (content: FlowContent, id: string): string =>
    cardSentence(t, content, content.cards[id] as FlowCard)
        .map((part) => part.text)
        .join('');

describe('the sentence on a card', () => {
    test('reads as one line, with the values apart from the words', () => {
        const parts = sentenceParts('{{path}} changed', { path: 'README.md' });
        expect(parts).toEqual([
            { text: 'README.md', value: true, arg: 'path' },
            { text: ' changed', value: false }
        ]);
    });

    test('a value nobody filled in is a placeholder rather than a hole', () => {
        expect(sentenceParts('{{path}} changed', {})).toEqual([
            { text: '…', value: true, arg: 'path' },
            { text: ' changed', value: false }
        ]);
    });

    test('a card with a choice reads a sentence per choice', () => {
        const content = flow({
            daily: card({ kind: 'trigger', card: 'time.at', args: { every: 'day', at: '08:00' } }),
            often: card({ kind: 'trigger', card: 'time.at', args: { every: 'minutes', minutes: 15 } })
        });
        expect(reads(content, 'daily')).toBe('every day at 08:00');
        expect(reads(content, 'often')).toBe('every 15 minutes');
    });

    test('a token in a text reads as what it stands for, never as its plumbing', () => {
        const content = flow({
            trigger: card({ kind: 'trigger', card: 'files.changed', args: { path: 'README.md' } }),
            shout: card({ kind: 'action', card: 'person.notify', args: { text: `Look: ${tokenRef('trigger', 'content')}` } })
        });
        expect(reads(content, 'shout')).toBe('show Look: the text of the file');
    });

    test('a token whose card is gone says so rather than leaving the reference there', () => {
        expect(withTokenLabels(t, flow({}), `it said ${tokenRef('trigger', 'content')}`)).toBe('it said a token that is gone');
    });

    test('a value piece names the field it stands for, so a control can take its place', () => {
        expect(sentenceParts('{{text}} contains {{value}}', { text: 'a', value: 'b' }).map((part) => part.arg)).toEqual(['text', undefined, 'value']);
    });

    test('a card says what it is and where its signal comes from', () => {
        const changed = card({ kind: 'trigger', card: 'files.changed' });
        expect(cardLabel(t, changed)).toBe('A file changed');
        expect(cardSource(t, changed)).toBe('Files');
        expect(cardSource(t, card({ kind: 'delay' }))).toBe('Flow');
    });
});

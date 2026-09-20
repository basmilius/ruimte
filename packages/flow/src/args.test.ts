import { describe, expect, test } from 'bun:test';
import type { FlowCard, FlowContent } from '@ruimte/contracts';
import { argProblemsOf, cardHasProblem, firstEmptyArgOf, tokensForArg } from './args.ts';
import { argsOf } from './cards.ts';
import { tokenRef, tokenSegments } from './tokens.ts';

const card = (over: Partial<FlowCard> & Pick<FlowCard, 'kind'>): FlowCard => ({ args: {}, x: 0, y: 0, ...over });

const flow = (cards: Record<string, FlowCard>, links: FlowContent['links'] = []): FlowContent => ({ cards, links });

const argNamed = (subject: FlowCard, name: string) => argsOf(subject).find((arg) => arg.name === name)!;

describe('what is wrong with a field', () => {
    test('a field that is asked for and empty is missing, not invalid', () => {
        const content = flow({ watch: card({ kind: 'trigger', card: 'files.changed' }) });
        expect(argProblemsOf(content).watch).toEqual({ path: 'missing' });
    });

    test('a field that is filled in is nothing at all', () => {
        const content = flow({ watch: card({ kind: 'trigger', card: 'files.changed', args: { path: 'README.md' } }) });
        expect(argProblemsOf(content).watch).toBeUndefined();
    });

    test('a time that is not a time on the clock is invalid', () => {
        const content = flow({
            early: card({ kind: 'trigger', card: 'time.at', args: { every: 'day', at: '08:00' } }),
            never: card({ kind: 'trigger', card: 'time.at', args: { every: 'day', at: '25:00' } })
        });
        const problems = argProblemsOf(content);
        expect(problems.early).toBeUndefined();
        expect(problems.never).toEqual({ at: 'invalid' });
    });

    test('a choice outside the list the card offers is invalid', () => {
        const content = flow({ often: card({ kind: 'trigger', card: 'time.at', args: { every: 'fortnight' } }) });
        expect(argProblemsOf(content).often?.every).toBe('invalid');
    });

    test('a number field that holds words is invalid', () => {
        const content = flow({ wait: card({ kind: 'delay', args: { amount: 'soon', unit: 'seconds' } }) });
        expect(argProblemsOf(content).wait).toEqual({ amount: 'invalid' });
    });

    test('a field only asked for under another answer is left alone while that answer is elsewhere', () => {
        const content = flow({ often: card({ kind: 'trigger', card: 'time.at', args: { every: 'minutes', minutes: 15 } }) });
        // `at` is empty, but this card is on minutes and never reads it.
        expect(argProblemsOf(content).often).toBeUndefined();
    });

    test('a token that is not on every path here is invalid on the field that holds it', () => {
        const content = flow(
            {
                clock: card({ kind: 'trigger', card: 'time.at', args: { every: 'day', at: '08:00' } }),
                shout: card({ kind: 'action', card: 'person.notify', args: { text: `it said ${tokenRef('gone', 'content')}` } })
            },
            [{ from: 'clock', fromPort: 'done', to: 'shout' }]
        );
        expect(argProblemsOf(content).shout).toEqual({ text: 'invalid' });
    });

    test('a card with nothing wrong is not marked', () => {
        const content = flow({ watch: card({ kind: 'trigger', card: 'files.changed', args: { path: 'README.md' } }) });
        const problems = argProblemsOf(content);
        expect(cardHasProblem(problems, 'watch')).toBe(false);
        expect(cardHasProblem(argProblemsOf(flow({ watch: card({ kind: 'trigger', card: 'files.changed' }) })), 'watch')).toBe(true);
    });
});

describe('the field a new card opens on', () => {
    test('is the first one still waiting for an answer', () => {
        expect(firstEmptyArgOf(card({ kind: 'condition', card: 'text.contains' }))).toBe('text');
    });

    test('skips the ones that already carry their default', () => {
        // `every` and `at` come with a value, so the card opens on nothing at all.
        expect(firstEmptyArgOf(card({ kind: 'trigger', card: 'time.at', args: { every: 'day', at: '08:00' } }))).toBeNull();
    });

    test('is nothing on a card with no fields', () => {
        expect(firstEmptyArgOf(card({ kind: 'any' }))).toBeNull();
    });
});

describe('the tokens one field may use', () => {
    test('are none at all on a field that takes no tokens', () => {
        const message = card({ kind: 'action', card: 'chat.message' });
        const content = flow({ clock: card({ kind: 'trigger', card: 'time.at', args: { every: 'day', at: '08:00' } }), say: message }, [
            { from: 'clock', fromPort: 'done', to: 'say' }
        ]);
        expect(tokensForArg(content, 'say', argNamed(message, 'chat'))).toEqual([]);
        expect(tokensForArg(content, 'say', argNamed(message, 'text')).map((entry) => entry.token.name)).toEqual(['time', 'day']);
    });
});

describe('a text cut into what a field draws', () => {
    test('a reference is one piece, with the words around it apart from it', () => {
        expect(tokenSegments(`Look: ${tokenRef('trigger', 'content')}!`)).toEqual([
            { kind: 'text', text: 'Look: ' },
            { kind: 'token', cardId: 'trigger', token: 'content', text: '@[trigger.content]' },
            { kind: 'text', text: '!' }
        ]);
    });

    test('a text without a reference in it stays one piece', () => {
        expect(tokenSegments('plain words')).toEqual([{ kind: 'text', text: 'plain words' }]);
    });

    test('an empty text has no pieces at all', () => {
        expect(tokenSegments('')).toEqual([]);
    });

    test('two references next to each other stay two', () => {
        const text = `${tokenRef('a', 'one')}${tokenRef('b', 'two')}`;
        expect(tokenSegments(text).map((segment) => segment.kind)).toEqual(['token', 'token']);
    });
});

import { describe, expect, test } from 'bun:test';
import type { FlowRunStep } from '@ruimte/contracts';
import { cardResultsOf } from '@/flow/card-result';

const step = (over: Partial<FlowRunStep> & Pick<FlowRunStep, 'cardId' | 'at'>): FlowRunStep => over;

describe('what a card did in a run', () => {
    test('carries how long it took, the way out it chose and what it wrote down', () => {
        const results = cardResultsOf([step({ cardId: 'ask', at: 10, ms: 240, port: 'true', note: 'the file mentions it' })]);
        expect(results.ask).toEqual({ ms: 240, port: 'true', note: 'the file mentions it', dry: false, at: 10 });
    });

    test('a card that went nowhere says so by having no way out', () => {
        expect(cardResultsOf([step({ cardId: 'stop', at: 5 })]).stop?.port).toBeUndefined();
    });

    test('a card a run reached twice keeps the last time, which is the one being read', () => {
        const results = cardResultsOf([step({ cardId: 'wait', at: 1, note: 'waiting 30 s' }), step({ cardId: 'wait', at: 99, port: 'done', note: 'waited' })]);
        expect(results.wait?.note).toBe('waited');
        expect(results.wait?.port).toBe('done');
    });

    test('a step that was written down rather than carried out says which it was', () => {
        expect(cardResultsOf([step({ cardId: 'send', at: 2, dry: true })]).send?.dry).toBe(true);
        expect(cardResultsOf([step({ cardId: 'send', at: 2 })]).send?.dry).toBe(false);
    });

    test('a run that reached nothing leaves every card without a word', () => {
        expect(cardResultsOf([])).toEqual({});
    });
});

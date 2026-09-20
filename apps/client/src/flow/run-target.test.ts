import { describe, expect, test } from 'bun:test';
import type { FlowCard, FlowCardKind, FlowContent } from '@ruimte/contracts';
import { runTarget } from '@/flow/run-target';

const card = (kind: FlowCardKind, over: Partial<FlowCard> = {}): FlowCard => ({ kind, args: {}, x: 0, y: 0, ...over });

const flow = (cards: Record<string, FlowCard>): FlowContent => ({ cards, links: [] });

describe('which card running a flow by hand begins at', () => {
    test('the only trigger there is, with nothing picked', () => {
        expect(runTarget(flow({ one: card('trigger', { card: 'files.changed' }), act: card('action') }), [])).toBe('one');
    });

    test('the trigger a person picked, with several on the worksheet', () => {
        const content = flow({ one: card('trigger', { card: 'files.changed' }), two: card('start') });
        expect(runTarget(content, ['two'])).toBe('two');
    });

    test('nothing, with several triggers and none of them picked', () => {
        expect(runTarget(flow({ one: card('trigger', { card: 'files.changed' }), two: card('start') }), [])).toBeNull();
        expect(runTarget(flow({ one: card('trigger', { card: 'files.changed' }), two: card('start') }), ['one', 'two'])).toBeNull();
    });

    test('nothing, with a card picked that no run can begin at', () => {
        const content = flow({ one: card('trigger', { card: 'files.changed' }), two: card('start'), act: card('action') });
        expect(runTarget(content, ['act'])).toBeNull();
    });

    test('nothing at all on an empty worksheet', () => {
        expect(runTarget(flow({}), [])).toBeNull();
    });
});

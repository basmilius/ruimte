import { describe, expect, test } from 'bun:test';
import type { FlowCard, FlowCardKind, FlowContent, FlowLink, FlowPort } from '@ruimte/contracts';
import { flowLights } from '@/flow/live-look';
import type { FlowLiveRun } from '@/flow/use-live-run';

const card = (kind: FlowCardKind, over: Partial<FlowCard> = {}): FlowCard => ({ kind, args: {}, x: 0, y: 0, ...over });

const link = (from: string, fromPort: FlowPort, to: string): FlowLink => ({ from, fromPort, to });

/* A trigger into a condition, whose two ways out each end on an action of their own. */
const content: FlowContent = {
    cards: {
        trigger: card('trigger', { card: 'files.changed' }),
        check: card('condition', { card: 'text.contains' }),
        yes: card('action', { card: 'person.notify' }),
        no: card('action', { card: 'person.notify' })
    },
    links: [link('trigger', 'done', 'check'), link('check', 'true', 'yes'), link('check', 'false', 'no')]
};

const run = (settled: Record<string, FlowPort | null>, lastCard: string | null): FlowLiveRun => ({
    runId: 'run-1',
    entry: 'trigger',
    settled,
    waiting: [],
    steps: [],
    lastCard,
    lastAt: 1,
    over: false
});

describe('what a run going on right now does to the worksheet', () => {
    test('nothing at all while no run is going', () => {
        expect(flowLights(content, null)).toBeNull();
    });

    test('the branch that was not taken fades back, the one that was lights up', () => {
        const lights = flowLights(content, run({ trigger: 'done', check: 'true' }, 'check'));
        expect(lights?.cards).toEqual({ trigger: 'ran', check: 'ran', no: 'dead' });
        expect(lights?.links).toEqual({ 'trigger:done:check': 'live', 'check:true:yes': 'live', 'check:false:no': 'dead' });
        expect(lights?.pulse).toBe('check');
    });

    test('a card the run has not reached yet is neither lit nor faded', () => {
        const lights = flowLights(content, run({ trigger: 'done' }, 'trigger'));
        expect(lights?.cards.yes).toBeUndefined();
        expect(lights?.cards.no).toBeUndefined();
        expect(lights?.links['check:true:yes']).toBeUndefined();
    });

    test('a card that went nowhere takes every line out of it down', () => {
        const lights = flowLights(content, run({ trigger: 'done', check: null }, 'check'));
        expect(lights?.cards).toEqual({ trigger: 'ran', check: 'ran', yes: 'dead', no: 'dead' });
        expect(lights?.links['check:true:yes']).toBe('dead');
        expect(lights?.links['check:false:no']).toBe('dead');
    });
});

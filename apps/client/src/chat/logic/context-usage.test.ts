import { describe, expect, test } from 'bun:test';
import type { ModelOptionDescriptor } from '@ruimte/contracts';
import { contextSegments, orderOptions } from './context-usage';

const usage = { contextTokens: 412_000, contextWindow: 1_000_000, costUsd: 0, turns: 3 };

describe('contextSegments', () => {
    test('is null for a daemon that sends no breakdown, so the plain bar stays', () => {
        expect(contextSegments(usage)).toBeNull();
    });

    test('puts every part in the legend order, as a share of the window', () => {
        const segments = contextSegments({ ...usage, breakdown: { toolOutput: 180_000, filesRead: 142_000, conversation: 70_000, system: 20_000 } });
        expect(segments?.map((segment) => segment.part)).toEqual(['toolOutput', 'filesRead', 'conversation', 'system']);
        expect(segments?.[0]).toEqual({ part: 'toolOutput', tokens: 180_000, fraction: 0.18 });
        expect(segments?.reduce((sum, segment) => sum + segment.fraction, 0)).toBeCloseTo(0.412);
    });

    test('never runs past the end of the bar when the context outgrew its window', () => {
        const segments = contextSegments({
            ...usage,
            contextTokens: 2000,
            contextWindow: 1000,
            breakdown: { toolOutput: 1000, filesRead: 1000, conversation: 0, system: 0 }
        });
        expect(segments?.reduce((sum, segment) => sum + segment.fraction, 0)).toBe(1);
    });
});

describe('orderOptions', () => {
    const select = (id: string): ModelOptionDescriptor => ({ id, label: id, type: 'select', choices: [{ id: 'a', label: 'A' }], defaultChoice: 'a' });
    const toggle = (id: string): ModelOptionDescriptor => ({ id, label: id, type: 'boolean', defaultValue: false });

    test('puts the context window last, so a switch like Fast mode sits right under Reasoning', () => {
        expect(orderOptions([select('effort'), select('contextWindow'), toggle('fastMode')]).map((option) => option.id)).toEqual([
            'effort',
            'fastMode',
            'contextWindow'
        ]);
    });

    test('keeps the order of a model without a context window', () => {
        expect(orderOptions([select('effort'), toggle('serviceTier')]).map((option) => option.id)).toEqual(['effort', 'serviceTier']);
    });
});

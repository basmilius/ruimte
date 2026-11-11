import { describe, expect, test } from 'bun:test';
import type { BenchmarkLab } from '@ruimte/pulsar';
import { chartLabs, chartModels, costAxis, intelligenceAxis, modelMarks } from '@/models/chart';

function lab(id: string, light: string[], dark: string[]): BenchmarkLab {
    return { id, name: id, logo: { viewBox: '0 0 24 24', path: 'M0 0h24v24H0z' }, colors: { light, dark } };
}

const LABS = [lab('claude', ['#a00000', '#b00000', '#c00000'], ['#d00000', '#e00000', '#f00000']), lab('codex', ['#000a00'], ['#000b00'])];

function model(id: string, provider: string, legacy = false) {
    return { id, name: id, provider, legacy, points: [] };
}

describe('the axes', () => {
    test('a cost axis starts at zero and ends on a round number', () => {
        expect(costAxis([0.004, 7.63]).ticks).toEqual([0, 2, 4, 6, 8]);
    });

    test('the index runs in steps of ten around the scores', () => {
        expect(intelligenceAxis([20.9, 57.6]).ticks).toEqual([20, 30, 40, 50, 60]);
        expect(intelligenceAxis([50]).ticks).toEqual([50, 60]);
    });
});

describe('the marks', () => {
    test('uses partial measurements in canonical effort order and supports an older cached response', () => {
        const original = { ...model('haiku', 'claude'), points: [{ effort: 'max', intelligence: 42, costPerTask: 0.2 }] };
        expect(chartModels([original], LABS)[0]?.points).toEqual(original.points);
        const measurements = [
            { modelId: 'haiku', effort: 'max', intelligence: 42, costPerTask: 0.2 },
            { modelId: 'other', effort: 'low', intelligence: 12 },
            { modelId: 'haiku', effort: 'low', engineering: 0, outputSpeed: 120 }
        ];
        expect(chartModels([original], LABS, measurements)[0]?.points).toEqual([
            { effort: 'low', engineering: 0, outputSpeed: 120 },
            { effort: 'max', intelligence: 42, costPerTask: 0.2 }
        ]);
        expect(measurements[0]?.effort).toBe('max');
    });

    test("take the lab's colors per theme and keep current model colors stable when legacy models are listed", () => {
        const models = chartModels(
            [model('old', 'claude', true), model('opus', 'claude'), model('sonnet', 'claude'), model('sol', 'codex'), model('luna', 'codex')],
            LABS
        );
        const marks = modelMarks(models);
        expect(marks.get('opus')).toEqual({ color: 'light-dark(#a00000, #d00000)' });
        expect(marks.get('sonnet')).toEqual({ color: 'light-dark(#b00000, #e00000)' });
        expect(marks.get('old')).toEqual({ color: 'light-dark(#c00000, #f00000)' });
        expect(marks.get('sol')).toEqual({ color: 'light-dark(#000a00, #000b00)' });
        expect(marks.get('luna')).toEqual({ color: 'light-dark(#000a00, #000b00)' });
    });

    test('leave out a model whose lab the address book did not describe', () => {
        expect(chartModels([model('opus', 'claude'), model('other', 'someone')], LABS).map((entry) => entry.id)).toEqual(['opus']);
        expect(chartModels([model('opus', 'claude')], [])).toEqual([]);
    });

    test('list the labs in the order of the address book, only those with a model', () => {
        const labs = [lab('xai', ['#000000'], ['#ffffff']), ...LABS];
        expect(chartLabs(labs, chartModels([model('sol', 'codex'), model('opus', 'claude')], labs)).map((entry) => entry.id)).toEqual(['claude', 'codex']);
    });
});

import { describe, expect, test } from 'bun:test';
import type { ModelInfo, ModelOptionDescriptor } from '@ruimte/agent-contracts';
import { carryOptions, optionValue } from './model-options';

const EFFORT: ModelOptionDescriptor = {
    id: 'effort',
    label: 'Effort',
    type: 'select',
    choices: [
        { id: 'low', label: 'Low' },
        { id: 'high', label: 'High' }
    ],
    defaultChoice: 'high'
};
const FAST: ModelOptionDescriptor = { id: 'fast', label: 'Fast', type: 'boolean', defaultValue: true };

const modelWith = (options: ModelOptionDescriptor[]): ModelInfo => ({ slug: 'next', name: 'Next', legacy: false, isDefault: false, options });

describe('optionValue', () => {
    test('answers the picked value', () => {
        expect(optionValue(EFFORT, { effort: 'low' })).toBe('low');
        expect(optionValue(FAST, { fast: false })).toBe(false);
    });

    test('falls back on the model default when nothing or something foreign is picked', () => {
        expect(optionValue(EFFORT, {})).toBe('high');
        expect(optionValue(EFFORT, { effort: 'max' })).toBe('high');
        expect(optionValue(FAST, { fast: 'yes' })).toBe(true);
    });
});

describe('carryOptions', () => {
    test('keeps what the next model offers and drops the rest', () => {
        expect(carryOptions({ effort: 'low', fast: false, thinking: true }, modelWith([EFFORT, FAST]))).toEqual({ effort: 'low', fast: false });
    });

    test('drops a choice the next model does not have', () => {
        expect(carryOptions({ effort: 'max' }, modelWith([EFFORT]))).toEqual({});
    });

    test('carries nothing to a model it does not know', () => {
        expect(carryOptions({ effort: 'low' }, undefined)).toEqual({});
    });
});

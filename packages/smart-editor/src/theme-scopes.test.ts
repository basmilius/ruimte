import { describe, expect, test } from 'bun:test';
import { scopeColorsOf } from './theme-scopes.ts';

const colors = scopeColorsOf([
    { scope: 'entity.name', settings: { foreground: '#111111' } },
    { scope: ['entity.name.function'], settings: { foreground: '#222222', fontStyle: 'italic bold' } },
    { scope: 'meta.function-call entity.name.function', settings: { foreground: '#333333' } },
    { scope: 'variable', settings: { foreground: '#444444' } },
    { scope: 'variable.other', settings: { foreground: '#555555' } },
    { scope: 'variable.other', settings: { foreground: '#666666' } },
    { settings: { foreground: '#999999' } }
]);

describe('scopeColorsOf', () => {
    test('picks the rule with the longest matching name, and reads the font style', () => {
        expect(colors(['entity.name.function'])).toEqual({ color: '#222222', fontStyle: 3 });
        expect(colors(['entity.name.type'])).toEqual({ color: '#111111', fontStyle: 0 });
    });

    test('lets a selector with a parent beat the same name without one', () => {
        expect(colors(['meta.function-call', 'entity.name.function'])?.color).toBe('#333333');
        expect(colors(['meta.other', 'entity.name.function'])?.color).toBe('#222222');
    });

    test('lets a later rule beat an equal earlier one, and matches whole words of a name only', () => {
        expect(colors(['variable.other.property'])?.color).toBe('#666666');
        expect(colors(['variable'])?.color).toBe('#444444');
        expect(colors(['variables'])).toBeUndefined();
    });

    test('says nothing where no rule colors the scope', () => {
        expect(colors(['keyword'])).toBeUndefined();
        expect(colors([])).toBeUndefined();
    });
});

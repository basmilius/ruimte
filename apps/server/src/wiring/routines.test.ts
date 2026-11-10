import { describe, expect, test } from 'bun:test';
import { referenceNote, type Reference } from '../projects/references.ts';
import { continuedBrief } from './routines.ts';

const SKETCH: Reference = { id: 'sketch', kind: 'drawing', name: 'Sketch', canvas: null, sources: [] };
const lookup = (id: string): Reference | null => (id === SKETCH.id ? SKETCH : null);

describe('the brief of a run that continues its chat', () => {
    test('names the views the prompt points at, since a wake carries no message of the person', () => {
        expect(continuedBrief('publish it', { references: ['sketch', 'gone'] }, lookup)).toBe(`publish it\n\n${referenceNote([SKETCH])}`);
    });

    test('stays as it was without picks, and stays absent without a brief', () => {
        expect(continuedBrief('publish it', undefined, lookup)).toBe('publish it');
        expect(continuedBrief(undefined, { references: ['sketch'] }, lookup)).toBeUndefined();
    });
});

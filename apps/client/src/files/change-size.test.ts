import { describe, expect, test } from 'bun:test';
import type { ChangeSplit } from '@ruimte/contracts';
import { splitRows, splitSentence } from './change-size';

const NONE = { added: 0, deleted: 0 };

function split(patch: Partial<ChangeSplit>): ChangeSplit {
    return { code: NONE, tests: NONE, mocks: NONE, generated: NONE, ...patch };
}

describe('splitRows', () => {
    test('lists the kinds that hold lines, in their own order', () => {
        expect(splitRows(split({ generated: { added: 5, deleted: 5 }, code: { added: 10, deleted: 2 } }))).toEqual([
            { kind: 'code', label: 'Code', added: 10, deleted: 2 },
            { kind: 'generated', label: 'Generated', added: 5, deleted: 5 }
        ]);
    });
});

describe('splitSentence', () => {
    test('names each kind with its lines', () => {
        expect(splitSentence(split({ code: { added: 1200, deleted: 3 }, tests: { added: 40, deleted: 0 } }))).toBe('Code +1,200 -3 · Tests +40 -0');
    });

    test('says nothing when every line is code', () => {
        expect(splitSentence(split({ code: { added: 10, deleted: 2 } }))).toBeNull();
        expect(splitSentence(split({}))).toBeNull();
    });
});

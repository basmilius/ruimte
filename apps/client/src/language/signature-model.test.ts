import { describe, expect, test } from 'bun:test';
import { parameterSpan, signatureViewOf } from '@adecore/editor-react/models';

const signature = {
    label: 'scoreCandidate(candidate: Candidate, vacancy: Vacancy, options?: MatchOptions): number',
    parameters: [
        { label: 'candidate: Candidate' },
        { label: 'vacancy: Vacancy', documentation: { kind: 'markdown' as const, value: 'Vacancy to score against.' } },
        { label: [50, 73] as [number, number] }
    ]
};

describe('parameterSpan', () => {
    test('finds a label given as text, and takes one given as offsets', () => {
        expect(parameterSpan(signature, 1)).toEqual({ start: 37, end: 53 });
        expect(parameterSpan(signature, 2)).toEqual({ start: 50, end: 73 });
        expect(parameterSpan(signature, 9)).toBeNull();
    });
});

describe('signatureViewOf', () => {
    test('marks the active parameter and carries what is said about it', () => {
        const view = signatureViewOf({ signatures: [signature], activeParameter: 1 });
        expect(view).toMatchObject({
            active: { start: 37, end: 53 },
            parameterName: 'vacancy',
            parameterDocumentation: 'Vacancy to score against.',
            index: 0,
            count: 1
        });
    });

    test('picks the overload the server names, and says nothing for no signatures', () => {
        const other = { label: 'f(a)', parameters: [{ label: 'a' }] };
        expect(signatureViewOf({ signatures: [signature, other], activeSignature: 1 })?.label).toBe('f(a)');
        expect(signatureViewOf({ signatures: [] })).toBeNull();
        expect(signatureViewOf(null)).toBeNull();
    });

    test("lets a signature's own active parameter beat the one of the help", () => {
        expect(signatureViewOf({ signatures: [{ ...signature, activeParameter: 0 }], activeParameter: 2 })?.parameterName).toBe('candidate');
    });
});

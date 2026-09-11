import { describe, expect, test } from 'bun:test';
import { dropEndpoint, endpointKey, isOfEndpoint, splitKey } from '@/state/keys';

describe('an endpoint key', () => {
    test('names the machine before the id', () => {
        expect(endpointKey('local', 'term-a1b2c3d4')).toBe('local:term-a1b2c3d4');
    });

    test('splits on the first colon, so an id that carries one survives', () => {
        expect(splitKey('local:term-a1')).toEqual({ endpointId: 'local', id: 'term-a1' });
        expect(splitKey('Xk3p:view:with:colons')).toEqual({ endpointId: 'Xk3p', id: 'view:with:colons' });
    });

    test('reads a key without a machine as an id alone', () => {
        expect(splitKey('term-a1')).toEqual({ endpointId: '', id: 'term-a1' });
    });

    test('never mistakes one machine for another whose id starts the same', () => {
        expect(isOfEndpoint(endpointKey('Xk3p', 'n1'), 'Xk3')).toBe(false);
        expect(isOfEndpoint(endpointKey('Xk3', 'n1'), 'Xk3')).toBe(true);
    });
});

describe('dropping a machine', () => {
    test('keeps every row of the machines that stay', () => {
        const rows = { 'local:n1': 1, 'local:n2': 2, 'Xk3p:n1': 3 };
        expect(dropEndpoint(rows, 'local')).toEqual({ 'Xk3p:n1': 3 });
        expect(dropEndpoint(rows, 'Xk3p')).toEqual({ 'local:n1': 1, 'local:n2': 2 });
    });

    test('answers with a new object, so a store notices', () => {
        const rows = { 'local:n1': 1 };
        expect(dropEndpoint(rows, 'Xk3p')).not.toBe(rows);
    });

    test('leaves a machine that has no rows alone', () => {
        expect(dropEndpoint({ 'local:n1': 1 }, 'gone')).toEqual({ 'local:n1': 1 });
    });
});

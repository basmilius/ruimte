import { describe, expect, test } from 'bun:test';
import { hasLocalMachine, isRealMachine, listedEndpoints } from './local-machine';

const rows = [{ id: 'local' }, { id: 'studio' }, { id: 'attic' }];

describe('the machine that served the page', () => {
    test('is a machine wherever a daemon serves the page, and not on the web client', () => {
        expect(hasLocalMachine(false)).toBe(true);
        expect(hasLocalMachine(true)).toBe(false);
    });

    test('is listed with the rest where it is a machine', () => {
        expect(listedEndpoints(rows, true).map((row) => row.id)).toEqual(['local', 'studio', 'attic']);
    });

    test('is left out of every list on the web client, the other rows keeping their order', () => {
        expect(listedEndpoints(rows, false).map((row) => row.id)).toEqual(['studio', 'attic']);
    });

    test('never counts as a picked machine on the web client', () => {
        expect(isRealMachine('local', false)).toBe(false);
        expect(isRealMachine('studio', false)).toBe(true);
        expect(isRealMachine('local', true)).toBe(true);
    });
});

import { describe, expect, test } from 'bun:test';
import { usageEndpointFor } from './picker';

describe('which machine the usage page is about', () => {
    const known = ['local', 'pi'];

    test('the workspace machine until one is picked', () => {
        expect(usageEndpointFor(null, known, 'local')).toBe('local');
    });

    test('the picked machine, which is the point of picking one', () => {
        expect(usageEndpointFor('pi', known, 'local')).toBe('pi');
    });

    test('the picked machine holds even when the workspace moves to another', () => {
        expect(usageEndpointFor('pi', known, 'laptop')).toBe('pi');
    });

    test('a machine this client no longer knows hands the page back to the workspace', () => {
        expect(usageEndpointFor('gone', known, 'local')).toBe('local');
    });
});

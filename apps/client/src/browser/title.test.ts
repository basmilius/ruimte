import { describe, expect, test } from 'bun:test';
import { browserDisplayTitle } from './title';

describe('browserDisplayTitle', () => {
    test('uses the client page title while the shared title is automatic', () => {
        expect(browserDisplayTitle('Browser', 'auto', 'Documentation – Ruimte')).toBe('Documentation – Ruimte');
    });

    test('keeps a title the person chose', () => {
        expect(browserDisplayTitle('Reference', 'user', 'Documentation – Ruimte')).toBe('Reference');
    });

    test('keeps the shared fallback for empty and failed pages', () => {
        expect(browserDisplayTitle('Browser', undefined, '')).toBe('Browser');
        expect(browserDisplayTitle('Browser', undefined, 'This site cannot be reached', true)).toBe('Browser');
    });

    test('does not leak a previously shared automatic page title into a fresh client session', () => {
        expect(browserDisplayTitle('Old page on another client', 'auto', '')).toBe('Browser');
    });
});

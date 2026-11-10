import { describe, expect, test } from 'bun:test';
import { isPathSegment } from './path-segment.ts';

describe('isPathSegment', () => {
    test('accepts the ids and names this machine makes', () => {
        for (const value of ['chat-1a2b3c', '0b6f2c1e-1111-4222-8333-444455556666', 'notes.md', '.env']) {
            expect(isPathSegment(value)).toBe(true);
        }
    });

    test('refuses anything that leaves the folder or names none', () => {
        for (const value of ['', '.', '..', '../..', '../../etc', 'a/b', 'a\\b', 'a\0b', '/etc', 'x..y']) {
            expect(isPathSegment(value)).toBe(false);
        }
    });
});

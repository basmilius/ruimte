import { describe, expect, test } from 'bun:test';
import { contextChunks, MAX_APPEND_BYTES } from './chunks.ts';

describe('context chunks', () => {
    test('stay under the append bound in UTF-8 bytes and never split a character', () => {
        const text = 'é日🎙️'.repeat(200);
        const chunks = contextChunks(text);
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.every((chunk) => new TextEncoder().encode(chunk).length <= MAX_APPEND_BYTES)).toBe(true);
        expect(chunks.join('')).toBe(text);
        expect(chunks.every((chunk) => !chunk.includes('�'))).toBe(true);
    });

    test('an empty text is no chunk', () => {
        expect(contextChunks('')).toEqual([]);
    });
});

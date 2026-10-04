import { describe, expect, test } from 'bun:test';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';
import { LANGUAGE_METHODS, LanguageDocumentChangePayloadSchema, LanguageRequestPayloadSchema } from './language.ts';

describe('language wire', () => {
    test('every method a client may ask is a request the schemas accept, and nothing else is', () => {
        const base = { projectId: 'p', path: 'src/a.ts', params: { position: { line: 0, character: 0 } } };
        for (const method of LANGUAGE_METHODS) {
            expect(LanguageRequestPayloadSchema.safeParse({ ...base, method }).success).toBe(true);
        }
        expect(LanguageRequestPayloadSchema.safeParse({ ...base, method: 'workspace/executeCommand' }).success).toBe(false);
        expect(LanguageRequestPayloadSchema.safeParse({ ...base, method: 'textDocument/hover', version: 0 }).success).toBe(false);
    });

    test('a change names its base version and carries at least one entry', () => {
        const change = { projectId: 'p', path: 'a.ts', baseVersion: 1, changes: [{ text: 'x' }] };
        expect(LanguageDocumentChangePayloadSchema.safeParse(change).success).toBe(true);
        expect(LanguageDocumentChangePayloadSchema.safeParse({ ...change, changes: [] }).success).toBe(false);
        expect(LanguageDocumentChangePayloadSchema.safeParse({ ...change, baseVersion: undefined }).success).toBe(false);
    });

    test('the requests and events are in the tables', () => {
        expect(Object.keys(REQUEST_SCHEMAS).filter((type) => type.startsWith('language.'))).toHaveLength(10);
        expect(Object.keys(EVENT_SCHEMAS).filter((type) => type.startsWith('language.'))).toHaveLength(4);
    });
});

import { describe, expect, test } from 'bun:test';
import { askedKey, summaryPayload } from './usage';

describe('the summary question', () => {
    test('a picked account is part of what was asked', () => {
        const now = new Date(2026, 8, 25, 12);
        expect(summaryPayload('7d', 'claude_work', now).accounts).toEqual(['claude_work']);
        expect(summaryPayload('7d', null, now).accounts).toBeUndefined();
        expect(askedKey(summaryPayload('7d', 'claude_work', now))).not.toBe(askedKey(summaryPayload('7d', null, now)));
    });
});

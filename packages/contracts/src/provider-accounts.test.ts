import { describe, expect, test } from 'bun:test';
import { ProviderAccountIdSchema, ProviderAccountsSavePayloadSchema } from './provider-accounts.ts';

describe('provider accounts', () => {
    test('an id is a slug and never a path', () => {
        expect(ProviderAccountIdSchema.safeParse('claude').success).toBe(true);
        expect(ProviderAccountIdSchema.safeParse('claude_personal-2').success).toBe(true);
        expect(ProviderAccountIdSchema.safeParse('Claude').success).toBe(false);
        expect(ProviderAccountIdSchema.safeParse('../claude').success).toBe(false);
        expect(ProviderAccountIdSchema.safeParse('2claude').success).toBe(false);
        expect(ProviderAccountIdSchema.safeParse(`a${'b'.repeat(64)}`).success).toBe(false);
    });

    test('a kind this version does not know still parses', () => {
        const parsed = ProviderAccountsSavePayloadSchema.parse({ accounts: { cursor: { kind: 'cursor', home: '~/.cursor' } } });
        expect(parsed.accounts.cursor).toEqual({ kind: 'cursor', home: '~/.cursor' });
    });
});

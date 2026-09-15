import { describe, expect, test } from 'bun:test';
import { forgetLink, linkRequestOf, linkStep, rememberLink, rememberedLink, typedCode } from './link-request';
import type { LoginStorage } from './web';

const memoryStorage = (): LoginStorage & { items: Map<string, string> } => {
    const items = new Map<string, string>();
    return {
        items,
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => {
            items.set(key, value);
        },
        removeItem: (key) => {
            items.delete(key);
        }
    };
};

describe('the /link address', () => {
    test('carries the code as the terminal printed it, or none', () => {
        expect(linkRequestOf('/link', '?code=BCDF-GHJK')).toEqual({ code: 'BCDF-GHJK' });
        expect(linkRequestOf('/link/', '?code=bcdfghjk')).toEqual({ code: 'BCDF-GHJK' });
        expect(linkRequestOf('/link', '')).toEqual({ code: null });
        expect(linkRequestOf('/', '?code=BCDF-GHJK')).toBeNull();
        expect(linkRequestOf('/pulsar/callback', '?code=abc')).toBeNull();
    });
});

describe('a remembered link', () => {
    test('outlives the round trip to GitHub, and not the code it carries', () => {
        const storage = memoryStorage();
        rememberLink(storage, 'BCDF-GHJK', 1_000);
        expect(rememberedLink(storage, 1_000 + 60_000)).toEqual({ code: 'BCDF-GHJK', openedAt: 1_000 });
        expect(rememberedLink(storage, 1_000 + 11 * 60_000)).toBeNull();
        expect(storage.items.size).toBe(0);
    });

    test('is gone once forgotten, and a broken entry reads as none', () => {
        const storage = memoryStorage();
        rememberLink(storage, null, 1_000);
        forgetLink(storage);
        expect(rememberedLink(storage, 1_000)).toBeNull();
        storage.setItem('ruimte.pulsar.pendingLink', '{not json');
        expect(rememberedLink(storage, 1_000)).toBeNull();
    });
});

describe('typing a code', () => {
    test('is shaped like the terminal prints it', () => {
        expect(typedCode('bcd')).toBe('BCD');
        expect(typedCode('bcdf')).toBe('BCDF');
        expect(typedCode('bcdfg')).toBe('BCDF-G');
        expect(typedCode('BCDF - GHJK')).toBe('BCDF-GHJK');
        expect(typedCode('BCDFGHJKLM')).toBe('BCDF-GHJK');
        expect(typedCode('12ab')).toBe('AB');
    });
});

describe('the step of the dialog', () => {
    test('an outcome stands above everything, then the account, then the code', () => {
        expect(linkStep({ accountStatus: 'signed-out', lookedUp: false, outcome: 'added' })).toBe('added');
        expect(linkStep({ accountStatus: 'signed-in', lookedUp: true, outcome: 'denied' })).toBe('denied');
        expect(linkStep({ accountStatus: 'unavailable', lookedUp: false, outcome: null })).toBe('unavailable');
        expect(linkStep({ accountStatus: 'signed-out', lookedUp: true, outcome: null })).toBe('sign-in');
        expect(linkStep({ accountStatus: 'loading', lookedUp: false, outcome: null })).toBe('signing-in');
        expect(linkStep({ accountStatus: 'signed-in', lookedUp: false, outcome: null })).toBe('enter-code');
        expect(linkStep({ accountStatus: 'signed-in', lookedUp: true, outcome: null })).toBe('confirm');
    });
});

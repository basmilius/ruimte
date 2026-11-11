import '../../../apps/client/testing/pets-load';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { storage } from '@ruimte/extension/client';
import { movedFromBefore, PETS_IN_APP_SETTINGS } from './moved-storage';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let items = new Map<string, string>();

// The unit run has no storage of its own.
beforeEach(() => {
    items = new Map();
    const fake = {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key)
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fake });
});

afterEach(() => {
    if (original === undefined) {
        Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
        Object.defineProperty(globalThis, 'localStorage', original);
    }
});

describe('what pets kept before they ran on the extension API', () => {
    test('moves once into the extension storage, and the old key goes', () => {
        items.set('ruimte.pets', JSON.stringify({ pets: true }));

        movedFromBefore('ruimte.pets', 'settings');

        expect(storage.get('settings')).toEqual({ pets: true });
        expect(items.has('ruimte.pets')).toBe(false);
    });

    test('leaves a key alone that was already moved', () => {
        storage.set('settings', { pets: false });
        items.set('ruimte.pets', JSON.stringify({ pets: true }));

        movedFromBefore('ruimte.pets', 'settings');

        expect(storage.get('settings')).toEqual({ pets: false });
        expect(items.has('ruimte.pets')).toBe(true);
    });

    test('from before pets had a key, are copied out of the app settings, which stay as they were', () => {
        const app = JSON.stringify({ theme: 'dark', pets: true, petsSets: ['cats'], petsVisitor: false });
        items.set('ruimte.settings', app);

        movedFromBefore('ruimte.pets', 'settings', PETS_IN_APP_SETTINGS);

        expect(storage.get('settings')).toEqual({ pets: true, petsSets: ['cats'], petsVisitor: false });
        expect(items.get('ruimte.settings')).toBe(app);
    });

    test('from their own key win over the app settings', () => {
        items.set('ruimte.pets', JSON.stringify({ pets: false }));
        items.set('ruimte.settings', JSON.stringify({ pets: true }));

        movedFromBefore('ruimte.pets', 'settings', PETS_IN_APP_SETTINGS);

        expect(storage.get('settings')).toEqual({ pets: false });
    });
});

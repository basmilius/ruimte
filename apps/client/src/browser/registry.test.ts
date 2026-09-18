import { describe, expect, test } from 'bun:test';
import { setInitialWebviewUrl } from './registry';

describe('setInitialWebviewUrl', () => {
    test('sets the source as an attribute before Electron connects the custom element', () => {
        const attributes = new Map<string, string>();
        const element = { setAttribute: (name: string, value: string) => attributes.set(name, value) };

        expect(setInitialWebviewUrl(element, 'tweakers.net')).toBe('https://tweakers.net');
        expect(attributes.get('src')).toBe('https://tweakers.net');
    });
});

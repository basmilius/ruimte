import { describe, expect, test } from 'bun:test';
import { setInitialWebviewUrl, swipeHistoryOf, useBrowser } from './registry';

describe('setInitialWebviewUrl', () => {
    test('sets the source as an attribute before Electron connects the custom element', () => {
        const attributes = new Map<string, string>();
        const element = { setAttribute: (name: string, value: string) => attributes.set(name, value) };

        expect(setInitialWebviewUrl(element, 'tweakers.net')).toBe('https://tweakers.net');
        expect(attributes.get('src')).toBe('https://tweakers.net');
    });
});

describe('swipeHistoryOf', () => {
    test('reads the history the navigation events left in the store', () => {
        useBrowser.getState().patch('page', { canGoBack: true, canGoForward: false });

        expect(swipeHistoryOf('page')).toEqual({ canGoBack: true, canGoForward: false });

        useBrowser.getState().forget('page');
    });

    test('a page the store does not know goes nowhere', () => {
        expect(swipeHistoryOf('unknown')).toEqual({ canGoBack: false, canGoForward: false });
    });
});

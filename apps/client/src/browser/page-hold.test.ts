import { describe, expect, test } from 'bun:test';
import { pageStateOf } from './page-hold';
import type { BrowserState } from './registry';

const row = (patch: Partial<BrowserState> = {}): BrowserState => ({
    url: 'https://example.com',
    title: 'Example',
    loading: false,
    canGoBack: true,
    canGoForward: false,
    favicon: 'data:image/png;base64,AA==',
    error: null,
    streamError: null,
    streamId: null,
    ...patch
});

describe('pageStateOf', () => {
    test('what the machine is told about a page is the page, not what this client draws it with', () => {
        expect(pageStateOf('page-1', row())).toEqual({
            browserId: 'page-1',
            url: 'https://example.com',
            title: 'Example',
            loading: false,
            canGoBack: true,
            canGoForward: false,
            error: null
        });
    });

    test('a load that failed travels as the sentence the browser gave it, with its code', () => {
        const failed = pageStateOf('page-1', row({ error: { url: 'https://example.com', code: -105, description: 'ERR_NAME_NOT_RESOLVED' } }));
        expect(failed.error).toBe('ERR_NAME_NOT_RESOLVED (-105)');
    });

    test('a page rendered on the machine fails without a code, and that sentence travels too', () => {
        expect(pageStateOf('page-1', row({ streamError: 'The machine stopped drawing this page' })).error).toBe('The machine stopped drawing this page');
    });
});

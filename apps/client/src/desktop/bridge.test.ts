import { afterEach, describe, expect, test } from 'bun:test';
import { openInSystemBrowser } from './bridge';

afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
});

describe('the system browser', () => {
    test('asks the desktop shell, and opens no tab, when this app is one', () => {
        const opened: string[] = [];
        const tabs: string[] = [];

        Object.assign(globalThis, {
            window: {
                ruimteDesktop: {
                    openExternal: async (url: string) => {
                        opened.push(url);
                    }
                },
                open: (url: string) => {
                    tabs.push(url);
                    return null;
                }
            }
        });

        openInSystemBrowser('https://example.com/docs');

        expect(opened).toEqual(['https://example.com/docs']);
        expect(tabs).toEqual([]);
    });

    test('opens a tab when there is no desktop shell', () => {
        const tabs: Array<{ url: string; target: string; features: string }> = [];

        Object.assign(globalThis, {
            window: {
                open: (url: string, target: string, features: string) => {
                    tabs.push({ url, target, features });
                    return null;
                }
            }
        });

        openInSystemBrowser('https://example.com/docs');

        expect(tabs).toEqual([{ url: 'https://example.com/docs', target: '_blank', features: 'noopener,noreferrer' }]);
    });
});

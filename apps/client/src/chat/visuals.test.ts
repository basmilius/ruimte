import { describe, expect, test } from 'bun:test';
import { visualHostFor } from './visuals';

function host(bridge: { openExternal(url: string): Promise<void> } | null) {
    const tabs: string[] = [];
    return {
        tabs,
        host: visualHostFor(
            'https://station.ruimte.app',
            () => bridge,
            (url) => tabs.push(url)
        )
    };
}

describe('the visuals of a thread', () => {
    test("are drawn in the host page on the page's own origin, wherever it is served", () => {
        expect(
            visualHostFor(
                'https://station.ruimte.app',
                () => null,
                () => undefined
            ).frameUrl
        ).toBe('https://station.ruimte.app/__visual/');
        expect(
            visualHostFor(
                'http://localhost:4212',
                () => null,
                () => undefined
            ).frameUrl
        ).toBe('http://localhost:4212/__visual/');
        expect(
            visualHostFor(
                'app://ruimte',
                () => null,
                () => undefined
            ).frameUrl
        ).toBe('app://ruimte/__visual/');
    });

    test('open a link in the system browser on the desktop', () => {
        const opened: string[] = [];
        const { tabs, host: desktop } = host({
            openExternal: async (url) => {
                opened.push(url);
            }
        });
        desktop.openLink('https://example.com/docs');
        expect(opened).toEqual(['https://example.com/docs']);
        expect(tabs).toEqual([]);
    });

    test('and in a tab of its own anywhere else', () => {
        const { tabs, host: web } = host(null);
        web.openLink('http://example.com/');
        expect(tabs).toEqual(['http://example.com/']);
    });

    test('never open anything but the web', () => {
        const opened: string[] = [];
        const { tabs, host: desktop } = host({
            openExternal: async (url) => {
                opened.push(url);
            }
        });
        const { tabs: webTabs, host: web } = host(null);
        for (const url of ['javascript:alert(1)', 'file:///etc/hosts', 'data:text/html,x', '/__visual/', 'mailto:a@example.com']) {
            desktop.openLink(url);
            web.openLink(url);
        }
        expect(opened).toEqual([]);
        expect(tabs).toEqual([]);
        expect(webTabs).toEqual([]);
    });
});

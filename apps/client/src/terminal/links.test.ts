import { describe, expect, test } from 'bun:test';
import { isTerminalLinkClick, openTerminalLink, terminalLinkTarget } from './links';

const click = { button: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

describe('terminal link activation', () => {
    test('requires only the platform modifier and the primary button', () => {
        for (const apple of [true, false]) {
            const active = { ...click, metaKey: apple, ctrlKey: !apple };
            expect(isTerminalLinkClick(active, apple)).toBe(true);
            for (const other of [
                click,
                { ...active, button: 1 },
                { ...active, button: 2 },
                { ...active, altKey: true },
                { ...active, shiftKey: true },
                { ...active, metaKey: true, ctrlKey: true }
            ]) {
                expect(isTerminalLinkClick(other, apple)).toBe(false);
            }
        }
    });

    test('rejects non-web targets without opening either route', () => {
        for (const uri of [
            'javascript:alert(1)',
            'file:///tmp/file',
            'data:text/html,test',
            'mailto:me@example.org',
            '//example.org',
            'https://',
            'https://exa\nmple.org',
            ' https://example.org'
        ]) {
            expect(terminalLinkTarget(uri, 'local', true)).toBe('invalid');
            openTerminalLink(uri, 'local', {
                unavailable: () => {
                    throw new Error('unexpected notice');
                },
                bridge: {
                    openExternal: async () => {
                        throw new Error('opened desktop');
                    }
                },
                openTab: () => {
                    throw new Error('opened browser');
                },
                openInRuimte: () => {
                    throw new Error('opened in Ruimte');
                }
            });
        }
    });

    test('loopback and bind addresses belong to the terminal machine', () => {
        for (const host of [
            'localhost',
            'LOCALHOST.',
            'app.localhost',
            '127.0.0.1',
            '127.2.3.4',
            '127.1',
            '2130706433',
            '0x7f000001',
            '[::1]',
            '[0:0:0:0:0:0:0:1]',
            '[::ffff:127.0.0.1]',
            '0.0.0.0',
            '[::]'
        ]) {
            const uri = `http://${host}:5173`;
            expect(terminalLinkTarget(uri, 'local', true)).toBe('web');
            expect(terminalLinkTarget(uri, 'remote', true)).toBe('remote-loopback');
            expect(terminalLinkTarget(uri, 'local', false)).toBe('remote-loopback');
        }
        expect(terminalLinkTarget('https://localhost.example.org', 'remote', true)).toBe('web');
    });

    test('routing keeps the exact URL and the supplied owner', () => {
        const uri = 'https://example.org/a%2Fb?value=%0A&x=1#target';
        const desktop: string[] = [];
        const browser: string[] = [];
        let notices = 0;
        const bridge = {
            openExternal: async (url: string) => {
                desktop.push(url);
            }
        };
        const unavailable = (): void => {
            notices++;
        };
        const openTab = (url: string): void => {
            browser.push(url);
        };
        openTerminalLink(uri, 'remote', { unavailable, bridge, openTab });
        openTerminalLink(uri, 'remote', { unavailable, bridge: null, openTab });
        openTerminalLink('http://localhost:5173', 'remote', { unavailable, bridge, openTab });
        expect(desktop).toEqual([uri]);
        expect(browser).toEqual([uri]);
        expect(notices).toBe(1);
    });

    test('the internal destination keeps validation and opens only one route', () => {
        const inside: string[] = [];
        const outside: string[] = [];
        let notices = 0;
        let available = true;
        const routes = {
            unavailable: () => {
                notices++;
            },
            openInRuimte: (uri: string) => {
                if (available) {
                    inside.push(uri);
                }
                return available;
            },
            bridge: {
                openExternal: async (uri: string) => {
                    outside.push(uri);
                }
            },
            openTab: (uri: string) => {
                outside.push(uri);
            }
        };
        const uri = 'https://example.org/a%2Fb?value=%0A&x=1#target';
        openTerminalLink(uri, 'remote', routes);
        openTerminalLink(uri, 'remote', { ...routes, bridge: null });
        openTerminalLink('http://localhost:5173', 'remote', routes);
        openTerminalLink('http://localhost:5173', 'local', { ...routes, bridge: null });
        expect(inside).toEqual([uri, uri]);
        expect(outside).toEqual([]);
        expect(notices).toBe(2);
        available = false;
        openTerminalLink(uri, 'remote', routes);
        openTerminalLink(uri, 'remote', { ...routes, bridge: null });
        expect(outside).toEqual([uri, uri]);
    });
});

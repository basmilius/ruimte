import { describe, expect, test } from 'bun:test';
import {
    allowGuestPermission,
    appSubframeNavigation,
    appWindowNavigation,
    hardenGuestPreferences,
    isAppSender,
    isExternalLink,
    originOf,
    type GuestWebPreferences
} from './web-guards';

const APP = 'http://127.0.0.1:4210';
const DEV = 'http://localhost:5173';

describe('originOf', () => {
    test('reads the origin of a web address and nothing else', () => {
        expect(originOf('http://127.0.0.1:4210/some/view?x=1')).toBe(APP);
        expect(originOf('about:blank')).toBeNull();
        expect(originOf('data:text/html,<p>hi</p>')).toBeNull();
        expect(originOf('not a url')).toBeNull();
    });
});

describe('appWindowNavigation', () => {
    test('keeps the app in its window, the dev server included', () => {
        expect(appWindowNavigation('http://127.0.0.1:4210/', APP)).toBe('allow');
        expect(appWindowNavigation('http://127.0.0.1:4210/link?code=abc', APP)).toBe('allow');
        expect(appWindowNavigation('http://localhost:5173/', DEV)).toBe('allow');
    });

    test('sends a dropped web link to the system browser', () => {
        expect(appWindowNavigation('https://example.com/', APP)).toBe('external');
        expect(appWindowNavigation('http://example.com/', APP)).toBe('external');
    });

    test('a port or host that only looks like the app is another site', () => {
        expect(appWindowNavigation('http://127.0.0.1:4211/', APP)).toBe('external');
        expect(appWindowNavigation('http://localhost:4210/', APP)).toBe('external');
        expect(appWindowNavigation('https://127.0.0.1:4210/', APP)).toBe('external');
    });

    test('refuses a dropped file and every other scheme', () => {
        expect(appWindowNavigation('file:///Users/someone/page.html', APP)).toBe('refuse');
        expect(appWindowNavigation('data:text/html,<script>1</script>', APP)).toBe('refuse');
        expect(appWindowNavigation('javascript:alert(1)', APP)).toBe('refuse');
        expect(appWindowNavigation('mailto:someone@example.com', APP)).toBe('refuse');
        expect(appWindowNavigation('about:blank', APP)).toBe('refuse');
    });
});

describe('appSubframeNavigation', () => {
    test('a frame inside the app stays on the app or on an empty document', () => {
        expect(appSubframeNavigation('http://127.0.0.1:4210/frame', APP)).toBe('allow');
        expect(appSubframeNavigation('about:blank', APP)).toBe('allow');
        expect(appSubframeNavigation('about:srcdoc', APP)).toBe('allow');
    });

    test('and never leaves for the system browser', () => {
        expect(appSubframeNavigation('https://example.com/', APP)).toBe('refuse');
        expect(appSubframeNavigation('file:///etc/hosts', APP)).toBe('refuse');
    });
});

describe('isAppSender', () => {
    const top = { url: `${APP}/`, parent: null };

    test('the top frame of the app window on the app origin', () => {
        expect(isAppSender(true, top, APP)).toBe(true);
    });

    test('not another web contents, whatever it loaded', () => {
        expect(isAppSender(false, top, APP)).toBe(false);
    });

    test('not the app window once it was navigated somewhere else', () => {
        expect(isAppSender(true, { url: 'https://example.com/', parent: null }, APP)).toBe(false);
        expect(isAppSender(true, { url: 'file:///tmp/dropped.html', parent: null }, APP)).toBe(false);
    });

    test('not a frame inside the app, nor a frame that is gone', () => {
        expect(isAppSender(true, { url: `${APP}/`, parent: top }, APP)).toBe(false);
        expect(isAppSender(true, null, APP)).toBe(false);
    });
});

describe('allowGuestPermission', () => {
    test('a page gets fullscreen, pointer lock and writing to the clipboard', () => {
        expect(allowGuestPermission('fullscreen')).toBe(true);
        expect(allowGuestPermission('pointerLock')).toBe(true);
        expect(allowGuestPermission('clipboard-sanitized-write')).toBe(true);
    });

    test('and nothing else, the microphone and opening another app among them', () => {
        for (const permission of [
            'media',
            'clipboard-read',
            'notifications',
            'geolocation',
            'openExternal',
            'hid',
            'usb',
            'serial',
            'display-capture',
            'midiSysex'
        ]) {
            expect(allowGuestPermission(permission)).toBe(false);
        }
    });
});

describe('isExternalLink', () => {
    test('web and mail links leave for the system, a file or an app never does', () => {
        expect(isExternalLink('https://example.com/')).toBe(true);
        expect(isExternalLink('HTTP://example.com/')).toBe(true);
        expect(isExternalLink('mailto:someone@example.com')).toBe(true);
        expect(isExternalLink('file:///Applications/Calculator.app')).toBe(false);
        expect(isExternalLink('ssh://host')).toBe(false);
        expect(isExternalLink('javascript:alert(1)')).toBe(false);
    });
});

describe('hardenGuestPreferences', () => {
    test('strips a preload and Node from a browser node or a preview', () => {
        for (const partition of ['persist:ruimte', 'preview']) {
            const preferences: GuestWebPreferences = {
                partition,
                preload: '/tmp/evil.js',
                nodeIntegration: true,
                nodeIntegrationInSubFrames: true,
                contextIsolation: false,
                sandbox: false
            };
            expect(hardenGuestPreferences(preferences)).toBe(true);
            expect(preferences).toEqual({ partition, nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true });
        }
    });

    test("refuses any other session, the app window's own among them", () => {
        expect(hardenGuestPreferences({})).toBe(false);
        expect(hardenGuestPreferences({ partition: '' })).toBe(false);
        expect(hardenGuestPreferences({ partition: 'persist:other' })).toBe(false);
        expect(hardenGuestPreferences({ partition: 'ruimte' })).toBe(false);
    });
});

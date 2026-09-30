import { describe, expect, test } from 'bun:test';
import { allowGuestPermission, appSubframeNavigation, hardenGuestPreferences, isSystemSettingsPane, type GuestWebPreferences } from './web-guards';

const APP = 'http://127.0.0.1:4210';

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

describe('isSystemSettingsPane', () => {
    test('opens the Accessibility and Screen Recording panes', () => {
        expect(isSystemSettingsPane('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')).toBe(true);
        expect(isSystemSettingsPane('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')).toBe(true);
    });

    test('and no other pane, scheme or URL dressed up as one', () => {
        for (const url of [
            'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
            'x-apple.systempreferences:com.apple.preference.security',
            'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility&x=1',
            'X-APPLE.SYSTEMPREFERENCES:com.apple.preference.security?Privacy_Accessibility',
            'https://example.com/?x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
            'file:///System/Applications/System%20Settings.app',
            ''
        ]) {
            expect(isSystemSettingsPane(url)).toBe(false);
        }
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

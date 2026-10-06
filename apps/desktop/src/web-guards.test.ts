import { describe, expect, test } from 'bun:test';
import { createDesktopAppScheme } from './app-scheme';
import {
    allowGuestPermission,
    appSubframeNavigation,
    createGestureGate,
    hardenGuestPreferences,
    isSystemSettingsPane,
    type GuestWebPreferences
} from './web-guards';

const APP = createDesktopAppScheme('/client', 'http://127.0.0.1:4210').isAppUrl;
const PACKAGED = createDesktopAppScheme('/client').isAppUrl;

const page = { url: 'http://127.0.0.1:4210/', parent: null };
// A frame of the app's page, before it loaded anything.
const frame = { url: '', parent: page };
const visual = { url: 'http://127.0.0.1:4210/__visual/', parent: page };
const inVisual = { url: '', parent: visual };
const deeper = { url: 'https://cdn.example.com/embed', parent: inVisual };
const preview = { url: 'about:srcdoc', parent: page };

describe('appSubframeNavigation', () => {
    test("a frame of the app's page shows the host page of a visual or an empty document", () => {
        expect(appSubframeNavigation('http://127.0.0.1:4210/__visual/', frame, APP)).toBe('allow');
        expect(appSubframeNavigation('http://127.0.0.1:4210/__visual/#%7B%22theme%22%7D', frame, APP)).toBe('allow');
        expect(appSubframeNavigation('app://ruimte/__visual/', frame, PACKAGED)).toBe('allow');
        expect(appSubframeNavigation('about:blank', frame, APP)).toBe('allow');
        expect(appSubframeNavigation('about:srcdoc', frame, APP)).toBe('allow');
    });

    test('so a page in a visual cannot take its frame anywhere, the app included', () => {
        for (const url of [
            'http://127.0.0.1:4210/',
            'http://127.0.0.1:4210/projects/a',
            'http://127.0.0.1:4210/__visual',
            'http://127.0.0.1:4210/__visual/other',
            'https://example.com/',
            'https://example.com/__visual/',
            'data:text/html,<p>x</p>',
            'file:///etc/hosts'
        ]) {
            expect(appSubframeNavigation(url, visual, APP)).toBe('refuse');
        }
        expect(appSubframeNavigation('app://ruimte/', visual, PACKAGED)).toBe('refuse');
    });

    test("a frame inside a visual's page loads the web as the host page's policy does, never the app", () => {
        expect(appSubframeNavigation('https://www.example.com/embed', inVisual, APP)).toBe('allow');
        expect(appSubframeNavigation('data:text/html,<p>x</p>', inVisual, APP)).toBe('allow');
        expect(appSubframeNavigation('blob:null/1234', inVisual, APP)).toBe('allow');
        expect(appSubframeNavigation('https://other.example.com/', deeper, APP)).toBe('allow');
        expect(appSubframeNavigation('about:blank', inVisual, APP)).toBe('allow');
        for (const url of ['http://example.com/', 'http://127.0.0.1:4210/', 'http://127.0.0.1:4210/__visual/', 'file:///etc/hosts', 'javascript:alert(1)']) {
            expect(appSubframeNavigation(url, inVisual, APP)).toBe('refuse');
        }
    });

    test("a frame of the app's own preview holds nothing of the web", () => {
        expect(appSubframeNavigation('https://example.com/', { url: '', parent: preview }, APP)).toBe('refuse');
    });

    test('a frame Electron no longer knows gets the rule of a frame of the page', () => {
        expect(appSubframeNavigation('http://127.0.0.1:4210/__visual/', null, APP)).toBe('allow');
        expect(appSubframeNavigation('https://example.com/', null, APP)).toBe('refuse');
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

describe('createGestureGate', () => {
    const gate = () => {
        const clock = { now: 0 };
        return { clock, gesture: createGestureGate(() => clock.now) };
    };

    test('a script that leaves the preview without a click opens nothing', () => {
        const { gesture } = gate();
        expect(gesture.consume()).toBe(false);
    });

    test('a click lets one link out, and only one', () => {
        const { clock, gesture } = gate();
        gesture.saw('mouseDown');
        clock.now += 200;
        expect(gesture.consume()).toBe(true);
        expect(gesture.consume()).toBe(false);
    });

    test('a key counts as a click, a move or a wheel does not', () => {
        const { gesture } = gate();
        gesture.saw('mouseMove');
        gesture.saw('mouseWheel');
        expect(gesture.consume()).toBe(false);
        gesture.saw('keyDown');
        expect(gesture.consume()).toBe(true);
    });

    test('a click long ago lets nothing out', () => {
        const { clock, gesture } = gate();
        gesture.saw('mouseUp');
        clock.now += 5000;
        expect(gesture.consume()).toBe(false);
    });
});

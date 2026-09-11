import { describe, expect, test } from 'bun:test';
import { brandName, browserName, clientLabelFrom, systemName } from './client-label';

const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const EDGE = `${CHROME} Edg/123.0.0.0`;

describe('the system a client runs on', () => {
    test('is named the way its own maker names it', () => {
        expect(systemName('macOS')).toBe('macOS');
        expect(systemName('MacIntel')).toBe('macOS');
        expect(systemName('Win32')).toBe('Windows');
        expect(systemName('Windows')).toBe('Windows');
        expect(systemName('Linux x86_64')).toBe('Linux');
        expect(systemName('Android')).toBe('Android');
        expect(systemName('iPhone')).toBe('iOS');
        expect(systemName('iPad')).toBe('iPadOS');
        expect(systemName('Chrome OS')).toBe('ChromeOS');
    });

    test('is nothing rather than a guess when nothing here knows it', () => {
        expect(systemName('')).toBeNull();
        expect(systemName(null)).toBeNull();
        expect(systemName('Haiku')).toBeNull();
        // The trap the word boundary is there for: Node calls macOS `darwin`.
        expect(systemName('darwin')).toBeNull();
    });
});

describe('the browser a client is', () => {
    test('comes out of the brand list, past the padding and past Chromium', () => {
        expect(brandName([{ brand: 'Not)A;Brand' }, { brand: 'Chromium' }, { brand: 'Google Chrome' }])).toBe('Chrome');
        expect(brandName([{ brand: 'Chromium' }, { brand: 'Microsoft Edge' }, { brand: 'Not_A Brand' }])).toBe('Edge');
        expect(brandName([{ brand: 'Chromium' }, { brand: 'Brave' }])).toBe('Brave');
        // A browser that claims nothing but Chromium is Chromium.
        expect(brandName([{ brand: 'Not.A/Brand' }, { brand: 'Chromium' }])).toBe('Chromium');
        expect(brandName([])).toBeNull();
        expect(brandName(null)).toBeNull();
    });

    test('is read off the user agent only where there is no brand list, and only the shapes that are sure', () => {
        expect(browserName(SAFARI)).toBe('Safari');
        expect(browserName(FIREFOX)).toBe('Firefox');
        // Every Chromium browser carries Safari's token, and Edge carries Chrome's; the order settles it.
        expect(browserName(CHROME)).toBe('Chrome');
        expect(browserName(EDGE)).toBe('Edge');
        expect(browserName('something nobody has seen')).toBeNull();
        expect(browserName(null)).toBeNull();
    });
});

describe('the label a client pairs under', () => {
    test('the desktop app is the app and its system, in Node platform names', () => {
        expect(clientLabelFrom({ desktopPlatform: 'darwin' })).toBe('Ruimte on macOS');
        expect(clientLabelFrom({ desktopPlatform: 'win32' })).toBe('Ruimte on Windows');
        expect(clientLabelFrom({ desktopPlatform: 'linux' })).toBe('Ruimte on Linux');
        // The shape a mobile build lands in without anything here changing.
        expect(clientLabelFrom({ desktopPlatform: 'iphone' })).toBe('Ruimte on iOS');
    });

    test('a Chromium tab takes both from the fields it hands over', () => {
        const label = clientLabelFrom({
            brands: [{ brand: 'Not)A;Brand' }, { brand: 'Chromium' }, { brand: 'Google Chrome' }],
            uaPlatform: 'Windows',
            userAgent: CHROME,
            platform: 'Win32'
        });
        expect(label).toBe('Chrome on Windows');
    });

    test('a browser without those fields is read off its user agent', () => {
        expect(clientLabelFrom({ userAgent: SAFARI, platform: 'MacIntel' })).toBe('Safari on macOS');
        expect(clientLabelFrom({ userAgent: FIREFOX, platform: 'MacIntel' })).toBe('Firefox on macOS');
    });

    test('an unknown browser is a browser, and an unknown system is left out', () => {
        expect(clientLabelFrom({ userAgent: 'a client nobody wrote a rule for', platform: 'MacIntel' })).toBe('Browser on macOS');
        // Nothing in the agent or the platform names a system, and a made-up one would be worse than none.
        expect(clientLabelFrom({ userAgent: 'Mozilla/5.0 (Haiku) Firefox/124.0', platform: 'BePC' })).toBe('Firefox');
        expect(clientLabelFrom({})).toBe('Browser');
    });

    test('the desktop shell wins from the page it hosts, which is a browser in every other way', () => {
        expect(clientLabelFrom({ desktopPlatform: 'darwin', userAgent: CHROME, platform: 'MacIntel' })).toBe('Ruimte on macOS');
    });
});

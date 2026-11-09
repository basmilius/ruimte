import { describe, expect, test } from 'bun:test';
import { clientIdentityFrom } from './client-kind';

const BROWSER = { station: false, desktopPlatform: null, uaPlatform: null, uaMobile: null, maxTouchPoints: 0, version: '' };

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15';
const PIXEL = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const TABLET = 'Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

describe('clientIdentityFrom', () => {
    test('the desktop app names its system from the shell and its release', () => {
        expect(clientIdentityFrom({ ...BROWSER, desktopPlatform: 'darwin', userAgent: WINDOWS, version: '0.31.0' })).toEqual({
            client: 'desktop',
            clientVersion: '0.31.0',
            clientOs: 'macos',
            clientDevice: 'desktop'
        });
    });

    test('Station on an iPhone is a phone with its system version', () => {
        expect(clientIdentityFrom({ ...BROWSER, station: true, userAgent: IPHONE })).toEqual({
            client: 'station',
            clientOs: 'ios',
            clientOsVersion: '27.1',
            clientDevice: 'phone'
        });
    });

    test('an iPad that says Macintosh is told apart by its touch points', () => {
        expect(clientIdentityFrom({ ...BROWSER, userAgent: IPAD, maxTouchPoints: 5 })).toMatchObject({
            client: 'browser',
            clientOs: 'ipados',
            clientDevice: 'tablet'
        });
        expect(clientIdentityFrom({ ...BROWSER, userAgent: IPAD })).toEqual({ client: 'browser', clientOs: 'macos', clientDevice: 'desktop' });
    });

    test('an Android phone and tablet, by the Mobile token', () => {
        expect(clientIdentityFrom({ ...BROWSER, userAgent: PIXEL })).toEqual({
            client: 'browser',
            clientOs: 'android',
            clientOsVersion: '16',
            clientDevice: 'phone'
        });
        expect(clientIdentityFrom({ ...BROWSER, userAgent: TABLET })).toMatchObject({ clientOs: 'android', clientDevice: 'tablet' });
    });

    test('a browser on a computer prefers the structured platform and leaves its frozen version out', () => {
        expect(clientIdentityFrom({ ...BROWSER, uaPlatform: 'Windows', uaMobile: false, userAgent: WINDOWS })).toEqual({
            client: 'browser',
            clientOs: 'windows',
            clientDevice: 'desktop'
        });
    });

    test('leaves out a system nothing here recognizes', () => {
        expect(clientIdentityFrom({ ...BROWSER, userAgent: 'Bun/1.4' })).toEqual({ client: 'browser', clientDevice: 'desktop' });
    });
});

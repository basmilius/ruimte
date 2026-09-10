import { describe, expect, test } from 'bun:test';
import { classifyLoadError } from '@/browser/load-error';

describe('classifyLoadError', () => {
    test('names the failures that have a cause worth reading', () => {
        expect(classifyLoadError(-106, 'ERR_INTERNET_DISCONNECTED').kind).toBe('offline');
        expect(classifyLoadError(-105, 'ERR_NAME_NOT_RESOLVED').kind).toBe('dns');
        expect(classifyLoadError(-102, 'ERR_CONNECTION_REFUSED').kind).toBe('refused');
        expect(classifyLoadError(-118, 'ERR_CONNECTION_TIMED_OUT').kind).toBe('timeout');
        expect(classifyLoadError(-20, 'ERR_BLOCKED_BY_CLIENT').kind).toBe('blocked');
    });

    test('reads the whole certificate range as one class', () => {
        expect(classifyLoadError(-200, 'ERR_CERT_COMMON_NAME_INVALID').kind).toBe('certificate');
        expect(classifyLoadError(-202, 'ERR_CERT_AUTHORITY_INVALID').kind).toBe('certificate');
        expect(classifyLoadError(-216, 'ERR_CERT_KNOWN_INTERCEPTION_BLOCKED').kind).toBe('certificate');
        expect(classifyLoadError(-501, 'ERR_INSECURE_RESPONSE').kind).toBe('certificate');
        // A code the map has never seen, recognized by the name Chromium gave it.
        expect(classifyLoadError(-298, 'ERR_CERT_SOMETHING_NEW').kind).toBe('certificate');
    });

    test('withholds the retry only where the address itself is the problem', () => {
        const invalid = classifyLoadError(-300, 'ERR_INVALID_URL');
        expect(invalid.kind).toBe('address');
        expect(invalid.retryable).toBe(false);
        expect(classifyLoadError(-302, 'ERR_UNKNOWN_URL_SCHEME').retryable).toBe(false);
        expect(classifyLoadError(-102, 'ERR_CONNECTION_REFUSED').retryable).toBe(true);
    });

    test('degrades an unknown code to the generic sentence and the symbol', () => {
        const unknown = classifyLoadError(-354, 'ERR_INVALID_CHUNKED_ENCODING');
        expect(unknown.kind).toBe('other');
        expect(unknown.title).toBe('The page did not load');
        expect(unknown.hint).toBeNull();
        expect(unknown.symbol).toBe('ERR_INVALID_CHUNKED_ENCODING');
    });

    test('keeps the symbol Chromium gave, and falls back to the number', () => {
        expect(classifyLoadError(-102, 'net::ERR_CONNECTION_REFUSED').symbol).toBe('ERR_CONNECTION_REFUSED');
        expect(classifyLoadError(-102, '  ERR_CONNECTION_REFUSED  ').symbol).toBe('ERR_CONNECTION_REFUSED');
        expect(classifyLoadError(-2, '').symbol).toBe('net error -2');
        expect(classifyLoadError(-2, 'Something went wrong').symbol).toBe('net error -2');
    });

    test('every class says something, and only one of them says nothing extra', () => {
        const kinds = [-106, -105, -102, -200, -118, -20, -300, -2].map((code) => classifyLoadError(code, ''));
        expect(new Set(kinds.map((error) => error.kind)).size).toBe(8);
        for (const error of kinds) {
            expect(error.title.length).toBeGreaterThan(0);
        }
        expect(kinds.filter((error) => error.hint === null)).toHaveLength(1);
    });
});

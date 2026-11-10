import { describe, expect, test } from 'bun:test';
import {
    ADDRESS_BOOK_ERROR_STATUS,
    DESKTOP_APP_ORIGIN,
    MAPS_ERROR_STATUS,
    allowedOrigin,
    corsHeaders,
    failureOf,
    json,
    type AddressBookErrorCode,
    type MapsErrorCode
} from './index.ts';

function requestFrom(origin: string | null): Request {
    return new Request('https://worker.test/', origin === null ? {} : { headers: { origin } });
}

describe('json', () => {
    test('answers 200 with a JSON body that nobody caches', async () => {
        const response = json({ ok: true });
        expect(response.status).toBe(200);
        expect([...response.headers]).toEqual([
            ['cache-control', 'no-store'],
            ['content-type', 'application/json; charset=utf-8']
        ]);
        expect(await response.text()).toBe('{"ok":true}');
    });

    test('takes a status and lets a header of the caller replace one of its own', () => {
        const response = json([], 201, { 'cache-control': 'max-age=5', vary: 'Origin' });
        expect(response.status).toBe(201);
        expect([...response.headers]).toEqual([
            ['cache-control', 'max-age=5'],
            ['content-type', 'application/json; charset=utf-8'],
            ['vary', 'Origin']
        ]);
    });
});

describe('failureOf', () => {
    test('writes the code and the message in an error body, with the status of the code in its vocabulary', async () => {
        const maps = failureOf<MapsErrorCode>(MAPS_ERROR_STATUS);
        const response = maps('bad-ticket', 'Ask for a new ticket', { vary: 'Origin' });
        expect(response.status).toBe(401);
        expect(response.headers.get('vary')).toBe('Origin');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({ error: { code: 'bad-ticket', message: 'Ask for a new ticket' } });
    });

    test('the maps statuses', () => {
        expect(MAPS_ERROR_STATUS).toEqual({
            'maps-unconfigured': 503,
            'bad-ticket': 401,
            'rate-limited': 429,
            'not-found': 404,
            'bad-request': 400,
            upstream: 502,
            internal: 500
        });
    });

    test('the address book statuses', () => {
        const failure = failureOf<AddressBookErrorCode>(ADDRESS_BOOK_ERROR_STATUS);
        expect(Object.fromEntries(Object.keys(ADDRESS_BOOK_ERROR_STATUS).map((code) => [code, failure(code as AddressBookErrorCode, '').status]))).toEqual({
            'bad-request': 400,
            unauthorized: 401,
            'bad-signature': 403,
            'not-found': 404,
            removed: 409,
            'machine-on-other-account': 409,
            'identity-taken': 409,
            'provider-linked': 409,
            'last-identity': 409,
            'confirmation-mismatch': 400,
            'apple-revocation-failed': 502,
            'rate-limited': 429,
            'clock-skew': 400,
            'not-configured': 503,
            'no-benchmarks': 503,
            internal: 500
        });
    });
});

describe('allowedOrigin', () => {
    test('lets the desktop app and loopback pages read the answers', () => {
        expect(DESKTOP_APP_ORIGIN).toBe('app://ruimte');
        for (const origin of [DESKTOP_APP_ORIGIN, 'http://localhost:4212', 'http://127.0.0.1', 'http://[::1]:5173']) {
            expect(allowedOrigin(requestFrom(origin), {})).toBe(origin);
        }
    });

    test('lets the listed web clients through and nobody else', () => {
        const env = { ALLOWED_ORIGINS: 'https://station.ruimte.app, https://bench.ruimte.app,' };
        expect(allowedOrigin(requestFrom('https://station.ruimte.app'), env)).toBe('https://station.ruimte.app');
        expect(allowedOrigin(requestFrom('https://bench.ruimte.app'), env)).toBe('https://bench.ruimte.app');
        for (const origin of ['https://evil.example', 'http://localhost.evil.example', 'https://localhost', 'http://localhost:99999x', null]) {
            expect(allowedOrigin(requestFrom(origin), env)).toBeNull();
        }
        expect(allowedOrigin(requestFrom('https://station.ruimte.app'), {})).toBeNull();
    });
});

describe('corsHeaders', () => {
    test('names the methods of the worker for an origin that may read', () => {
        expect(corsHeaders('GET, POST, OPTIONS')('app://ruimte')).toEqual({
            'access-control-allow-origin': 'app://ruimte',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers': 'authorization, content-type',
            'access-control-max-age': '600',
            vary: 'Origin'
        });
        expect(corsHeaders('GET, POST, DELETE')('http://localhost:4212')['access-control-allow-methods']).toBe('GET, POST, DELETE');
    });

    test('only says that the answer depends on the origin when no origin may read', () => {
        expect(corsHeaders('GET')(null)).toEqual({ vary: 'Origin' });
    });
});

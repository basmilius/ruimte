import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { challengeOf, ConsentBook, type ConsentBookOptions } from './consent-book.ts';

const VERIFIER = 'v'.repeat(64);

function book(overrides: Partial<ConsentBookOptions> = {}): { book: ConsentBook; clock: { now: number } } {
    const clock = { now: 1_000_000 };
    let counter = 0;
    const consent = new ConsentBook({
        now: () => clock.now,
        random: (bytes) => `${'r'.repeat(bytes)}${(counter += 1)}`,
        pick: (limit) => counter++ % limit,
        changed: () => undefined,
        ...overrides
    });

    return { book: consent, clock };
}

function request(clientId = 'https://client.example/meta.json', source = '203.0.113.1') {
    return { clientId, clientName: 'Hosted Claude', redirectUri: 'https://client.example/callback', state: null, challenge: challengeOf(VERIFIER), source };
}

describe('the requests that wait for a person', () => {
    test('are at most a few from one source address, however many clients it names', () => {
        const { book: consent } = book();
        const answers = Array.from({ length: 6 }, (_, i) => consent.request(request(`https://client-${i}.example/meta.json`, '203.0.113.7')));

        expect(answers.filter((entry) => entry !== null)).toHaveLength(3);
        // Another source is not held back by the first one.
        expect(consent.request(request('https://other.example/meta.json', '203.0.113.8'))).not.toBeNull();
    });

    test('are at most a few for one client address, however many sources ask', () => {
        const { book: consent } = book();
        const answers = Array.from({ length: 6 }, (_, i) => consent.request(request('https://client.example/meta.json', `203.0.113.${i + 20}`)));

        expect(answers.filter((entry) => entry !== null)).toHaveLength(3);
        expect(consent.request(request('https://other.example/meta.json', '203.0.113.99'))).not.toBeNull();
    });

    test('are replaced by the same client asking again from the same source', () => {
        const { book: consent } = book();
        const first = consent.request(request())!;
        const second = consent.request(request())!;

        expect(consent.list().map((entry) => entry.id)).toEqual([second.id]);
        expect(consent.poll(first.id)).toEqual({ status: 'gone' });
    });

    test('free their place once answered, expired or spent', () => {
        const { book: consent, clock } = book();
        const held = Array.from({ length: 3 }, (_, i) => consent.request(request(`https://client-${i}.example/meta.json`, '203.0.113.7'))!);

        expect(consent.request(request('https://more.example/meta.json', '203.0.113.7'))).toBeNull();
        consent.answer(held[0]!.id, false, undefined, null);
        expect(consent.request(request('https://more.example/meta.json', '203.0.113.7'))).not.toBeNull();

        clock.now += 10 * 60_000;
        expect(consent.request(request('https://later.example/meta.json', '203.0.113.7'))).not.toBeNull();
    });

    test('never show the source address to a client', () => {
        const { book: consent } = book();

        consent.request(request());

        expect(JSON.stringify(consent.list())).not.toContain('203.0.113');
    });
});

describe('an authorization code', () => {
    function approved(): { book: ConsentBook; code: string } {
        const { book: consent } = book();
        const pending = consent.request(request())!;

        consent.answer(pending.id, true, undefined, null);

        const polled = consent.poll(pending.id);

        if (polled.status !== 'approved') {
            throw new Error('Expected an approved request');
        }

        return { book: consent, code: polled.authorizationCode };
    }

    test('buys the request once, for the client, redirect and verifier that asked', () => {
        const { book: consent, code } = approved();

        expect(consent.exchange(code, { clientId: request().clientId, redirectUri: request().redirectUri, verifier: VERIFIER })).not.toBeNull();
        expect(consent.exchange(code, { clientId: request().clientId, redirectUri: request().redirectUri, verifier: VERIFIER })).toBeNull();
    });

    test('is spent by a wrong verifier, and a nearly right code buys nothing', () => {
        const { book: consent, code } = approved();

        expect(consent.exchange(`${code.slice(0, -1)}x`, { clientId: request().clientId, redirectUri: request().redirectUri, verifier: VERIFIER })).toBeNull();
        expect(consent.exchange(code, { clientId: request().clientId, redirectUri: request().redirectUri, verifier: 'w'.repeat(64) })).toBeNull();
        expect(consent.exchange(code, { clientId: request().clientId, redirectUri: request().redirectUri, verifier: VERIFIER })).toBeNull();
    });

    test('is compared in constant time, with the code, the verifier and nothing else compared by ===', async () => {
        const source = await readFile(join(import.meta.dir, 'consent-book.ts'), 'utf8');
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

        expect(code).toContain('sameSecret(code, entry.decision.authorizationCode)');
        expect(code).toContain('sameSecret(challengeOf(input.verifier), entry.challenge)');
        expect(code).not.toMatch(/authorizationCode\s*[!=]==/);
        expect(code).not.toMatch(/challengeOf\(input\.verifier\)\s*[!=]==/);
    });
});

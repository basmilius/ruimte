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

function request(clientId = 'https://client.example/meta.json') {
    return { clientId, clientName: 'Hosted Claude', redirectUri: 'https://client.example/callback', state: null, challenge: challengeOf(VERIFIER) };
}

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

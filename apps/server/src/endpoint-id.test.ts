import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifySignature } from './auth/keys.ts';
import { readOrCreateEndpointIdentity } from './endpoint-id.ts';

let home: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-endpoint-id-'));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('readOrCreateEndpointIdentity', () => {
    test('mints an id and a key pair once and answers with the same ones after that', async () => {
        const first = await readOrCreateEndpointIdentity(home);
        expect(first.id.length).toBeGreaterThan(8);
        const again = await readOrCreateEndpointIdentity(home);
        expect(again.id).toBe(first.id);
        expect(again.publicKey).toBe(first.publicKey);
        expect(verifySignature(first.publicKey, 'hello', again.sign('hello'))).toBe(true);

        const written = JSON.parse(await readFile(join(home, 'endpoint.json'), 'utf8')) as { version: number; id: string; privateKey: string };
        expect(written.version).toBe(1);
        expect(written.id).toBe(first.id);
        expect(written.privateKey).toContain('PRIVATE KEY');
    });

    test('a home from before the key pair keeps its id and only gains the key', async () => {
        await writeFile(join(home, 'endpoint.json'), JSON.stringify({ version: 1, id: 'minted-earlier' }));
        const identity = await readOrCreateEndpointIdentity(home);
        expect(identity.id).toBe('minted-earlier');
        expect(verifySignature(identity.publicKey, 'x', identity.sign('x'))).toBe(true);
        expect((await readOrCreateEndpointIdentity(home)).publicKey).toBe(identity.publicKey);
    });

    test('two machines sign with two keys', async () => {
        const other = await mkdtemp(join(tmpdir(), 'ruimte-endpoint-id-'));
        try {
            const mine = await readOrCreateEndpointIdentity(home);
            const theirs = await readOrCreateEndpointIdentity(other);
            expect(verifySignature(theirs.publicKey, 'x', mine.sign('x'))).toBe(false);
        } finally {
            await rm(other, { recursive: true, force: true });
        }
    });

    test('mints a new id in a home that has none, so two homes are two machines', async () => {
        const other = await mkdtemp(join(tmpdir(), 'ruimte-endpoint-id-'));
        try {
            expect((await readOrCreateEndpointIdentity(other)).id).not.toBe((await readOrCreateEndpointIdentity(home)).id);
        } finally {
            await rm(other, { recursive: true, force: true });
        }
    });

    test('replaces a file that will not parse instead of failing to start', async () => {
        await writeFile(join(home, 'endpoint.json'), '{ not json');
        const minted = await readOrCreateEndpointIdentity(home);
        expect(minted.id.length).toBeGreaterThan(8);
        expect((await readOrCreateEndpointIdentity(home)).id).toBe(minted.id);
    });

    test('creates the home directory when the daemon has never written there', async () => {
        const fresh = join(home, 'nested', 'home');
        const minted = await readOrCreateEndpointIdentity(fresh);
        expect(await readFile(join(fresh, 'endpoint.json'), 'utf8')).toContain(minted.id);
    });
});

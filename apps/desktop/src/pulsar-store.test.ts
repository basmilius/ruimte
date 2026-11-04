import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeCipher, refusingCipher } from '../testing/fake-cipher';
import { fileSessionKey, fileSessionStore } from './pulsar-store';

const session = {
    refreshToken: 'r'.repeat(43),
    expiresAt: 1_800_000_000_000,
    account: { id: 'account-1', provider: 'github' as const, login: 'someone' }
};

describe('fileSessionStore', () => {
    let folder: string;
    let path: string;

    beforeEach(() => {
        folder = mkdtempSync(join(tmpdir(), 'ruimte-pulsar-store-'));
        path = join(folder, 'nested', 'pulsar-session.bin');
    });

    afterEach(() => {
        rmSync(folder, { recursive: true, force: true });
    });

    test('keeps the session encrypted on disk, readable by the next start, and only for this user', async () => {
        await fileSessionStore(path, fakeCipher()).write(session);
        const onDisk = readFileSync(path);
        expect(onDisk.toString('utf8')).not.toContain(session.refreshToken);
        if (process.platform !== 'win32') {
            expect(statSync(path).mode & 0o777).toBe(0o600);
        }
        expect(await fileSessionStore(path, fakeCipher()).read()).toEqual(session);
    });

    test('signing out removes the file', async () => {
        const store = fileSessionStore(path, fakeCipher());
        await store.write(session);
        await store.write(null);
        expect(existsSync(path)).toBe(false);
        expect(await store.read()).toBeNull();
    });

    test('without encryption nothing reaches the disk, and the session lasts as long as the store', async () => {
        const store = fileSessionStore(path, fakeCipher(false));
        await store.write(session);
        expect(existsSync(path)).toBe(false);
        expect(await store.read()).toEqual(session);
        expect(await fileSessionStore(path, fakeCipher(false)).read()).toBeNull();
    });

    test('a file that will not decrypt or parse is no session', async () => {
        await fileSessionStore(path, fakeCipher()).write(session);
        writeFileSync(path, 'not encrypted at all');
        expect(await fileSessionStore(path, fakeCipher()).read()).toBeNull();
    });
});

describe('fileSessionKey', () => {
    let folder: string;
    let path: string;

    beforeEach(() => {
        folder = mkdtempSync(join(tmpdir(), 'ruimte-pulsar-key-'));
        path = join(folder, 'pulsar-key.bin');
    });

    afterEach(() => {
        rmSync(folder, { recursive: true, force: true });
    });

    const verifies = (publicKey: string, message: string, signature: string): boolean =>
        verify(
            null,
            Buffer.from(message),
            createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' }),
            Buffer.from(signature, 'base64url')
        );

    test('makes one ed25519 key, keeps it encrypted for this user, and the next start signs with the same key', async () => {
        const first = await fileSessionKey(path, fakeCipher())();
        expect(first.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(verifies(first.publicKey, 'hello', await first.sign('hello'))).toBe(true);
        if (process.platform !== 'win32') {
            expect(statSync(path).mode & 0o777).toBe(0o600);
        }
        const again = await fileSessionKey(path, fakeCipher())();
        expect(again.publicKey).toBe(first.publicKey);
        expect(verifies(first.publicKey, 'again', await again.sign('again'))).toBe(true);
    });

    test('without encryption the key never reaches the disk and lasts as long as the loader', async () => {
        const load = fileSessionKey(path, fakeCipher(false));
        const first = await load();
        expect(existsSync(path)).toBe(false);
        expect((await load()).publicKey).toBe(first.publicKey);
        expect((await fileSessionKey(path, fakeCipher(false))()).publicKey).not.toBe(first.publicKey);
    });

    test('a keychain that refuses to decrypt leaves the key file alone and signs with a key in memory', async () => {
        const first = await fileSessionKey(path, fakeCipher())();
        const onDisk = readFileSync(path);
        const load = fileSessionKey(path, refusingCipher());
        const inMemory = await load();
        expect(inMemory.publicKey).not.toBe(first.publicKey);
        expect(inMemory.temporary).toBe(true);
        expect(first.temporary).toBeUndefined();
        expect((await load()).publicKey).toBe(inMemory.publicKey);
        expect(readFileSync(path)).toEqual(onDisk);
        expect((await fileSessionKey(path, fakeCipher())()).publicKey).toBe(first.publicKey);
    });

    test('a key file that will not decrypt stays as it is', async () => {
        writeFileSync(path, 'not a key');
        const signer = await fileSessionKey(path, fakeCipher())();
        expect(signer.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(readFileSync(path, 'utf8')).toBe('not a key');
    });

    test('a key file that cannot be read is not written over', async () => {
        mkdirSync(path);
        const signer = await fileSessionKey(path, fakeCipher())();
        expect(signer.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(statSync(path).isDirectory()).toBe(true);
    });
});

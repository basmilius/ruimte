import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileSessionStore, type StringCipher } from './pulsar-store';

/* A stand-in for the keychain: reversible, and nothing like the plain text. */
const fakeCipher = (available = true): StringCipher => ({
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((byte) => byte ^ 0x5a)),
    decryptString: (encrypted) => Buffer.from(encrypted.map((byte) => byte ^ 0x5a)).toString('utf8')
});

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
        expect(statSync(path).mode & 0o777).toBe(0o600);
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

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileSecretStore, type StringCipher } from './secret-store';

const fakeCipher = (available = true): StringCipher => ({
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf8').map((byte) => byte ^ 0x5a)),
    decryptString: (encrypted) => Buffer.from(encrypted.map((byte) => byte ^ 0x5a)).toString('utf8')
});

describe('fileSecretStore', () => {
    let folder: string;
    let path: string;

    beforeEach(() => {
        folder = mkdtempSync(join(tmpdir(), 'ruimte-secret-store-'));
        path = join(folder, 'nested', 'secret.bin');
    });

    afterEach(() => {
        rmSync(folder, { recursive: true, force: true });
    });

    test('encrypts the secret on disk and limits the file to this user', async () => {
        const store = fileSecretStore(path, fakeCipher());
        await store.write('sk-test-secret');

        expect(store.persistent()).toBe(true);
        expect(readFileSync(path, 'utf8')).not.toContain('sk-test-secret');
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(await fileSecretStore(path, fakeCipher()).read()).toBe('sk-test-secret');
    });

    test('removes a persisted secret', async () => {
        const store = fileSecretStore(path, fakeCipher());
        await store.write('sk-test-secret');
        await store.write(null);

        expect(existsSync(path)).toBe(false);
        expect(await store.read()).toBeNull();
    });

    test('keeps the secret in memory when encryption is unavailable', async () => {
        const store = fileSecretStore(path, fakeCipher(false));
        await store.write('sk-test-secret');

        expect(store.persistent()).toBe(false);
        expect(existsSync(path)).toBe(false);
        expect(await store.read()).toBe('sk-test-secret');
        expect(await fileSecretStore(path, fakeCipher(false)).read()).toBeNull();
    });

    test('treats an unreadable encrypted file as unset', async () => {
        await fileSecretStore(path, fakeCipher()).write('sk-test-secret');
        writeFileSync(path, 'not encrypted');
        const unavailableCipher: StringCipher = {
            ...fakeCipher(),
            decryptString: () => {
                throw new Error('Keychain rejected the file');
            }
        };
        expect(await fileSecretStore(path, unavailableCipher).read()).toBeNull();
    });
});

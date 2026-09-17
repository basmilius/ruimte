import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface StringCipher {
    isEncryptionAvailable(): boolean;
    encryptString(plain: string): Buffer;
    decryptString(encrypted: Buffer): string;
}

export interface SecretStore {
    persistent(): boolean;
    read(): Promise<string | null>;
    write(secret: string | null): Promise<void>;
}

/* A secret is only persisted when Electron can encrypt it through the operating system's keychain. */
export const fileSecretStore = (path: string, cipher: StringCipher): SecretStore => {
    let memory: string | null = null;

    return {
        persistent: () => cipher.isEncryptionAvailable(),
        async read() {
            if (!cipher.isEncryptionAvailable()) {
                return memory;
            }
            try {
                return cipher.decryptString(await readFile(path));
            } catch {
                return null;
            }
        },
        async write(secret) {
            memory = secret;
            if (!cipher.isEncryptionAvailable()) {
                return;
            }
            if (secret === null) {
                await rm(path, { force: true });
                return;
            }
            await mkdir(dirname(path), { recursive: true });
            const temporary = `${path}.${process.pid}.tmp`;
            await writeFile(temporary, cipher.encryptString(secret), { mode: 0o600 });
            await rename(temporary, path);
        }
    };
};

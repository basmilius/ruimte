import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { KeyedSerializer } from '@adecore/utils/async';
import { syncDirectory, writeAtomic } from '@adecore/utils/fs';

/* The part of Electron's `safeStorage` the stores need, so a test can hand in its own. */
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

interface SecretStoreOptions {
    /* Throw for a secret that is on disk but cannot be read, rather than take it for unset. */
    reportUnreadable?: boolean;
}

function isMissing(error: unknown): boolean {
    return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

// One queue per path, shared by every store on it.
const queues = new KeyedSerializer();

/* Readable by this user only, and a failed write never leaves half a file under its name. */
export async function writeEncrypted(path: string, cipher: StringCipher, plain: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeAtomic(path, cipher.encryptString(plain));
}

/* A secret is only persisted when Electron can encrypt it through the operating system's keychain. */
export function fileSecretStore(path: string, cipher: StringCipher, { reportUnreadable = false }: SecretStoreOptions = {}): SecretStore {
    let memory: string | null = null;

    return {
        persistent: () => cipher.isEncryptionAvailable(),
        read() {
            return queues.run(path, async () => {
                if (!cipher.isEncryptionAvailable()) {
                    return memory;
                }
                try {
                    return cipher.decryptString(await readFile(path));
                } catch (error: unknown) {
                    if (reportUnreadable && !isMissing(error)) {
                        throw error;
                    }
                    return null;
                }
            });
        },
        write(secret) {
            return queues.run(path, async () => {
                memory = secret;
                if (!cipher.isEncryptionAvailable()) {
                    return;
                }
                if (secret === null) {
                    await rm(path, { force: true });
                    // Makes the removal itself survive a restart.
                    await syncDirectory(dirname(path)).catch((error: unknown) => {
                        if (!isMissing(error)) {
                            throw error;
                        }
                    });
                    return;
                }
                await writeEncrypted(path, cipher, secret);
            });
        }
    };
}

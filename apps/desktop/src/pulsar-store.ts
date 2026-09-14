import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AccountSchema, type SessionStore, type StoredSession } from '@ruimte/pulsar';
import { z } from 'zod';

/* The part of Electron's `safeStorage` this needs, so a test can hand in its own. */
export interface StringCipher {
    isEncryptionAvailable(): boolean;
    encryptString(plain: string): Buffer;
    decryptString(encrypted: Buffer): string;
}

const StoredSessionSchema = z.object({
    refreshToken: z.string().min(1),
    expiresAt: z.number().int(),
    account: AccountSchema
});

/*
 * The address book session on disk, encrypted with the OS keychain through `safeStorage`. The file
 * lives in the shell's `userData`, where no page can read it, and the page is never handed the refresh
 * token either. Without encryption (a Linux desktop with no keyring) nothing is written: the session
 * lasts until the app quits, rather than a refresh token sitting in a plain file.
 */
export const fileSessionStore = (path: string, cipher: StringCipher): SessionStore => {
    let memory: StoredSession | null = null;

    return {
        read: async () => {
            if (!cipher.isEncryptionAvailable()) {
                return memory;
            }
            let encrypted: Buffer;
            try {
                encrypted = await readFile(path);
            } catch {
                return null;
            }
            try {
                const parsed = StoredSessionSchema.safeParse(JSON.parse(cipher.decryptString(encrypted)));
                return parsed.success ? parsed.data : null;
            } catch {
                // A file another keychain wrote, or one that was damaged, is a session that has to start over.
                return null;
            }
        },
        write: async (session) => {
            memory = session;
            if (!cipher.isEncryptionAvailable()) {
                return;
            }
            if (session === null) {
                await rm(path, { force: true });
                return;
            }
            await mkdir(dirname(path), { recursive: true });
            const temporary = `${path}.${process.pid}.tmp`;
            await writeFile(temporary, cipher.encryptString(JSON.stringify(session)), { mode: 0o600 });
            await rename(temporary, path);
        }
    };
};

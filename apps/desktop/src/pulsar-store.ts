import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AccountSchema, type SessionSigner, type SessionStore, type StoredSession } from '@ruimte/pulsar';
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
const writeEncrypted = async (path: string, cipher: StringCipher, plain: string): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, cipher.encryptString(plain), { mode: 0o600 });
    await rename(temporary, path);
};

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
            await writeEncrypted(path, cipher, JSON.stringify(session));
        }
    };
};

const signerOf = (privateKey: KeyObject): SessionSigner => ({
    publicKey: createPublicKey(privateKey).export({ format: 'jwk' }).x ?? '',
    sign: async (message) => sign(null, Buffer.from(message), privateKey).toString('base64url')
});

/*
 * The key the shell's session is bound to: every refresh is signed with it, so the refresh token in the
 * file beside it opens nothing on another computer. Made once and kept encrypted like the session, in a
 * file of its own so signing out leaves it. Without encryption it lives in memory, like the session does.
 */
export const fileSessionKey = (path: string, cipher: StringCipher): (() => Promise<SessionSigner>) => {
    let held: Promise<SessionSigner> | null = null;

    const load = async (): Promise<SessionSigner> => {
        if (cipher.isEncryptionAvailable()) {
            try {
                const der = Buffer.from(cipher.decryptString(await readFile(path)), 'base64url');
                return signerOf(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }));
            } catch {
                // No key yet, or one another keychain wrote: a new one, and a session bound to the old one signs in again.
            }
        }
        const { privateKey } = generateKeyPairSync('ed25519');
        if (cipher.isEncryptionAvailable()) {
            await writeEncrypted(path, cipher, privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'));
        }
        return signerOf(privateKey);
    };

    return () => {
        held ??= load().catch((e: unknown) => {
            held = null;
            throw e;
        });
        return held;
    };
};

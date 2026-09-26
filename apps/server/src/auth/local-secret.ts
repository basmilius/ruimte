import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isNotFound, writeAtomic } from '@ruimte/agents/fs';

export const LOCAL_SECRET_FILE = 'local.key';

export const localSecretPath = (home: string): string => join(home, LOCAL_SECRET_FILE);

/*
 * What a process on this machine presents instead of its source address. Behind a tunnel or a
 * reverse proxy every visitor arrives from loopback, so the address proves nothing; being able to
 * read a file only this account can read does. It belongs to a home rather than to a machine,
 * because a dev daemon and an installed one each have a home of their own.
 */
export const readLocalSecret = async (home: string): Promise<string | null> => {
    try {
        const secret = (await readFile(localSecretPath(home), 'utf8')).trim();
        return secret === '' ? null : secret;
    } catch (e) {
        if (isNotFound(e)) {
            return null;
        }
        throw e;
    }
};

/**
 * The secret of a home, minted on the first start. It survives restarts, so a desktop app or a
 * `ruimte pair` that read it once does not have to know that the daemon came back.
 */
export const readOrCreateLocalSecret = async (home: string): Promise<string> => {
    const existing = await readLocalSecret(home);
    if (existing !== null) {
        return existing;
    }
    const secret = randomBytes(32).toString('base64url');
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeAtomic(localSecretPath(home), `${secret}\n`, 0o600);
    return secret;
};

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Compares in constant time; hashing first keeps a length difference from ending the compare early. */
export const sameSecret = (presented: string, secret: string): boolean => timingSafeEqual(digest(presented), digest(secret));

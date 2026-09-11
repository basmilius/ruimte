import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { generateKeyPair, signMessage } from './auth/keys.ts';
import { isNotFound, writeAtomic } from './fs.ts';

/*
 * The key pair arrived after the id did, and the version stays at 1 on purpose: zod strips what it
 * does not know, so a daemon from before the keys reads this file, keeps its id and leaves the
 * extra fields alone. Bumping the version would make that daemon mint a new id, and every paired
 * client would see the machine it knows answer as a stranger.
 */
const FileSchema = z.object({
    version: z.literal(1),
    id: z.string().min(1),
    publicKey: z.string().min(1).optional(),
    privateKey: z.string().min(1).optional()
});

export interface EndpointIdentity {
    id: string;
    publicKey: string;
    /* Signs a message with the daemon's private key; the private half never leaves this object. */
    sign(message: string): string;
}

/*
 * The daemon's own name for itself and the key that proves it, minted once and kept in
 * `$RUIMTE_HOME`. A client keys everything it remembers about a machine on the id and pins the
 * public key at pairing, so both have to survive a restart and a new address; only a new home is a
 * new daemon.
 */
export const readOrCreateEndpointIdentity = async (home: string): Promise<EndpointIdentity> => {
    const path = join(home, 'endpoint.json');
    let id: string | null = null;
    let keys: { publicKey: string; privateKey: string } | null = null;
    try {
        const parsed = FileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
        if (parsed.success) {
            id = parsed.data.id;
            if (parsed.data.publicKey && parsed.data.privateKey) {
                keys = { publicKey: parsed.data.publicKey, privateKey: parsed.data.privateKey };
            }
        }
    } catch (e) {
        if (!isNotFound(e)) {
            console.warn('The endpoint id file would not parse; minting a new id', e);
        }
    }
    if (id !== null && keys !== null) {
        return identityOf(id, keys);
    }
    // A home that already has an id keeps it and only gains a key pair; losing the id would unpair every client.
    const next = { version: 1, id: id ?? randomBytes(8).toString('base64url'), ...(keys ?? generateKeyPair()) };
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`, 0o600);
    return identityOf(next.id, next);
};

const identityOf = (id: string, keys: { publicKey: string; privateKey: string }): EndpointIdentity => ({
    id,
    publicKey: keys.publicKey,
    sign: (message) => signMessage(keys.privateKey, message)
});

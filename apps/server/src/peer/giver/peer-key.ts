import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isNotFound } from '@adecore/utils/errors';
import { writeAtomic } from '@adecore/utils/fs';
import { z } from 'zod';
import { generateKeyPair, signMessage, type KeyPair } from '../../auth/keys.ts';

const PeerKeyFileSchema = z.object({
    version: z.literal(1),
    publicKey: z.string().min(1),
    privateKey: z.string().min(1)
});

export const PEER_KEY_FILE = 'peer-key.json';

/*
 * The key another machine lets this one in under. It is not the machine key: that one is what the
 * account lists this machine by, and a statement ties this one to it, so a leak of this key is worth
 * one link and not the machine. Made on first use.
 */
export class PeerKey {
    private readonly path: string;
    private readonly home: string;
    private loading: Promise<KeyPair> | null = null;

    constructor(home: string) {
        this.home = home;
        this.path = join(home, PEER_KEY_FILE);
    }

    async publicKey(): Promise<string> {
        return (await this.pair()).publicKey;
    }

    async sign(message: string): Promise<string> {
        return signMessage((await this.pair()).privateKey, message);
    }

    /* Forgets the key for good: a machine that left its account is not the machine the other ones vouched for, and gets a new key when it asks again. */
    async wipe(): Promise<void> {
        await this.loading?.catch(() => undefined);
        this.loading = null;
        await rm(this.path, { force: true });
    }

    private pair(): Promise<KeyPair> {
        this.loading ??= this.readOrCreate().catch((e: unknown) => {
            this.loading = null;
            throw e;
        });
        return this.loading;
    }

    private async readOrCreate(): Promise<KeyPair> {
        try {
            const parsed = PeerKeyFileSchema.safeParse(JSON.parse(await readFile(this.path, 'utf8')));
            if (parsed.success) {
                return parsed.data;
            }
        } catch (e) {
            if (!isNotFound(e) && !(e instanceof SyntaxError)) {
                throw e;
            }
        }
        const pair = generateKeyPair();
        await mkdir(this.home, { recursive: true, mode: 0o700 });
        await writeAtomic(this.path, `${JSON.stringify({ version: 1, ...pair }, null, 2)}\n`, 0o600);
        return pair;
    }
}

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic } from '@adecore/utils/fs';
import { tunnelsFolder } from './tunnel-store.ts';

const TOKEN_FILE = 'cloudflare-token';

/* The API token a person typed, in a 0600 file under a 0700 folder like the secrets of launches. No client reads the folder. */
export interface CloudflareTokenStore {
    read(): string | null;
    write(token: string): Promise<void>;
    clear(): Promise<void>;
}

export class FileTokenStore implements CloudflareTokenStore {
    private readonly folder: string;

    constructor(home: string) {
        this.folder = tunnelsFolder(home);
    }

    private get path(): string {
        return join(this.folder, TOKEN_FILE);
    }

    read(): string | null {
        if (!existsSync(this.path)) {
            return null;
        }

        try {
            return readFileSync(this.path, 'utf8').trim() || null;
        } catch {
            // Not the error itself: a path in it says nothing a person can act on.
            console.warn('The Cloudflare API token would not read; Tunnels ask for it again.');

            return null;
        }
    }

    async write(token: string): Promise<void> {
        await mkdir(this.folder, { recursive: true, mode: 0o700 });
        await writeAtomic(this.path, token, 0o600);
    }

    async clear(): Promise<void> {
        await rm(this.path, { force: true });
    }
}

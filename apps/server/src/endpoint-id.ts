import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { isNotFound, writeAtomic } from './fs.ts';

const FileSchema = z.object({ version: z.literal(1), id: z.string().min(1) });

/*
 * The daemon's own name for itself, minted once and kept in `$RUIMTE_HOME`. A client keys
 * everything it remembers about a machine on this, so it has to survive a restart and a new
 * address; only a new home is a new daemon.
 */
export const readOrCreateEndpointId = async (home: string): Promise<string> => {
    const path = join(home, 'endpoint.json');
    try {
        const parsed = FileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
        if (parsed.success) {
            return parsed.data.id;
        }
    } catch (e) {
        if (!isNotFound(e)) {
            console.warn('The endpoint id file would not parse; minting a new id', e);
        }
    }
    const id = randomBytes(8).toString('base64url');
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeAtomic(path, `${JSON.stringify({ version: 1, id }, null, 2)}\n`, 0o600);
    return id;
};

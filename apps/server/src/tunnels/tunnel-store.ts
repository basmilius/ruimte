import { join } from 'node:path';
import { TunnelRowSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { JsonFileStore } from '../json-file-store.ts';

export const TUNNELS_DIR = 'tunnels';

/*
 * What Ruimte keeps of a tunnel: no credential of Cloudflare's, only the id of the tunnel, the path of the
 * file `cloudflared` wrote for it (which Ruimte never opens) and the rows of the screen.
 */
const StoredTunnelsSchema = z.object({
    version: z.literal(1),
    /* Set once `cloudflared tunnel login` ended well. Ruimte cannot look at the login itself, so this is all it knows of it. */
    signedIn: z.boolean(),
    domain: z.string().nullable(),
    tunnel: z.object({ id: z.string().min(1), name: z.string().min(1), credentialsFile: z.string().min(1) }).nullable(),
    mcp: z.object({ enabled: z.boolean(), label: z.string().nullable() }),
    rows: z.array(TunnelRowSchema)
});
export type StoredTunnels = z.infer<typeof StoredTunnelsSchema>;

export const EMPTY_TUNNELS: StoredTunnels = {
    version: 1,
    signedIn: false,
    domain: null,
    tunnel: null,
    mcp: { enabled: false, label: null },
    rows: []
};

export function tunnelsFolder(home: string): string {
    return join(home, TUNNELS_DIR);
}

export function tunnelStore(home: string | undefined): JsonFileStore<StoredTunnels> {
    return new JsonFileStore(home === undefined ? undefined : join(tunnelsFolder(home), 'tunnels.json'), StoredTunnelsSchema, 'tunnels start empty');
}

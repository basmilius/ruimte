import { join } from 'node:path';
import { TunnelNamedSchema, TunnelRowSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { JsonFileStore } from '../json-file-store.ts';

export const TUNNELS_DIR = 'tunnels';

/*
 * A row of the screen with what Ruimte needs to undo it: the zone and the DNS record it made, which is the only record it
 * ever deletes. The record is null while Cloudflare has not made it yet, after its 404 rule was taken. A key a newer
 * Ruimte wrote survives this one.
 */
const StoredRowSchema = TunnelRowSchema.extend({ zoneId: z.string().min(1), recordId: z.string().min(1).nullable() }).loose();
export type StoredRow = z.infer<typeof StoredRowSchema>;

/*
 * What Ruimte keeps of a tunnel: the account and id of the tunnel it uses, whether it made that tunnel, and its rows.
 * A file from before Ruimte could use an existing tunnel only knew tunnels it made. The API token lives in a file of
 * its own (`cloudflare-token-store.ts`) and never in this one.
 */
const CurrentSchema = z.object({
    version: z.literal(2),
    tunnel: z.object({ id: z.string().min(1), name: z.string().min(1), account: TunnelNamedSchema, created: z.boolean().default(true) }).nullable(),
    mcp: z.object({ enabled: z.boolean(), label: z.string().nullable() }),
    rows: z.array(StoredRowSchema)
});
export type StoredTunnels = z.infer<typeof CurrentSchema>;

/* The file of the `cloudflared login` version keeps only what still means something: whether the external MCP was on. */
const PreviousSchema = z
    .object({ version: z.literal(1), mcp: z.object({ enabled: z.boolean() }) })
    .transform((previous): StoredTunnels => ({ ...EMPTY_TUNNELS, mcp: { enabled: previous.mcp.enabled, label: null } }));

const StoredTunnelsSchema = z.union([CurrentSchema, PreviousSchema]);

export const EMPTY_TUNNELS: StoredTunnels = {
    version: 2,
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

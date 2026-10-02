import { toBase64Url } from '@ruimte/pulsar';
import { z } from 'zod';

/*
 * The two HTTP routes a daemon answers beside the socket, asked by the desktop shell and by
 * `ruimte service` before they start, restart or update a daemon. They are a wire like any other:
 * the asker is often a different release than the daemon that answers.
 */

export const MACHINE_HEALTH_PATH = '/health';
export const MACHINE_WORK_PATH = '/machine/work';

export const HealthResultSchema = z.object({
    /*
     * Always true. This is what says a Ruimte daemon answers rather than any server that happens to
     * hold the port, so a reader that skips it may attach to something else entirely.
     */
    ok: z.literal(true),
    version: z.string().min(1),
    /* The id `apps/server/scripts/compile.ts` stamps into the binary; absent in a checkout. */
    build: z.string().min(1).nullish(),
    /* Whether launchd or systemd started this daemon. */
    service: z.boolean().optional()
});
export type HealthResult = z.infer<typeof HealthResultSchema>;

/* The build behind a port, as everything that compares two of them reads it. */
export interface BuildIdentity {
    version: string;
    build: string | null;
}

/* Null for anything that is not a daemon's `/health`, an empty build read as none. */
export const buildIdentityOf = (body: unknown): BuildIdentity | null => {
    const parsed = HealthResultSchema.safeParse(body);
    if (!parsed.success) {
        return null;
    }
    return { version: parsed.data.version, build: parsed.data.build ?? null };
};

const CountSchema = z.number().int().nonnegative();

/*
 * What a restart of a daemon would cut short. Asked by the daemon before it updates itself and by
 * the desktop app before it restarts the service onto a new binary, so both mean the same by idle.
 */
export const MachineWorkSchema = z.object({
    /* Shells with something running in them other than the shell, and no agent in a turn. */
    terminals: CountSchema,
    /* Terminal agents in a turn (or waiting on a person inside one) and chats with a turn in flight. */
    agents: CountSchema
});
export type MachineWork = z.infer<typeof MachineWorkSchema>;

/* Null for a daemon from before this route, which answers 404 with a body of its own. */
export const machineWorkOf = (body: unknown): MachineWork | null => {
    const parsed = MachineWorkSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
};

export const isIdle = (work: MachineWork): boolean => work.terminals === 0 && work.agents === 0;

/*
 * Where a daemon proves it holds the local secret of its home without showing it. The desktop shell
 * asks before it sends that secret anywhere or loads a page from the port, since whatever got the
 * port first answers `/health` as readily as the daemon does.
 */
export const MACHINE_PROOF_PATH = '/machine/proof';

export const MachineProofRequestSchema = z.object({ nonce: z.string().min(16).max(256) });

export const MachineProofResultSchema = z.object({ proof: z.string().min(1) });

/*
 * The port is covered too, so a daemon of the same home on another port cannot answer for whatever
 * holds this one. The first line keeps the HMAC from ever meaning anything else signed with the secret.
 */
const proofMessage = (port: number, nonce: string): string => `ruimte machine proof v1\n${port}\n${nonce}`;

/* HMAC-SHA256 under the local secret, in base64url, with WebCrypto so the daemon and the shell compute the same bytes. */
export const localProofOf = async (secret: string, port: number, nonce: string): Promise<string> => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(proofMessage(port, nonce))));
};

/* Whether a reply to the proof request was made with this secret, for this port and this nonce. */
export const isLocalProof = async (body: unknown, secret: string, port: number, nonce: string): Promise<boolean> => {
    const parsed = MachineProofResultSchema.safeParse(body);
    return parsed.success && parsed.data.proof === (await localProofOf(secret, port, nonce));
};

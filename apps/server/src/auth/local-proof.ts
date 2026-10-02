import { localProofOf, MachineProofRequestSchema } from '@ruimte/contracts';

/*
 * Proves this daemon holds the local secret of its home, without handing it out, so the desktop
 * shell knows the port is this daemon's before it sends the secret or loads a page from it. Anyone
 * may ask: an HMAC over a nonce they chose tells them nothing about the secret.
 */
export const handleLocalProofRequest = async (request: Request, options: { localSecret: string; port: number }): Promise<Response> => {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }
    const parsed = MachineProofRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return new Response('Expected a nonce', { status: 400 });
    }
    return Response.json({ proof: await localProofOf(options.localSecret, options.port, parsed.data.nonce) });
};

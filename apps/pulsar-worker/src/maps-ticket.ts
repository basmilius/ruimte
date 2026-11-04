import { MAPS_TICKET_LIFETIME_MS, mapsSecretBytes, mapsTicketSubject, signMapsTicket } from '@ruimte/pulsar';
import type { Env } from './env.ts';
import { clientIp, failure, json, signInAgain } from './http.ts';
import { LIMITS, overAnyLimit } from './rate-limit.ts';
import { authenticate } from './sessions.ts';

/*
 * `POST /v1/maps/ticket`. A signed-in client sends its bearer token and gets a ticket for its account that
 * the maps service checks with the shared secret alone, so a tile request never reaches this database.
 */
export async function issueMapsTicket(request: Request, env: Env): Promise<Response> {
    const ip = clientIp(request);
    const limited = await overAnyLimit(env, [[`ip:${ip}:maps`, LIMITS.mapsTicketIp]]);
    if (limited) {
        return limited;
    }
    const secret = env.MAP_TICKET_SECRET;
    if (!secret) {
        return failure('not-configured', 'The address book issues no map tickets yet');
    }
    if (mapsSecretBytes(secret) === null) {
        return failure('not-configured', 'The map ticket secret is not 32 bytes of base64url');
    }
    const session = await authenticate(request, env.DB);
    if (!session) {
        return signInAgain();
    }
    const accountId = session.account.id;
    const perAccount = await overAnyLimit(env, [[`account:${accountId}:maps`, LIMITS.mapsTicketAccount]]);
    if (perAccount) {
        return perAccount;
    }
    const issuedAt = Date.now();
    return json({ ...(await signMapsTicket(secret, await mapsTicketSubject(secret, accountId), issuedAt + MAPS_TICKET_LIFETIME_MS)), issuedAt });
}

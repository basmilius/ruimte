import { z } from 'zod';

/*
 * The version of the wire between a client and a daemon. Bumped only when the wire changes in a way
 * the other side cannot read (a request or an event that changed shape, a handshake frame that
 * moved), never for an addition an older side ignores. Today a client and a daemon work together
 * only on the same version.
 */
export const PROTOCOL_VERSION = 1;

export const ProtocolVersionSchema = z.number().int().nonnegative();

/* The query parameter a socket carries its client's version in. */
export const PROTOCOL_PARAM = 'protocol';

/* The close code of a socket the daemon refused for its version; the reason carries the daemon's own. */
export const PROTOCOL_REFUSED_CLOSE_CODE = 4406;

/* Which side is behind. A daemon that says no version is from before versions existed, so it is the older one. */
export type ProtocolMismatch = 'daemon-older' | 'daemon-newer';

export const protocolMismatch = (daemon: number | null | undefined, client: number = PROTOCOL_VERSION): ProtocolMismatch | null => {
    if (daemon === null || daemon === undefined || daemon < client) {
        return 'daemon-older';
    }
    return daemon > client ? 'daemon-newer' : null;
};

/*
 * Whether the daemon takes a socket that offered this value. A client from before versions offers
 * none and is let in: it could not read the refusal, and the client that can read one always sends it.
 */
export const acceptsOfferedProtocol = (offered: string | null, daemon: number = PROTOCOL_VERSION): boolean => offered === null || Number(offered) === daemon;

export const protocolRefusalReason = (daemon: number = PROTOCOL_VERSION): string => `protocol ${daemon}`;

/* The daemon's version out of a close reason, or null for a reason that is not a refusal. */
export const protocolOfRefusal = (reason: string): number | null => {
    const match = /^protocol (\d+)$/.exec(reason);
    return match ? Number(match[1]) : null;
};

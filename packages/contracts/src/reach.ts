import { z } from 'zod';

/*
 * Whether other devices can reach a machine, as the machine itself sees it: the broker it announces
 * itself to, the ICE servers that broker handed out, its door on the local network and the route its
 * traffic leaves by. The daemon gathers these facts and one pure classifier turns them into one cause.
 */

// A cause a later release adds reads as `unknown` on an older client, so the field is a string on the wire.
export const REACH_CAUSES = [
    'ok',
    'broker-off',
    'broker-unreachable',
    'no-relay',
    'turn-unreachable',
    'turn-refused',
    'udp-blocked',
    'vpn-blocks-udp',
    'blocked',
    'lan-door-down'
] as const;
export type ReachCause = (typeof REACH_CAUSES)[number];

// `relayed` works, but only through a TURN server, which is slower than a straight line.
export const ReachSeveritySchema = z.enum(['ok', 'relayed', 'limited', 'unreachable']);
export type ReachSeverity = z.infer<typeof ReachSeveritySchema>;

export const ReachProbeOutcomeSchema = z.enum(['ok', 'refused', 'unreachable']);
export type ReachProbeOutcome = z.infer<typeof ReachProbeOutcomeSchema>;

export const ReachProbeSchema = z.object({
    kind: z.enum(['stun', 'turn']),
    // The URL without its credentials: `turn:relay.example.com:3478?transport=udp`.
    url: z.string(),
    transport: z.enum(['udp', 'tcp', 'tls']),
    // `refused`: the server answered and would not do it, such as TURN credentials it did not take.
    outcome: ReachProbeOutcomeSchema,
    // What went wrong in a line, for `ruimte status --json`; absent when it worked.
    error: z.string().optional()
});
export type ReachProbe = z.infer<typeof ReachProbeSchema>;

export const ReachFactsSchema = z.object({
    broker: z.object({ url: z.string().nullable(), connected: z.boolean() }),
    // False while the broker handed out no ICE servers, from a broker that has none or one older than them.
    granted: z.boolean(),
    probes: z.array(ReachProbeSchema),
    lanDoor: z.object({
        wanted: z.boolean(),
        listening: z.boolean(),
        // The port it should listen on, so a door that could not open names the port that was taken.
        port: z.number().int().nullable(),
        addresses: z.number().int()
    }),
    // The network interface the default route leaves by when that is a tunnel (a VPN or an exit node); null otherwise or when it cannot be read.
    tunnel: z.string().nullable()
});
export type ReachFacts = z.infer<typeof ReachFactsSchema>;

export const ReachCheckSchema = z.object({
    // Milliseconds since the epoch.
    checkedAt: z.number(),
    cause: z.string(),
    severity: ReachSeveritySchema,
    facts: ReachFactsSchema
});
export type ReachCheck = z.infer<typeof ReachCheckSchema>;

/* `endpoint.reach`: the last check, or a fresh one with `check`. A machine whose network changed since checks again anyway. */
export const EndpointReachPayloadSchema = z.object({ check: z.boolean().optional() });
export type EndpointReachPayload = z.infer<typeof EndpointReachPayloadSchema>;

// Null while no check has run, such as on a machine with nothing to check yet.
export const EndpointReachResultSchema = z.object({ reach: ReachCheckSchema.nullable() });
export type EndpointReachResult = z.infer<typeof EndpointReachResultSchema>;

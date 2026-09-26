import { describe, expect, test } from 'bun:test';
import { AGENT_EVENT_SCHEMAS, AGENT_REQUEST_SCHEMAS } from '@ruimte/agent-contracts/protocol';
import { EndpointInfoSchema } from './auth.ts';
import { DirectChallengeFrameSchema, DirectVerdictFrameSchema } from './direct.ts';
import { EVENT_SCHEMAS, REQUEST_SCHEMAS } from './index.ts';
import { PROTOCOL_VERSION, acceptsOfferedProtocol, protocolMismatch, protocolOfRefusal, protocolRefusalReason } from './protocol.ts';

test('the same version is no mismatch', () => {
    expect(protocolMismatch(3, 3)).toBeNull();
});

test('a daemon behind the client is older, one ahead is newer', () => {
    expect(protocolMismatch(2, 3)).toBe('daemon-older');
    expect(protocolMismatch(4, 3)).toBe('daemon-newer');
});

test('a daemon that says no version is older', () => {
    expect(protocolMismatch(undefined, 1)).toBe('daemon-older');
    expect(protocolMismatch(null, 1)).toBe('daemon-older');
});

test('the daemon takes its own version and a socket that offers none', () => {
    expect(acceptsOfferedProtocol(String(PROTOCOL_VERSION))).toBe(true);
    expect(acceptsOfferedProtocol(null)).toBe(true);
    expect(acceptsOfferedProtocol('2', 1)).toBe(false);
    expect(acceptsOfferedProtocol('nonsense', 1)).toBe(false);
});

test('the close reason carries the daemon version and reads back', () => {
    expect(protocolOfRefusal(protocolRefusalReason(7))).toBe(7);
    expect(protocolOfRefusal('Access revoked')).toBeNull();
});

test('an endpoint.info and a challenge from before versions still parse', () => {
    const info = { id: 'd', label: 'Mac', platform: 'darwin', version: '0.1.0', reachability: 'loopback', authenticated: true };
    expect(EndpointInfoSchema.parse(info).protocol).toBeUndefined();
    const challenge = { type: 'direct.challenge', challenge: 'c', daemon: { id: 'd', publicKey: 'k', signature: 's' } };
    expect(DirectChallengeFrameSchema.parse(challenge).protocol).toBeUndefined();
    expect(DirectVerdictFrameSchema.parse({ type: 'direct.refused', reason: 'no', protocol: 2 })).toEqual({
        type: 'direct.refused',
        reason: 'no',
        protocol: 2
    });
});

describe('the requests of a chat host', () => {
    test('every one sits in the wire tables, as the very same schema', () => {
        for (const [type, pair] of Object.entries(AGENT_REQUEST_SCHEMAS)) {
            expect(REQUEST_SCHEMAS[type as keyof typeof REQUEST_SCHEMAS]).toBe(pair);
        }
        for (const [type, schema] of Object.entries(AGENT_EVENT_SCHEMAS)) {
            expect(EVENT_SCHEMAS[type as keyof typeof EVENT_SCHEMAS]).toBe(schema);
        }
    });
});

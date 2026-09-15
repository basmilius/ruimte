import { describe, expect, test } from 'bun:test';
import {
    ACCESS_STATEMENT_LIFETIME_MS,
    APP_REDIRECT_SCHEME_URI,
    isAppRedirectUri,
    AccessRequestPayloadSchema,
    AccessStatementSchema,
    AddressBookErrorSchema,
    BrokerPeerFrameSchema,
    BrokerServerFrameSchema,
    MachineListResultSchema,
    RegisterMachinePayloadSchema,
    SignalEnvelopeSchema,
    type AccessStatement,
    type BrokerPeerFrame,
    type BrokerServerFrame
} from './index.ts';

const key = 'A'.repeat(43);
const otherKey = 'B'.repeat(43);
const signature = 's'.repeat(86);
const nonce = 'n'.repeat(22);
const envelope = { connectionId: 'attempt-1', signal: { kind: 'offer' as const, sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' } };

// Through JSON and back, the way a frame really travels.
const roundTrip = <T>(schema: { parse(value: unknown): T }, value: T): T => schema.parse(JSON.parse(JSON.stringify(value)));

describe('broker frames', () => {
    const peerFrames: BrokerPeerFrame[] = [
        { type: 'hello', role: 'machine', publicKey: key },
        { type: 'prove', signature },
        { type: 'relay', id: 'r1', to: otherKey, envelope, signature },
        { type: 'ice', id: 'ice-1' }
    ];
    const serverFrames: BrokerServerFrame[] = [
        { type: 'challenge', broker: 'broker.example.com', nonce },
        { type: 'ready' },
        { type: 'delivered', id: 'r1' },
        { type: 'relayed', from: key, envelope, signature },
        { type: 'error', code: 'not-connected', message: 'Nobody with that key is connected', id: 'r1' },
        { type: 'rate-limited', scope: 'key', retryAfterMs: 1000 },
        {
            type: 'ice',
            id: 'ice-1',
            servers: [
                { urls: 'stun:turn.example.com:3478' },
                { urls: ['turn:turn.example.com:3478?transport=udp', 'turns:turn.example.com:5349?transport=tcp'], username: '1:m-abc', credential: 'c2VjcmV0' }
            ],
            expiresAt: 1_800_000_000_000
        },
        { type: 'ice', id: 'ice-2', servers: [], expiresAt: null }
    ];

    test.each(peerFrames)('a peer frame survives a round trip: %p', (frame) => {
        expect(roundTrip(BrokerPeerFrameSchema, frame)).toEqual(frame);
    });

    test.each(serverFrames)('a broker frame survives a round trip: %p', (frame) => {
        expect(roundTrip(BrokerServerFrameSchema, frame)).toEqual(frame);
    });

    test('refuses a key that is not 32 bytes of base64url', () => {
        expect(BrokerPeerFrameSchema.safeParse({ type: 'hello', role: 'machine', publicKey: 'A'.repeat(44) }).success).toBe(false);
        expect(BrokerPeerFrameSchema.safeParse({ type: 'hello', role: 'machine', publicKey: `${'A'.repeat(42)}=` }).success).toBe(false);
        expect(BrokerPeerFrameSchema.safeParse({ type: 'hello', role: 'machine', publicKey: `${'A'.repeat(42)}+` }).success).toBe(false);
    });

    test('refuses a role, a type or an error code it does not know', () => {
        expect(BrokerPeerFrameSchema.safeParse({ type: 'hello', role: 'broker', publicKey: key }).success).toBe(false);
        expect(BrokerPeerFrameSchema.safeParse({ type: 'subscribe', publicKey: key }).success).toBe(false);
        expect(BrokerServerFrameSchema.safeParse({ type: 'error', code: 'teapot', message: '' }).success).toBe(false);
    });

    test('refuses a relay without a signature or with a short nonce in the challenge', () => {
        expect(BrokerPeerFrameSchema.safeParse({ type: 'relay', id: 'r1', to: otherKey, envelope }).success).toBe(false);
        expect(BrokerServerFrameSchema.safeParse({ type: 'challenge', broker: 'broker.example.com', nonce: 'short' }).success).toBe(false);
    });

    test('refuses an ice answer with a URL that is no ICE server, or without an id', () => {
        expect(BrokerServerFrameSchema.safeParse({ type: 'ice', id: 'ice-1', servers: [{ urls: 'https://turn.example.com' }], expiresAt: null }).success).toBe(
            false
        );
        expect(BrokerServerFrameSchema.safeParse({ type: 'ice', servers: [], expiresAt: null }).success).toBe(false);
        expect(BrokerPeerFrameSchema.safeParse({ type: 'ice' }).success).toBe(false);
    });

    test('refuses a negative or fractional retry', () => {
        expect(BrokerServerFrameSchema.safeParse({ type: 'rate-limited', scope: 'ip', retryAfterMs: -1 }).success).toBe(false);
        expect(BrokerServerFrameSchema.safeParse({ type: 'rate-limited', scope: 'ip', retryAfterMs: 1.5 }).success).toBe(false);
    });
});

describe('signaling', () => {
    test.each([
        envelope,
        { connectionId: 'attempt-1', signal: { kind: 'answer', sdp: 'v=0' } },
        { connectionId: 'attempt-1', signal: { kind: 'candidate', candidate: 'candidate:1 1 udp 1 192.0.2.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 } },
        { connectionId: 'attempt-1', signal: { kind: 'candidate', candidate: '', sdpMid: null, sdpMLineIndex: null } },
        { connectionId: 'attempt-1', signal: { kind: 'close', reason: 'declined' } },
        { connectionId: 'attempt-1', signal: { kind: 'close', reason: 'statements-refused' } },
        {
            connectionId: 'attempt-1',
            signal: {
                kind: 'offer',
                sdp: 'v=0',
                access: {
                    statement: { machineId: 'machine-1', clientPublicKey: key, nonce, issuedAt: 0, expiresAt: ACCESS_STATEMENT_LIFETIME_MS, signature },
                    label: 'Laptop'
                }
            }
        }
    ])('an envelope survives a round trip: %p', (value) => {
        expect(roundTrip(SignalEnvelopeSchema, value as never)).toEqual(value as never);
    });

    test('refuses an empty SDP, an unknown kind and a connection id with a slash in it', () => {
        expect(SignalEnvelopeSchema.safeParse({ connectionId: 'attempt-1', signal: { kind: 'offer', sdp: '' } }).success).toBe(false);
        expect(SignalEnvelopeSchema.safeParse({ connectionId: 'attempt-1', signal: { kind: 'renegotiate', sdp: 'v=0' } }).success).toBe(false);
        expect(SignalEnvelopeSchema.safeParse({ connectionId: 'attempt/1', signal: { kind: 'close', reason: 'done' } }).success).toBe(false);
    });

    test('refuses an offer whose statement lasts too long or whose label is empty', () => {
        const statement = { machineId: 'machine-1', clientPublicKey: key, nonce, issuedAt: 0, expiresAt: ACCESS_STATEMENT_LIFETIME_MS, signature };
        const offer = (access: unknown) => ({ connectionId: 'attempt-1', signal: { kind: 'offer', sdp: 'v=0', access } });
        expect(SignalEnvelopeSchema.safeParse(offer({ statement, label: 'Laptop' })).success).toBe(true);
        expect(
            SignalEnvelopeSchema.safeParse(offer({ statement: { ...statement, expiresAt: ACCESS_STATEMENT_LIFETIME_MS + 1 }, label: 'Laptop' })).success
        ).toBe(false);
        expect(SignalEnvelopeSchema.safeParse(offer({ statement, label: '' })).success).toBe(false);
    });
});

describe('address book', () => {
    const statement: AccessStatement = {
        machineId: 'machine-1',
        clientPublicKey: key,
        nonce,
        issuedAt: 1_800_000_000_000,
        expiresAt: 1_800_000_000_000 + ACCESS_STATEMENT_LIFETIME_MS,
        signature
    };

    test('the machine list, a registration, a request, a statement and an error survive a round trip', () => {
        const list = {
            machines: [
                { id: 'machine-1', name: 'Studio', icon: null, publicKey: key, brokerUrl: null, lastSeenAt: null },
                {
                    id: 'machine-2',
                    name: 'Server',
                    icon: { kind: 'lucide' as const, value: 'server' },
                    publicKey: otherKey,
                    brokerUrl: 'wss://broker.ruimte.app',
                    lastSeenAt: 1_800_000_000_000
                }
            ]
        };
        const registration = {
            id: 'machine-1',
            name: 'Studio',
            icon: { kind: 'emoji' as const, value: 'S' },
            brokerUrl: 'wss://broker.ruimte.app',
            publicKey: key,
            issuedAt: 1_800_000_000_000,
            signature
        };
        const request = { machineId: 'machine-1', clientPublicKey: key, nonce, signature };
        const error = { error: { code: 'unauthorized' as const, message: 'Sign in again' } };

        expect(roundTrip(MachineListResultSchema, list)).toEqual(list);
        expect(roundTrip(RegisterMachinePayloadSchema, registration)).toEqual(registration);
        expect(roundTrip(AccessRequestPayloadSchema, request)).toEqual(request);
        expect(roundTrip(AccessStatementSchema, statement)).toEqual(statement);
        expect(roundTrip(AddressBookErrorSchema, error)).toEqual(error);
    });

    test('refuses a statement that is valid for longer than two minutes, or expires before it is issued', () => {
        expect(AccessStatementSchema.safeParse({ ...statement, expiresAt: statement.issuedAt + ACCESS_STATEMENT_LIFETIME_MS + 1 }).success).toBe(false);
        expect(AccessStatementSchema.safeParse({ ...statement, expiresAt: statement.issuedAt }).success).toBe(false);
    });

    test('refuses a registration without a signature and a machine without a name', () => {
        expect(RegisterMachinePayloadSchema.safeParse({ id: 'machine-1', name: 'Studio', publicKey: key, issuedAt: 0 }).success).toBe(false);
        expect(
            MachineListResultSchema.safeParse({ machines: [{ id: 'machine-1', name: '', icon: null, publicKey: key, brokerUrl: null, lastSeenAt: null }] })
                .success
        ).toBe(false);
    });

    test('a broker URL is a ws or wss URL, and a registration from before the broker still parses', () => {
        const registration = { id: 'machine-1', name: 'Studio', icon: null, publicKey: key, issuedAt: 0, signature };
        expect(RegisterMachinePayloadSchema.safeParse(registration).success).toBe(true);
        expect(RegisterMachinePayloadSchema.safeParse({ ...registration, brokerUrl: 'https://broker.ruimte.app' }).success).toBe(false);
        expect(RegisterMachinePayloadSchema.safeParse({ ...registration, brokerUrl: 'ws://127.0.0.1:4420' }).success).toBe(true);
    });

    test('a login comes back only to the custom scheme, a loopback listener, the web client or the dev origin', () => {
        expect(isAppRedirectUri(APP_REDIRECT_SCHEME_URI)).toBe(true);
        expect(isAppRedirectUri('http://127.0.0.1:53682/pulsar/callback')).toBe(true);
        expect(isAppRedirectUri('http://[::1]:53682/pulsar/callback')).toBe(true);
        expect(isAppRedirectUri('https://station.ruimte.app/pulsar/callback')).toBe(true);
        expect(isAppRedirectUri('http://localhost:5173/pulsar/callback')).toBe(true);
        for (const refused of [
            'https://station.ruimte.app/pulsar/callback/',
            'https://station.ruimte.app/pulsar/callback?next=evil',
            'https://station.ruimte.app/pulsar/callback#x',
            'https://station.ruimte.app/',
            'http://station.ruimte.app/pulsar/callback',
            'https://station.ruimte.app:444/pulsar/callback',
            'https://station.ruimte.app.evil.example/pulsar/callback',
            'https://evil.example/station.ruimte.app/pulsar/callback',
            'http://localhost:5174/pulsar/callback',
            'ruimte://pulsar/callback?x=1',
            'http://127.0.0.1/pulsar/callback',
            'http://localhost:53682/pulsar/callback',
            'https://127.0.0.1:53682/pulsar/callback',
            'http://127.0.0.1:53682/pulsar/callback?next=evil',
            'http://127.0.0.1:53682/pulsar/callback/',
            'http://user@127.0.0.1:53682/pulsar/callback',
            'https://example.com/pulsar/callback'
        ]) {
            expect(isAppRedirectUri(refused)).toBe(false);
        }
    });
});

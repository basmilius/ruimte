import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { iceTargets, parseIceUrl, probeTarget, type IceTarget, type OpenExchange, type StunExchange } from './ice-probe.ts';
import { STUN_ATTRIBUTE, STUN_METHOD, attributeOf, decodeMessage, longTermKey, type StunMessage } from './stun.ts';

function answer(request: StunMessage, kind: 'success' | 'error', code?: number, extra: Array<[number, string]> = []): StunMessage {
    const attributes = extra.map(([type, text]) => ({ type, value: new TextEncoder().encode(text) }));
    if (code !== undefined) {
        attributes.push({ type: STUN_ATTRIBUTE.errorCode, value: new Uint8Array([0, 0, Math.floor(code / 100), code % 100]) });
    }
    return { method: request.method, kind, transactionId: request.transactionId, attributes };
}

/* A TURN server that wants the long-term credentials of `user`/`pass`, and says what it was asked. */
function fakeTurn(options: { staleOnce?: boolean } = {}): { open: OpenExchange; asked: string[] } {
    const asked: string[] = [];
    let stale = options.staleOnce === true;
    const key = longTermKey('user', 'ruimte', 'pass');
    const exchange: StunExchange = {
        ask: async (bytes) => {
            const request = decodeMessage(bytes)!;
            const integrity = attributeOf(request, STUN_ATTRIBUTE.messageIntegrity);
            const name = request.method === STUN_METHOD.allocate ? 'allocate' : request.method === STUN_METHOD.refresh ? 'refresh' : 'binding';
            asked.push(`${name}${integrity === null ? '' : ' signed'}`);
            if (request.method === STUN_METHOD.binding) {
                return answer(request, 'success');
            }
            if (integrity === null) {
                return answer(request, 'error', 401, [
                    [STUN_ATTRIBUTE.realm, 'ruimte'],
                    [STUN_ATTRIBUTE.nonce, 'n1']
                ]);
            }
            const covered = bytes.slice(0, bytes.length - 24);
            if (createHmac('sha1', key).update(covered).digest('hex') !== Buffer.from(integrity).toString('hex')) {
                return answer(request, 'error', 401, [[STUN_ATTRIBUTE.realm, 'ruimte']]);
            }
            if (stale) {
                stale = false;
                return answer(request, 'error', 438, [[STUN_ATTRIBUTE.nonce, 'n2']]);
            }
            return answer(request, 'success');
        },
        close: () => asked.push('close')
    };
    return { open: async () => exchange, asked };
}

const TURN: IceTarget = {
    kind: 'turn',
    transport: 'udp',
    host: 'relay.example.com',
    port: 3478,
    url: 'turn:relay.example.com:3478',
    username: 'user',
    credential: 'pass'
};

describe('ICE URLs', () => {
    test('read the scheme, host, port and transport, with the defaults of each scheme', () => {
        expect(parseIceUrl('stun:stun.example.com:19302')).toEqual({
            kind: 'stun',
            transport: 'udp',
            host: 'stun.example.com',
            port: 19302,
            url: 'stun:stun.example.com:19302'
        });
        expect(parseIceUrl('turn:relay.example.com?transport=tcp')).toMatchObject({ kind: 'turn', transport: 'tcp', port: 3478 });
        expect(parseIceUrl('turns:relay.example.com:443?transport=tcp')).toMatchObject({ kind: 'turn', transport: 'tls', port: 443 });
        expect(parseIceUrl('turns:[2001:db8::1]')).toMatchObject({ host: '2001:db8::1', port: 5349, transport: 'tls' });
        expect(parseIceUrl('https://example.com')).toBeNull();
    });

    test('every URL of a server is a target with its credentials', () => {
        const targets = iceTargets([{ urls: ['turn:a.example.com', 'turns:a.example.com'], username: 'u', credential: 'c' }, { urls: 'stun:b.example.com' }]);
        expect(targets.map((target) => [target.url, target.username ?? null])).toEqual([
            ['turn:a.example.com', 'u'],
            ['turns:a.example.com', 'u'],
            ['stun:b.example.com', null]
        ]);
    });
});

describe('probing a server', () => {
    test('a TURN server is asked for an allocation with the long-term key, which is released at once', async () => {
        const { open, asked } = fakeTurn();
        expect(await probeTarget(TURN, open)).toEqual({ kind: 'turn', url: TURN.url, transport: 'udp', outcome: 'ok' });
        expect(asked).toEqual(['allocate', 'allocate signed', 'refresh signed', 'close']);
    });

    test('a stale nonce is asked again with the fresh one', async () => {
        const { open, asked } = fakeTurn({ staleOnce: true });
        expect((await probeTarget(TURN, open)).outcome).toBe('ok');
        expect(asked).toEqual(['allocate', 'allocate signed', 'allocate signed', 'refresh signed', 'close']);
    });

    test('credentials the server does not take answer, but refuse', async () => {
        const { open } = fakeTurn();
        const probe = await probeTarget({ ...TURN, credential: 'wrong' }, open);
        expect(probe.outcome).toBe('refused');
        expect(probe.error).toBe('Allocate answered 401');
    });

    test('a STUN server is asked for a binding', async () => {
        const { open, asked } = fakeTurn();
        expect((await probeTarget({ ...TURN, kind: 'stun', url: 'stun:relay.example.com' }, open)).outcome).toBe('ok');
        expect(asked).toEqual(['binding', 'close']);
    });

    test('a server that does not open or answer is unreachable', async () => {
        const probe = await probeTarget(TURN, async () => {
            throw new Error('connect ECONNREFUSED');
        });
        expect(probe).toMatchObject({ outcome: 'unreachable', error: 'connect ECONNREFUSED' });
    });
});

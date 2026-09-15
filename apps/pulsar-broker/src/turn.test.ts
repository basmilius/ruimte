import { describe, expect, test } from 'bun:test';
import { IceServerSchema } from '@ruimte/pulsar';
import { cloudflareTurn, noTurn, sharedSecretTurn, turnCredential } from './turn.ts';

const KEY = 'A'.repeat(43);

describe('turnCredential', () => {
    test('is the base64 HMAC-SHA1 of the username under the secret, as coturn computes it', () => {
        // The password from `printf '1800000000:m-AAAAAAAAAAAAAAAA' | openssl dgst -sha1 -hmac 'north-sea-secret' -binary | base64`.
        expect(turnCredential('north-sea-secret', { role: 'machine', publicKey: KEY }, 1_800_000_000)).toEqual({
            username: '1800000000:m-AAAAAAAAAAAAAAAA',
            credential: '+K5rTzzn3kTnSvNolHtkqAnigIs='
        });
        expect(turnCredential('north-sea-secret', { role: 'client', publicKey: KEY }, 1_800_000_000).username).toBe('1800000000:c-AAAAAAAAAAAAAAAA');
    });
});

describe('sharedSecretTurn', () => {
    test('hands out the URLs with a credential that expires after the ttl, reading the secret on every request', async () => {
        let secret = 'north-sea-secret\n';
        const provider = sharedSecretTurn({
            secretFile: '/etc/ruimte/turn-secret',
            urls: ['turn:turn.example.com:3478?transport=udp', 'turn:turn.example.com:3478?transport=tcp'],
            ttlSeconds: 86_400,
            now: () => 1_799_913_600_500,
            read: async (path) => {
                expect(path).toBe('/etc/ruimte/turn-secret');
                return secret;
            }
        });
        const grant = await provider.iceServersFor({ role: 'machine', publicKey: KEY });
        expect(grant).toEqual({
            servers: [
                {
                    urls: ['turn:turn.example.com:3478?transport=udp', 'turn:turn.example.com:3478?transport=tcp'],
                    username: '1800000000:m-AAAAAAAAAAAAAAAA',
                    credential: '+K5rTzzn3kTnSvNolHtkqAnigIs='
                }
            ],
            expiresAt: 1_800_000_000_000
        });
        expect(IceServerSchema.safeParse(grant.servers[0]).success).toBe(true);

        secret = 'rotated';
        expect((await provider.iceServersFor({ role: 'machine', publicKey: KEY })).servers[0]!.credential).not.toBe('+K5rTzzn3kTnSvNolHtkqAnigIs=');
        secret = '  ';
        expect(provider.iceServersFor({ role: 'machine', publicKey: KEY })).rejects.toThrow(/empty/);
    });
});

describe('noTurn', () => {
    test('gives nobody anything', async () => {
        expect(await noTurn.iceServersFor({ role: 'client', publicKey: KEY })).toEqual({ servers: [], expiresAt: null });
    });
});

describe('cloudflareTurn', () => {
    const ICE = [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'user-1', credential: 'pass-1' }
    ];

    const setup = (answer: () => Response) => {
        let now = 1_000_000;
        const calls: Array<{ url: string; init: RequestInit }> = [];
        const provider = cloudflareTurn({
            keyId: 'key-1',
            tokenFile: '/etc/ruimte/cloudflare-token',
            ttlSeconds: 900,
            now: () => now,
            read: async () => 'token-1\n',
            fetch: (async (url: string, init: RequestInit) => {
                calls.push({ url, init });
                return answer();
            }) as unknown as typeof fetch
        });
        return {
            provider,
            calls,
            advance: (ms: number) => {
                now += ms;
            }
        };
    };

    test('asks the API with the token and the ttl, and keeps the answer for two thirds of its life', async () => {
        const { provider, calls, advance } = setup(() => Response.json({ iceServers: ICE }));
        const peer = { role: 'client' as const, publicKey: KEY };
        const [first, second] = await Promise.all([provider.iceServersFor(peer), provider.iceServersFor(peer)]);
        expect(first).toEqual({ servers: ICE, expiresAt: 1_000_000 + 900_000 });
        expect(second).toBe(first);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key-1/credentials/generate-ice-servers');
        expect(calls[0]!.init.method).toBe('POST');
        expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer token-1');
        expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ ttl: 900 });

        advance(599_999);
        await provider.iceServersFor(peer);
        expect(calls).toHaveLength(1);
        advance(1);
        await provider.iceServersFor(peer);
        expect(calls).toHaveLength(2);
    });

    test('reads the older single object, and refuses an error or an empty answer without caching it', async () => {
        let response = Response.json({ iceServers: ICE[1] });
        const { provider, calls } = setup(() => response);
        const peer = { role: 'machine' as const, publicKey: KEY };
        expect((await provider.iceServersFor(peer)).servers).toEqual([ICE[1]!]);

        const failing = setup(() => new Response('nope', { status: 401 }));
        expect(failing.provider.iceServersFor(peer)).rejects.toThrow(/401/);
        response = Response.json({ iceServers: [] });
        const empty = setup(() => Response.json({ iceServers: [] }));
        expect(empty.provider.iceServersFor(peer)).rejects.toThrow(/without ICE servers/);
        expect(calls).toHaveLength(1);
    });
});

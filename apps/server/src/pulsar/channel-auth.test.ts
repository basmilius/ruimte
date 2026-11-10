import { describe, expect, test } from 'bun:test';
import { DIRECT_COMPRESSION } from '@ruimte/contracts';
import { localChannelProof } from '@ruimte/pulsar';
import { authenticateChannel } from './channel-auth.ts';
import type { DirectChannel } from './data-channel.ts';

const SECRET = 'the-local-secret';
const DAEMON_ID = 'daemon-1';
const BINDING = 'binding';

function fakeChannel(): { channel: DirectChannel; sent: string[]; compressionAtSend: boolean[]; deflating: () => boolean; answer(frame: object): void } {
    const sent: string[] = [];
    const compressionAtSend: boolean[] = [];
    let reader: (frame: string) => void = () => undefined;
    let deflating = false;
    const channel: DirectChannel = {
        label: 'ruimte',
        isOpen: true,
        get deflating() {
            return deflating;
        },
        send: (data) => {
            sent.push(String(data));
            compressionAtSend.push(deflating);
            return 1;
        },
        bufferedAmount: () => 0,
        close: () => undefined,
        onClose: () => undefined,
        onDrain: () => undefined,
        receiveWith: (listener) => {
            reader = listener;
        },
        deflate: () => {
            deflating = true;
        }
    };
    return { channel, sent, compressionAtSend, deflating: () => deflating, answer: (frame) => reader(JSON.stringify(frame)) };
}

function authenticate(channel: DirectChannel): ReturnType<typeof authenticateChannel> {
    return authenticateChannel({
        channel,
        binding: BINDING,
        handshake: {
            challenge: () => ({ challenge: 'c', daemon: { id: DAEMON_ID, publicKey: 'key', signature: 'signed' } }),
            redeemChannel: async () => null,
            spend: () => true
        },
        daemonId: DAEMON_ID,
        localSecret: SECRET,
        reachability: 'lan'
    });
}

async function secretProof(extra: object = {}): Promise<object> {
    return { type: 'direct.secret', challenge: 'c', proof: await localChannelProof(SECRET, DAEMON_ID, 'c', BINDING), ...extra };
}

describe('authenticateChannel', () => {
    test('the challenge offers deflate, and a client that chose it gets deflated frames from after the verdict', async () => {
        const { channel, sent, compressionAtSend, deflating, answer } = fakeChannel();
        const access = authenticate(channel);
        expect(JSON.parse(sent[0]!).compression).toEqual([DIRECT_COMPRESSION]);
        answer(await secretProof({ compression: DIRECT_COMPRESSION }));
        expect(await access).toEqual({ reachability: 'lan', sessionId: null });
        expect(JSON.parse(sent[1]!).type).toBe('direct.accepted');
        expect(deflating()).toBe(true);
        expect(compressionAtSend).toEqual([false, false]);
        channel.send('{"id":"application"}');
        expect(compressionAtSend).toEqual([false, false, true]);
    });

    test('a client that chose nothing, or something this daemon does not know, gets every frame as it is', async () => {
        for (const extra of [{}, { compression: 'zstd' }]) {
            const { channel, deflating, answer } = fakeChannel();
            const access = authenticate(channel);
            answer(await secretProof(extra));
            expect(await access).not.toBeNull();
            expect(deflating()).toBe(false);
        }
    });
});

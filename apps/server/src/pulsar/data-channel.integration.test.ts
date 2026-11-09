import { afterEach, describe, expect, test } from 'bun:test';
import { inflateRawSync } from 'node:zlib';
import { BinaryFrameAssembler, DeflatedFrameAssembler, FrameAssembler, isBinaryPiece, isDeflatedPiece } from '@ruimte/contracts';
import { RTCPeerConnection, type RTCDataChannel } from 'werift';
import { directChannel, fromWerift, type DirectChannel } from './data-channel.ts';

/*
 * A daemon's channel and a bare client channel in one process, over real ICE, DTLS and SCTP on
 * loopback, so the lane is measured against werift's own queue and not against a fake of it.
 */

const peers: RTCPeerConnection[] = [];

afterEach(async () => {
    for (const peer of peers.splice(0)) {
        await peer.close();
    }
});

function gathered(peer: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
        if (peer.iceGatheringState === 'complete') {
            resolve();
            return;
        }
        const subscription = peer.iceGatheringStateChange.subscribe((state) => {
            if (state === 'complete') {
                subscription.unSubscribe();
                resolve();
            }
        });
    });
}

async function connected(): Promise<{ daemon: DirectChannel; client: RTCDataChannel }> {
    const clientPeer = new RTCPeerConnection({});
    const daemonPeer = new RTCPeerConnection({});
    peers.push(clientPeer, daemonPeer);
    const client = clientPeer.createDataChannel('ruimte', { ordered: true });
    const daemonRaw = new Promise<RTCDataChannel>((resolve) => daemonPeer.onDataChannel.subscribe(resolve));

    await clientPeer.setLocalDescription(await clientPeer.createOffer());
    await gathered(clientPeer);
    await daemonPeer.setRemoteDescription(clientPeer.localDescription!);
    await daemonPeer.setLocalDescription(await daemonPeer.createAnswer());
    await gathered(daemonPeer);
    await clientPeer.setRemoteDescription(daemonPeer.localDescription!);

    const raw = await daemonRaw;
    while (raw.readyState !== 'open' || client.readyState !== 'open') {
        await Bun.sleep(5);
    }
    return { daemon: directChannel(fromWerift(raw)), client };
}

describe('the binary lane of a direct channel', () => {
    test('async compressed text and its following text arrive before queued binary', async () => {
        const { daemon, client } = await connected();
        const text = new FrameAssembler();
        const compressed = new DeflatedFrameAssembler();
        const binary = new BinaryFrameAssembler();
        const arrivals: Array<string | Uint8Array> = [];
        const received = Promise.withResolvers<void>();
        client.onMessage.subscribe((data) => {
            const piece = typeof data === 'string' ? data : new Uint8Array(data);
            if (piece instanceof Uint8Array && isBinaryPiece(piece)) {
                const result = binary.push(piece, Number.MAX_SAFE_INTEGER);
                if (result.kind === 'frame') {
                    arrivals.push(result.frame);
                }
            } else if (piece instanceof Uint8Array && isDeflatedPiece(piece)) {
                const result = compressed.push(piece, Number.MAX_SAFE_INTEGER);
                if (result.kind === 'frame') {
                    arrivals.push(inflateRawSync(result.frame).toString());
                }
            } else {
                const result = text.push(typeof piece === 'string' ? piece : new TextDecoder().decode(piece), Number.MAX_SAFE_INTEGER);
                if (result.kind === 'frame') {
                    arrivals.push(result.frame);
                }
            }

            if (arrivals.length === 3) {
                received.resolve();
            }
        });

        const large = JSON.stringify({ text: 'compress this reply '.repeat(10_000) });
        const picture = Uint8Array.of(11, 12, 13);
        daemon.deflate();
        expect(daemon.send(large)).toBe(Buffer.byteLength(large));
        daemon.send('after');
        daemon.send(picture);
        await received.promise;
        expect(arrivals).toEqual([large, 'after', picture]);
    }, 30_000);

    test('a reply sent after a large live frame arrives before that frame is through', async () => {
        const { daemon, client } = await connected();
        const text = new FrameAssembler();
        const binary = new BinaryFrameAssembler();
        const arrivals: Array<{ kind: 'text'; frame: string } | { kind: 'binary'; frame: Uint8Array }> = [];
        client.onMessage.subscribe((data) => {
            const piece = typeof data === 'string' ? data : new Uint8Array(data);
            if (piece instanceof Uint8Array && isBinaryPiece(piece)) {
                const result = binary.push(piece, Number.MAX_SAFE_INTEGER);
                if (result.kind === 'frame') {
                    arrivals.push({ kind: 'binary', frame: result.frame });
                }
                return;
            }
            const result = text.push(typeof piece === 'string' ? piece : new TextDecoder().decode(piece), Number.MAX_SAFE_INTEGER);
            if (result.kind === 'frame') {
                arrivals.push({ kind: 'text', frame: result.frame });
            }
        });

        const keyFrame = Uint8Array.from({ length: 4 * 1024 * 1024 }, (_, index) => index % 251);
        expect(daemon.send(keyFrame)).toBe(keyFrame.byteLength);
        daemon.send('{"id":"1","ok":true,"result":{}}');

        const deadline = Date.now() + 20_000;
        while (arrivals.length < 2 && Date.now() < deadline) {
            await Bun.sleep(10);
        }
        expect(arrivals.map((arrival) => arrival.kind)).toEqual(['text', 'binary']);
        expect(arrivals[1]!.frame).toEqual(keyFrame);
        expect(daemon.bufferedAmount()).toBe(0);
    }, 30_000);
});

import { messageOf } from '@adecore/ui';
import {
    BinaryFrameAssembler,
    BYTES_REPLY_MAX_BYTES,
    ChannelLiveness,
    channelBinding,
    DeflatedFrameAssembler,
    DIRECT_COMPRESSION,
    DIRECT_PING_TICK_MS,
    directPingFrame,
    DIRECT_CHANNEL_LABEL,
    FrameAssembler,
    isBinaryPiece,
    ICE_GATHER_TIMEOUT_MS,
    isDeflatedPiece,
    LIVE_FRAME_MAX_BYTES,
    parseHandshakeFrame,
    protocolMismatch,
    splitFrame,
    type DirectChallengeFrame,
    type DirectProofFrame
} from '@ruimte/contracts';
import { randomToken } from '@ruimte/pulsar';
import i18next from 'i18next';
import { fireAndForget } from '@/transport-api/transport';
import { mergeIceServers, relayedFromStats } from './ice';
import type { Link, LinkOpener } from './link-transport';
import { protocolRefusal } from './protocol';
import { socketSignaling, type Signal, type Signaling, type SignalingOpener } from './signaling';

// Offer to handshake; ICE with a STUN server that answers slowly still fits, a path that does not exist does not.
const CONNECT_TIMEOUT_MS = 20_000;

// The same ceiling the daemon holds a channel to once it is in; the handshake frames are a few hundred bytes.
const FRAME_CHARS = 16 * 1024 * 1024;
const HANDSHAKE_FRAME_CHARS = 4_096;

// A binary frame is a `bytes.read` reply or a live frame, and only ever one this client asked for.
const BINARY_FRAME_BYTES = Math.max(BYTES_REPLY_MAX_BYTES, LIVE_FRAME_MAX_BYTES);

// A deflated frame inflates to at most a frame's characters at four bytes each; anything larger is not one of ours.
const INFLATED_FRAME_BYTES = FRAME_CHARS * 4;

// How long a close waits for the channel to report closed before the peer goes anyway.
const CLOSE_GRACE_MS = 2_000;

export interface WebRtcLinkOptions {
    /* This client's own servers; the signaling route may add its own for the attempt (TURN from the broker). */
    iceServers: RTCIceServer[];
    /* The answer to the daemon's challenge; throws when the daemon did not prove itself. */
    prove(challenge: DirectChallengeFrame, binding: string): Promise<DirectProofFrame>;
    /* The daemon let this client in; the ticket is for the HTTP routes an `<img>` still fetches. */
    accepted?(ticket: string | null): void;
    /* The machine does not know this client's key (`not-paired`): it left its account, lost its home, or this client has a new key. */
    unknownKey?(): void;
    /* How this attempt's signals travel, given the address the transport resolved; a socket to the machine unless said otherwise. */
    signaling?(url: string): SignalingOpener;
    createPeer?(configuration: RTCConfiguration): RTCPeerConnection;
    createSocket?(url: string): WebSocket;
    timeoutMs?: number;
    gatherMs?: number;
    pingIdleMs?: number;
    pingTimeoutMs?: number;
    pingTickMs?: number;
}

/* Why the machine hung up. A reason this version has no words for still says the connection went. */
function closeReason(reason: string): string {
    return i18next.t(`machines:direct.closed.${reason}`, { defaultValue: i18next.t('machines:direct.closed.other') });
}

/* Inflates a frame the daemon deflated, refusing one that grows past what a frame may be. */
export async function inflateFrame(deflated: Uint8Array<ArrayBuffer>, maxBytes: number = INFLATED_FRAME_BYTES): Promise<string> {
    const reader = new Blob([deflated]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
        length += read.value.byteLength;
        if (length > maxBytes) {
            await reader.cancel();
            throw new Error('A deflated frame grew past the frame limit');
        }
        chunks.push(read.value);
    }
    const frame = await new Blob(chunks as Uint8Array<ArrayBuffer>[]).text();
    if (frame.length > FRAME_CHARS) {
        throw new Error('A deflated frame grew past the frame limit');
    }
    return frame;
}

/*
 * Close signaling once the DataChannel opens, then authenticate against its DTLS fingerprints
 * before reporting the link ready. Direct failures stay visible instead of falling back silently.
 */
export function webRtcLink(options: WebRtcLinkOptions): LinkOpener {
    return (url, events): Link => {
        const connectionId = randomToken(16);
        const assembler = new FrameAssembler();
        const binaryAssembler = new BinaryFrameAssembler();
        const deflatedAssembler = new DeflatedFrameAssembler();
        let ended = false;
        let authenticated = false;
        let deflating = false;
        // Frames that wait for a deflated one before them to inflate, so every frame arrives in the order it was sent.
        let backlog = 0;
        let delivered: Promise<void> = Promise.resolve();
        let offerSdp: string | null = null;
        let binding: string | null = null;
        let peer: RTCPeerConnection | null = null;
        let channel: RTCDataChannel | null = null;
        let signaling: Signaling | null = null;
        let liveness: ChannelLiveness | null = null;
        let livenessTimer: ReturnType<typeof setInterval> | null = null;

        const closeSignaling = (): void => {
            signaling?.close();
            signaling = null;
        };

        const end = (failure: string | null): void => {
            if (ended) {
                return;
            }
            ended = true;
            clearTimeout(timer);
            if (livenessTimer !== null) {
                clearInterval(livenessTimer);
            }
            closeSignaling();
            const closingPeer = peer;
            if (closingPeer) {
                closingPeer.onconnectionstatechange = null;
            }
            const releasePeer = (): void => closingPeer?.close();
            if (channel && channel.readyState === 'open') {
                // The channel's stream reset is how the machine hears the close at once; a peer taken down first can cut it off, which leaves the machine waiting on ICE consent.
                const grace = setTimeout(releasePeer, CLOSE_GRACE_MS);
                channel.onmessage = null;
                channel.onclose = () => {
                    clearTimeout(grace);
                    releasePeer();
                };
                channel.close();
            } else {
                if (channel) {
                    channel.onclose = null;
                    channel.onmessage = null;
                    channel.close();
                }
                releasePeer();
            }
            events.close(failure);
        };

        const timeoutMs = options.timeoutMs ?? CONNECT_TIMEOUT_MS;
        const timer = setTimeout(() => end(i18next.t('machines:direct.timedOut', { seconds: Math.round(timeoutMs / 1000) })), timeoutMs);

        const sendFrame = (data: string): void => {
            if (!channel || channel.readyState !== 'open') {
                return;
            }
            try {
                for (const piece of splitFrame(data)) {
                    channel.send(piece);
                }
            } catch (e) {
                end(i18next.t('machines:direct.frameRefused', { reason: messageOf(e) }));
            }
        };

        const onSignal = (incoming: Signal): void => {
            if (ended) {
                return;
            }
            if (incoming.kind === 'answer' && peer && offerSdp !== null && binding === null) {
                binding = channelBinding(offerSdp, incoming.sdp);
                void peer
                    .setRemoteDescription({ type: 'answer', sdp: incoming.sdp })
                    .catch((e) => end(i18next.t('machines:direct.answerNotApplied', { reason: messageOf(e) })));
                return;
            }
            if (incoming.kind === 'candidate' && peer && incoming.candidate !== '') {
                void fireAndForget(
                    'peer.addIceCandidate',
                    peer.addIceCandidate({ candidate: incoming.candidate, sdpMid: incoming.sdpMid, sdpMLineIndex: incoming.sdpMLineIndex })
                );
                return;
            }
            if (incoming.kind === 'close') {
                if (incoming.reason === 'not-paired') {
                    options.unknownKey?.();
                }
                end(closeReason(incoming.reason));
            }
        };

        const onHandshakeFrame = async (raw: string): Promise<void> => {
            const frame = parseHandshakeFrame(JSON.parse(raw));
            if (frame === null) {
                throw new Error(i18next.t('machines:direct.badHandshake'));
            }
            if (frame.type === 'direct.challenge') {
                if (binding === null) {
                    throw new Error(i18next.t('machines:direct.channelEarly'));
                }
                // Checked before anything is proved, since a machine on another wire could not read what follows anyway.
                const mismatch = protocolMismatch(frame.protocol);
                if (mismatch !== null) {
                    end(protocolRefusal(mismatch));
                    return;
                }
                const proof = await options.prove(frame, binding);
                deflating = frame.compression?.includes(DIRECT_COMPRESSION) === true && typeof DecompressionStream === 'function';
                sendFrame(JSON.stringify(deflating ? { ...proof, compression: DIRECT_COMPRESSION } : proof));
                return;
            }
            if (frame.type === 'direct.refused') {
                const mismatch = frame.protocol === undefined ? null : protocolMismatch(frame.protocol);
                end(mismatch !== null ? protocolRefusal(mismatch) : i18next.t('machines:direct.refusedVerdict', { reason: frame.reason }));
                return;
            }
            authenticated = true;
            clearTimeout(timer);
            let received: number | null = null;
            let relayed: boolean | null = null;
            let sampling = false;
            liveness = new ChannelLiveness({
                ping: (id) => sendFrame(directPingFrame(id)),
                dead: () => end(i18next.t('machines:direct.dead')),
                received: () => received,
                idleMs: options.pingIdleMs,
                timeoutMs: options.pingTimeoutMs
            });
            const measured = peer;
            livenessTimer = setInterval(() => {
                // A stats call that never settles must not stop the check, so it goes on with the count it has.
                if (sampling || !measured) {
                    liveness?.tick();
                    return;
                }
                sampling = true;
                void statsOf(measured).then((stats) => {
                    sampling = false;
                    if (stats.bytes !== null) {
                        received = stats.bytes;
                    }
                    if (ended) {
                        return;
                    }
                    // ICE may settle on a direct pair after it first sent over the relay, so the path is read every tick.
                    if (stats.relayed !== null && stats.relayed !== relayed) {
                        relayed = stats.relayed;
                        events.route?.(relayed);
                    }
                    liveness?.tick();
                });
            }, options.pingTickMs ?? DIRECT_PING_TICK_MS);
            options.accepted?.(frame.ticket);
            // The channel stands on its own from here; the route the signals took was only ever for them.
            closeSignaling();
            events.open();
        };

        const deliver = (frame: string | Uint8Array | Promise<string>): void => {
            if (backlog === 0 && !(frame instanceof Promise)) {
                events.message(frame);
                return;
            }
            backlog += 1;
            delivered = delivered.then(async () => {
                try {
                    const ready = await frame;
                    if (!ended) {
                        events.message(ready);
                    }
                } catch {
                    end(i18next.t('machines:direct.badFrame'));
                } finally {
                    backlog -= 1;
                }
            });
        };

        // Only what a request asked for in binary comes this way, so nothing reads one before the handshake.
        const onBinaryPiece = (piece: Uint8Array): void => {
            const result = authenticated ? binaryAssembler.push(piece, BINARY_FRAME_BYTES) : ({ kind: 'invalid' } as const);
            if (result.kind === 'invalid') {
                end(i18next.t('machines:direct.badFrame'));
                return;
            }
            if (result.kind === 'frame') {
                deliver(result.frame);
            }
        };

        // Only a machine this client chose deflate with sends these, and only once it let the client in.
        const onDeflatedPiece = (piece: Uint8Array): void => {
            const result = authenticated && deflating ? deflatedAssembler.push(piece, INFLATED_FRAME_BYTES) : ({ kind: 'invalid' } as const);
            if (result.kind === 'invalid') {
                end(i18next.t('machines:direct.badFrame'));
                return;
            }
            if (result.kind === 'frame') {
                deliver(inflateFrame(result.frame));
            }
        };

        const onPiece = (data: unknown): void => {
            if (ended) {
                return;
            }
            // Every piece is a sign of life, so a connection busy with a large frame is never pinged.
            liveness?.heard();
            if (data instanceof ArrayBuffer) {
                const bytes = new Uint8Array(data);
                if (isBinaryPiece(bytes)) {
                    onBinaryPiece(bytes);
                    return;
                }
                if (isDeflatedPiece(bytes)) {
                    onDeflatedPiece(bytes);
                    return;
                }
            }
            const piece = typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer);
            const result = assembler.push(piece, authenticated ? FRAME_CHARS : HANDSHAKE_FRAME_CHARS);
            if (result.kind === 'invalid') {
                end(i18next.t('machines:direct.badFrame'));
                return;
            }
            if (result.kind === 'partial') {
                return;
            }
            if (authenticated) {
                deliver(result.frame);
                return;
            }
            void onHandshakeFrame(result.frame).catch((e) => end(messageOf(e)));
        };

        const negotiate = async (routeServers: RTCIceServer[]): Promise<void> => {
            const created = (options.createPeer ?? ((configuration) => new RTCPeerConnection(configuration)))({
                iceServers: mergeIceServers(options.iceServers, routeServers)
            });
            peer = created;
            channel = created.createDataChannel(DIRECT_CHANNEL_LABEL, { ordered: true });
            channel.binaryType = 'arraybuffer';
            channel.onmessage = (message) => onPiece(message.data);
            channel.onclose = () => end(i18next.t(authenticated ? 'machines:direct.channelClosed' : 'machines:direct.channelClosedEarly'));
            created.onconnectionstatechange = () => {
                if (created.connectionState === 'failed') {
                    end(
                        routeServers.some((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => /^turns?:/.test(url)))
                            ? i18next.t('machines:direct.noPathWithRelay')
                            : i18next.t('machines:direct.noPath')
                    );
                }
            };
            await created.setLocalDescription(await created.createOffer());
            await gathered(created, options.gatherMs ?? ICE_GATHER_TIMEOUT_MS);
            if (ended) {
                return;
            }
            offerSdp = created.localDescription?.sdp ?? null;
            if (offerSdp === null) {
                throw new Error(i18next.t('machines:direct.noOffer'));
            }
            signaling?.send({ kind: 'offer', sdp: offerSdp });
        };

        const open = options.signaling ?? ((address: string) => socketSignaling(address, options.createSocket));
        const opened = open(url)(connectionId, {
            ready: (routeServers) => {
                if (!ended) {
                    void negotiate(routeServers ?? []).catch((e) => end(i18next.t('machines:direct.setupFailed', { reason: messageOf(e) })));
                }
            },
            signal: onSignal,
            fail: (reason) => end(reason)
        });
        // A route that failed while it was being opened already ended the link, and is nothing to hold on to.
        if (ended) {
            opened.close();
        } else {
            signaling = opened;
        }

        return {
            send: (data) => {
                if (authenticated) {
                    sendFrame(data);
                }
            },
            close: () => end(null)
        };
    };
}

/*
 * From one stats report: the bytes the DTLS transport under the channel received, the packets of a
 * message that is not whole yet included, and whether the pair in use is relayed; null where the
 * browser does not say.
 */
async function statsOf(peer: RTCPeerConnection): Promise<{ bytes: number | null; relayed: boolean | null }> {
    try {
        const report = await peer.getStats();
        let total: number | null = null;
        for (const entry of report.values() as IterableIterator<{ type?: string; bytesReceived?: unknown }>) {
            if (entry.type === 'transport' && typeof entry.bytesReceived === 'number') {
                total = (total ?? 0) + entry.bytesReceived;
            }
        }
        return { bytes: total, relayed: relayedFromStats(report) };
    } catch {
        return { bytes: null, relayed: null };
    }
}

/* Waits for ICE to finish gathering, so the offer carries every candidate and nothing has to trickle. */
function gathered(peer: RTCPeerConnection, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
        if (peer.iceGatheringState === 'complete') {
            resolve();
            return;
        }
        const done = (): void => {
            clearTimeout(timer);
            peer.removeEventListener('icegatheringstatechange', check);
            resolve();
        };
        const check = (): void => {
            if (peer.iceGatheringState === 'complete') {
                done();
            }
        };
        const timer = setTimeout(done, timeoutMs);
        peer.addEventListener('icegatheringstatechange', check);
    });
}

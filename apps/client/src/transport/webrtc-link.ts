import {
    ChannelLiveness,
    channelBinding,
    DIRECT_PING_TICK_MS,
    directPingFrame,
    DIRECT_CHANNEL_LABEL,
    DirectChallengeFrameSchema,
    DirectVerdictFrameSchema,
    FrameAssembler,
    protocolMismatch,
    splitFrame,
    type DirectChallengeFrame,
    type DirectProofFrame
} from '@ruimte/contracts';
import { mergeIceServers, relayedFromStats } from './ice';
import type { Link, LinkOpener } from './link-transport';
import { protocolRefusal } from './protocol';
import { socketSignaling, type Signal, type Signaling, type SignalingOpener } from './signaling';

// Offer to handshake; ICE with a STUN server that answers slowly still fits, a path that does not exist does not.
const CONNECT_TIMEOUT_MS = 20_000;

// How long ICE may gather before the offer goes out with the candidates it has.
const GATHER_TIMEOUT_MS = 5_000;

// The same ceiling the daemon holds a channel to once it is in; the handshake frames are a few hundred bytes.
const FRAME_CHARS = 16 * 1024 * 1024;
const HANDSHAKE_FRAME_CHARS = 4_096;

// How long a close waits for the channel to report closed before the peer goes anyway.
const CLOSE_GRACE_MS = 2_000;

export interface WebRtcLinkOptions {
    /* This client's own servers; the signaling route may add its own for the attempt (TURN from the broker). */
    iceServers: RTCIceServer[];
    /* The answer to the daemon's challenge; throws when the daemon did not prove itself. */
    prove(challenge: DirectChallengeFrame, binding: string): Promise<DirectProofFrame>;
    /* The daemon let this client in; the ticket is for the HTTP routes an `<img>` still fetches. */
    accepted?(ticket: string | null): void;
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

const CLOSE_REASONS: Record<string, string> = {
    declined: 'The machine is opening too many direct connections at once',
    failed: 'The machine could not answer the direct connection',
    timeout: 'The machine gave up waiting for the direct connection',
    done: 'The machine ended the direct connection',
    'not-paired': 'The machine does not know this client. Its access was revoked, or it lost the pairing; pair again to connect.',
    'statements-refused': 'The machine turns away sign-in through an account. Pair with a link to connect.'
};

const connectionIdOf = (): string => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');
};

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/*
 * A daemon's wire over a WebRTC DataChannel. The offer and the answer travel however `signaling`
 * says (a socket to the machine, or the broker), and that route is closed the moment the channel is
 * in. The channel then runs its own handshake as its first frames, bound to its DTLS fingerprints,
 * and only after the daemon's verdict does the link report open. Every way this can fail ends the
 * link with a sentence for the machine's row, because a direct connection that silently turned into
 * a socket would test nothing.
 */
export const webRtcLink =
    (options: WebRtcLinkOptions): LinkOpener =>
    (url, events): Link => {
        const connectionId = connectionIdOf();
        const assembler = new FrameAssembler();
        let ended = false;
        let authenticated = false;
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

        const timer = setTimeout(
            () => end(`The direct connection did not come up within ${Math.round((options.timeoutMs ?? CONNECT_TIMEOUT_MS) / 1000)} seconds`),
            options.timeoutMs ?? CONNECT_TIMEOUT_MS
        );

        const sendFrame = (data: string): void => {
            if (!channel || channel.readyState !== 'open') {
                return;
            }
            try {
                for (const piece of splitFrame(data)) {
                    channel.send(piece);
                }
            } catch (e) {
                end(`The direct connection refused a frame: ${messageOf(e)}`);
            }
        };

        const onSignal = (incoming: Signal): void => {
            if (ended) {
                return;
            }
            if (incoming.kind === 'answer' && peer && offerSdp !== null && binding === null) {
                binding = channelBinding(offerSdp, incoming.sdp);
                void peer.setRemoteDescription({ type: 'answer', sdp: incoming.sdp }).catch((e) => end(`The machine's answer did not apply: ${messageOf(e)}`));
                return;
            }
            if (incoming.kind === 'candidate' && peer && incoming.candidate !== '') {
                void peer
                    .addIceCandidate({ candidate: incoming.candidate, sdpMid: incoming.sdpMid, sdpMLineIndex: incoming.sdpMLineIndex })
                    .catch(() => undefined);
                return;
            }
            if (incoming.kind === 'close') {
                end(CLOSE_REASONS[incoming.reason] ?? 'The machine closed the direct connection');
            }
        };

        const onHandshakeFrame = async (raw: string): Promise<void> => {
            const json = JSON.parse(raw) as unknown;
            const challenge = DirectChallengeFrameSchema.safeParse(json);
            if (challenge.success) {
                if (binding === null) {
                    throw new Error('The channel opened before the answer that describes it');
                }
                // Checked before anything is proved: a machine on another wire could not read what follows anyway.
                const mismatch = protocolMismatch(challenge.data.protocol);
                if (mismatch !== null) {
                    end(protocolRefusal(mismatch));
                    return;
                }
                sendFrame(JSON.stringify(await options.prove(challenge.data, binding)));
                return;
            }
            const verdict = DirectVerdictFrameSchema.safeParse(json);
            if (!verdict.success) {
                throw new Error('The machine answered the direct connection with something other than its handshake');
            }
            if (verdict.data.type === 'direct.refused') {
                const mismatch = verdict.data.protocol === undefined ? null : protocolMismatch(verdict.data.protocol);
                end(mismatch !== null ? protocolRefusal(mismatch) : `The machine refused the direct connection: ${verdict.data.reason}`);
                return;
            }
            authenticated = true;
            clearTimeout(timer);
            let received: number | null = null;
            let relayed: boolean | null = null;
            let sampling = false;
            liveness = new ChannelLiveness({
                ping: (id) => sendFrame(directPingFrame(id)),
                dead: () => end('The machine stopped answering over the direct connection'),
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
            options.accepted?.(verdict.data.ticket);
            // The channel stands on its own from here; the route the signals took was only ever for them.
            closeSignaling();
            events.open();
        };

        const onPiece = (data: unknown): void => {
            if (ended) {
                return;
            }
            // Every piece is a sign of life, so a connection busy with a large frame is never pinged.
            liveness?.heard();
            const piece = typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer);
            const result = assembler.push(piece, authenticated ? FRAME_CHARS : HANDSHAKE_FRAME_CHARS);
            if (result.kind === 'invalid') {
                end('The machine sent a frame this client cannot read');
                return;
            }
            if (result.kind === 'partial') {
                return;
            }
            if (authenticated) {
                events.message(result.frame);
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
            channel.onmessage = (message) => onPiece(message.data);
            channel.onclose = () => end(authenticated ? 'The direct connection closed' : 'The channel closed before the machine let this client in');
            created.onconnectionstatechange = () => {
                if (created.connectionState === 'failed') {
                    end(
                        routeServers.some((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => /^turns?:/.test(url)))
                            ? 'No network path to the machine: ICE failed, through the relay as well.'
                            : 'No network path to the machine: ICE failed. A direct connection needs UDP between both sides, and this route offers no relay.'
                    );
                }
            };
            await created.setLocalDescription(await created.createOffer());
            await gathered(created, options.gatherMs ?? GATHER_TIMEOUT_MS);
            if (ended) {
                return;
            }
            offerSdp = created.localDescription?.sdp ?? null;
            if (offerSdp === null) {
                throw new Error('The browser made no offer');
            }
            signaling?.send({ kind: 'offer', sdp: offerSdp });
        };

        const open = options.signaling ?? ((address: string) => socketSignaling(address, options.createSocket));
        const opened = open(url)(connectionId, {
            ready: (routeServers) => {
                if (!ended) {
                    void negotiate(routeServers ?? []).catch((e) => end(`Could not set up a direct connection: ${messageOf(e)}`));
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

/*
 * From one stats report: the bytes the DTLS transport under the channel received, the packets of a
 * message that is not whole yet included, and whether the pair in use is relayed; null where the
 * browser does not say.
 */
const statsOf = async (peer: RTCPeerConnection): Promise<{ bytes: number | null; relayed: boolean | null }> => {
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
};

/* Waits for ICE to finish gathering, so the offer carries every candidate and nothing has to trickle. */
const gathered = (peer: RTCPeerConnection, timeoutMs: number): Promise<void> =>
    new Promise((resolve) => {
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

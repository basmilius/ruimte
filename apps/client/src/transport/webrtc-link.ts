import {
    channelBinding,
    DIRECT_CHANNEL_LABEL,
    DirectChallengeFrameSchema,
    DirectSignalPayloadSchema,
    DirectVerdictFrameSchema,
    FrameAssembler,
    splitFrame,
    type DirectChallengeFrame,
    type DirectProofFrame,
    type DirectSignalPayload
} from '@ruimte/contracts';
import type { Link, LinkOpener } from './link-transport';

type Signal = DirectSignalPayload['envelope']['signal'];

// Offer to handshake; ICE with a STUN server that answers slowly still fits, a path that does not exist does not.
const CONNECT_TIMEOUT_MS = 20_000;

// How long ICE may gather before the offer goes out with the candidates it has.
const GATHER_TIMEOUT_MS = 5_000;

// The same ceiling the daemon holds a channel to once it is in; the handshake frames are a few hundred bytes.
const FRAME_CHARS = 16 * 1024 * 1024;
const HANDSHAKE_FRAME_CHARS = 4_096;

export interface WebRtcLinkOptions {
    iceServers: RTCIceServer[];
    /* The answer to the daemon's challenge; throws when the daemon did not prove itself. */
    prove(challenge: DirectChallengeFrame, binding: string): Promise<DirectProofFrame>;
    /* The daemon let this client in; the ticket is for the HTTP routes an `<img>` still fetches. */
    accepted?(ticket: string | null): void;
    createPeer?(configuration: RTCConfiguration): RTCPeerConnection;
    createSocket?(url: string): WebSocket;
    timeoutMs?: number;
    gatherMs?: number;
}

const CLOSE_REASONS: Record<string, string> = {
    declined: 'The machine is opening too many direct connections at once',
    failed: 'The machine could not answer the direct connection',
    timeout: 'The machine gave up waiting for the direct connection',
    done: 'The machine ended the direct connection'
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
 * A daemon's wire over a WebRTC DataChannel. The address is the socket URL the transport resolved for
 * this attempt, credential and all; that socket only carries the offer and the answer (there is no
 * broker yet) and is closed the moment the channel is in. The channel then runs its own handshake as
 * its first frames, bound to its DTLS fingerprints, and only after the daemon's verdict does the link
 * report open. Every way this can fail ends the link with a sentence for the machine's row, because a
 * direct connection that silently turned into a socket would test nothing.
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
        let socket: WebSocket | null = null;
        let nextSignal = 1;

        const closeSocket = (): void => {
            if (!socket) {
                return;
            }
            socket.onclose = null;
            socket.onmessage = null;
            socket.onopen = null;
            socket.close();
            socket = null;
        };

        const end = (failure: string | null): void => {
            if (ended) {
                return;
            }
            ended = true;
            clearTimeout(timer);
            closeSocket();
            if (channel) {
                channel.onclose = null;
                channel.onmessage = null;
                channel.close();
            }
            if (peer) {
                peer.onconnectionstatechange = null;
                peer.close();
            }
            events.close(failure);
        };

        const timer = setTimeout(
            () => end(`The direct connection did not come up within ${Math.round((options.timeoutMs ?? CONNECT_TIMEOUT_MS) / 1000)} seconds`),
            options.timeoutMs ?? CONNECT_TIMEOUT_MS
        );

        const signal = (outgoing: Signal): void => {
            socket?.send(JSON.stringify({ id: `direct-${nextSignal++}`, type: 'direct.signal', payload: { envelope: { connectionId, signal: outgoing } } }));
        };

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

        const onSignalingFrame = (raw: string): void => {
            let frame: { id?: unknown; ok?: unknown; error?: { message?: string }; type?: unknown; event?: unknown; payload?: unknown };
            try {
                frame = JSON.parse(raw) as typeof frame;
            } catch {
                return;
            }
            if (typeof frame.id === 'string' && frame.id.startsWith('direct-') && frame.ok === false) {
                // A daemon from before direct connections answers `unknown-request`, which is worth saying in so many words.
                end(`The machine did not take the direct connection: ${frame.error?.message ?? 'no reason given'}`);
                return;
            }
            if (frame.type !== 'event' || frame.event !== 'direct.signaled') {
                return;
            }
            const parsed = DirectSignalPayloadSchema.safeParse(frame.payload);
            if (parsed.success && parsed.data.envelope.connectionId === connectionId) {
                onSignal(parsed.data.envelope.signal);
            }
        };

        const onHandshakeFrame = async (raw: string): Promise<void> => {
            const json = JSON.parse(raw) as unknown;
            const challenge = DirectChallengeFrameSchema.safeParse(json);
            if (challenge.success) {
                if (binding === null) {
                    throw new Error('The channel opened before the answer that describes it');
                }
                sendFrame(JSON.stringify(await options.prove(challenge.data, binding)));
                return;
            }
            const verdict = DirectVerdictFrameSchema.safeParse(json);
            if (!verdict.success) {
                throw new Error('The machine answered the direct connection with something other than its handshake');
            }
            if (verdict.data.type === 'direct.refused') {
                end(`The machine refused the direct connection: ${verdict.data.reason}`);
                return;
            }
            authenticated = true;
            clearTimeout(timer);
            options.accepted?.(verdict.data.ticket);
            // The channel stands on its own from here; the socket was only ever for the signals.
            closeSocket();
            events.open();
        };

        const onPiece = (data: unknown): void => {
            if (ended) {
                return;
            }
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

        const negotiate = async (): Promise<void> => {
            const created = (options.createPeer ?? ((configuration) => new RTCPeerConnection(configuration)))({ iceServers: options.iceServers });
            peer = created;
            channel = created.createDataChannel(DIRECT_CHANNEL_LABEL, { ordered: true });
            channel.onmessage = (message) => onPiece(message.data);
            channel.onclose = () => end(authenticated ? 'The direct connection closed' : 'The channel closed before the machine let this client in');
            created.onconnectionstatechange = () => {
                if (created.connectionState === 'failed') {
                    end('No network path to the machine: ICE failed. A direct connection needs UDP between both sides, and there is no relay yet.');
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
            signal({ kind: 'offer', sdp: offerSdp });
        };

        try {
            socket = (options.createSocket ?? ((address) => new WebSocket(address)))(url);
        } catch (e) {
            end(`The machine could not be reached to set up a direct connection: ${messageOf(e)}`);
            return { send: () => undefined, close: () => undefined };
        }
        socket.onopen = () => {
            void negotiate().catch((e) => end(`Could not set up a direct connection: ${messageOf(e)}`));
        };
        socket.onmessage = (message) => onSignalingFrame(String(message.data));
        socket.onclose = () => end('The machine could not be reached to set up a direct connection');
        socket.onerror = () => {};

        return {
            send: (data) => {
                if (authenticated) {
                    sendFrame(data);
                }
            },
            close: () => end(null)
        };
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

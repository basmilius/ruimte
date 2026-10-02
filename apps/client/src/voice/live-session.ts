import i18next from 'i18next';
import { desktop, type OpenAiLivePreferences } from '@/desktop/bridge';

export interface LiveEvent {
    type: string;
    [key: string]: unknown;
}

const gatheringComplete = (peer: RTCPeerConnection): Promise<void> => {
    if (peer.iceGatheringState === 'complete') {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const changed = (): void => {
            if (peer.iceGatheringState === 'complete') {
                peer.removeEventListener('icegatheringstatechange', changed);
                resolve();
            }
        };
        peer.addEventListener('icegatheringstatechange', changed);
    });
};

export interface LiveSessionParts {
    peer: RTCPeerConnection;
    audio: HTMLAudioElement;
}

export class LiveSession {
    readonly #peer: RTCPeerConnection;
    readonly #events: RTCDataChannel;
    readonly #audio: HTMLAudioElement;
    readonly #onEvent: (event: LiveEvent) => void;
    readonly #onOutputStream: (stream: MediaStream) => void;
    #closed = false;

    /* `onLost` is called once when the connection goes without `close`, as after a sleep or a dropped network. */
    constructor(
        onEvent: (event: LiveEvent) => void,
        onOutputStream: (stream: MediaStream) => void,
        onLost: () => void,
        parts: LiveSessionParts = { peer: new RTCPeerConnection(), audio: new Audio() }
    ) {
        this.#peer = parts.peer;
        this.#events = this.#peer.createDataChannel('oai-events');
        this.#audio = parts.audio;
        this.#onEvent = onEvent;
        this.#onOutputStream = onOutputStream;
        const lost = (): void => {
            if (!this.#closed) {
                this.#closed = true;
                onLost();
            }
        };
        this.#peer.addEventListener('connectionstatechange', () => {
            if (this.#peer.connectionState === 'failed' || this.#peer.connectionState === 'closed') {
                lost();
            }
        });
        this.#events.addEventListener('close', lost);
        this.#audio.autoplay = true;
        this.#peer.addEventListener('track', (event) => {
            const stream = event.streams[0] ?? new MediaStream([event.track]);
            this.#audio.srcObject = stream;
            this.#onOutputStream(stream);
            void this.#audio.play().catch(() => undefined);
        });
        this.#events.addEventListener('message', (message) => {
            try {
                const event: unknown = JSON.parse(String(message.data));
                if (typeof event === 'object' && event !== null && typeof (event as LiveEvent).type === 'string') {
                    this.#onEvent(event as LiveEvent);
                }
            } catch {
                // A malformed service event cannot be acted on and does not end the audio session.
            }
        });
    }

    async start(stream: MediaStream, preferences: OpenAiLivePreferences): Promise<void> {
        const bridge = desktop()?.openAi;
        if (!bridge?.createLiveSession) {
            throw new Error('GPT-Live needs the Ruimte desktop app');
        }
        for (const track of stream.getTracks()) {
            this.#peer.addTrack(track, stream);
        }
        await this.#peer.setLocalDescription(await this.#peer.createOffer());
        await gatheringComplete(this.#peer);
        const offer = this.#peer.localDescription?.sdp;
        if (!offer) {
            throw new Error(i18next.t('voice:error.noSession'));
        }
        const answer = await bridge.createLiveSession(offer, preferences);
        await this.#peer.setRemoteDescription({ type: 'answer', sdp: answer.transport.sdp });
    }

    send(event: LiveEvent): boolean {
        if (this.#events.readyState === 'open') {
            this.#events.send(JSON.stringify(event));
            return true;
        }
        return false;
    }

    close(): void {
        this.#closed = true;
        this.send({ type: 'session.close' });
        this.#events.close();
        this.#peer.close();
        this.#audio.srcObject = null;
    }
}

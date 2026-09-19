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

export class LiveSession {
    readonly #peer = new RTCPeerConnection();
    readonly #events = this.#peer.createDataChannel('oai-events');
    readonly #audio = new Audio();
    readonly #onEvent: (event: LiveEvent) => void;
    readonly #onOutputStream: (stream: MediaStream) => void;

    constructor(onEvent: (event: LiveEvent) => void, onOutputStream: (stream: MediaStream) => void) {
        this.#onEvent = onEvent;
        this.#onOutputStream = onOutputStream;
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

    send(event: LiveEvent): void {
        if (this.#events.readyState === 'open') {
            this.#events.send(JSON.stringify(event));
        }
    }

    close(): void {
        this.send({ type: 'session.close' });
        this.#events.close();
        this.#peer.close();
        this.#audio.srcObject = null;
    }
}

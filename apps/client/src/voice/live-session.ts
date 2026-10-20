import i18next from 'i18next';
import { localTimeZone } from '@adecore/ui/format';
import type { RequestMap, RequestType } from '@ruimte/contracts';
import type { LiveEvent } from '@ruimte/voice';
import { desktop, type OpenAiLivePreferences } from '@/desktop/bridge';
import { useDocument } from '@/state/document';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { machineTransport } from '@/transport';
import { voiceOnMachine } from '@/voice/route';

function gatheringComplete(peer: RTCPeerConnection): Promise<void> {
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
}

export interface LiveSessionParts {
    peer: RTCPeerConnection;
    audio: HTMLAudioElement;
}

/* Who mints the session for the offer of this window, and whether the window runs its tools itself. */
export interface LiveSessionRoute {
    /* Answers the SDP of the session minted for the offer. */
    start(offer: string, preferences: OpenAiLivePreferences): Promise<string>;
    /*
     * False when the machine runs the tools and sends every append over its sideband: the window then hands
     * its tool loop no call and sends nothing on the data channel, which the machine would take for another
     * client steering its session.
     */
    readonly windowEvents: boolean;
    stop(): void;
}

/* The desktop app mints with the key in its keychain, and the window runs the tools. */
export function desktopRoute(): LiveSessionRoute {
    return {
        windowEvents: true,
        async start(offer, preferences) {
            const bridge = desktop()?.openAi;
            if (!bridge?.createLiveSession) {
                throw new Error('GPT-Live needs the Ruimte desktop app');
            }
            return (await bridge.createLiveSession(offer, preferences)).transport.sdp;
        },
        stop: () => undefined
    };
}

type MachineRequest = <T extends RequestType>(type: T, payload: RequestMap[T]['payload']) => Promise<RequestMap[T]['result']>;

/*
 * The machine of this window mints with its own key and runs every tool, the route of a phone (`voice.start`).
 * Development only: a stand-in for the phone while the iOS app is not there yet.
 */
export function machineRoute(request: MachineRequest = (type, payload) => machineTransport(currentEndpointId()).request(type, payload)): LiveSessionRoute {
    const sceneId = `window-${crypto.randomUUID()}`;
    const startId = crypto.randomUUID();
    let sessionId: string | null = null;
    let started = false;
    return {
        windowEvents: false,
        async start(offer, preferences) {
            const projectId = useProject.getState().current?.projectId;
            if (projectId === undefined) {
                throw new Error(i18next.t('voice:error.noSession'));
            }
            const viewId = useDocument.getState().activeViewId;
            started = true;
            const answer = await request('voice.start', {
                startId,
                sceneId,
                projectId,
                sdp: offer,
                language: preferences.language,
                voice: preferences.voice,
                timeZone: localTimeZone() ?? 'UTC',
                ...(viewId === null ? {} : { viewId })
            });
            sessionId = answer.sessionId;
            return answer.sdp;
        },
        stop() {
            if (!started) {
                return;
            }
            const target = sessionId === null ? { sceneId, startId } : { sceneId, sessionId };
            void request('voice.stop', target).catch(() => undefined);
        }
    };
}

/* The machine's own key status stands in for the desktop's while the window runs on the machine route. */
export async function machineVoiceCredential(): Promise<{ configured: boolean; persistent: boolean }> {
    const status = await machineTransport(currentEndpointId()).request('voice.keyStatus', {});
    return { configured: status.present, persistent: true };
}

export function liveSessionRoute(): LiveSessionRoute {
    return voiceOnMachine() ? machineRoute() : desktopRoute();
}

export class LiveSession {
    readonly #peer: RTCPeerConnection;
    readonly #events: RTCDataChannel;
    readonly #audio: HTMLAudioElement;
    readonly #onEvent: (event: LiveEvent) => void;
    readonly #onOutputStream: (stream: MediaStream) => void;
    readonly #route: LiveSessionRoute;
    #closed = false;

    /* `onLost` is called once when the connection goes without `close`, as after a sleep or a dropped network. */
    constructor(
        onEvent: (event: LiveEvent) => void,
        onOutputStream: (stream: MediaStream) => void,
        onLost: () => void,
        parts: LiveSessionParts = { peer: new RTCPeerConnection(), audio: new Audio() },
        route: LiveSessionRoute = liveSessionRoute()
    ) {
        this.#route = route;
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
                    // On the machine route the backend's calls are the machine's to run.
                    if (!this.#route.windowEvents && (event as LiveEvent).type === 'response.event') {
                        return;
                    }
                    this.#onEvent(event as LiveEvent);
                }
            } catch {
                // A malformed service event cannot be acted on and does not end the audio session.
            }
        });
    }

    async start(stream: MediaStream, preferences: OpenAiLivePreferences): Promise<void> {
        if (this.#route.windowEvents && !desktop()?.openAi?.createLiveSession) {
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
        const answer = await this.#route.start(offer, preferences);
        await this.#peer.setRemoteDescription({ type: 'answer', sdp: answer });
    }

    send(event: LiveEvent): boolean {
        if (!this.#route.windowEvents) {
            return false;
        }
        if (this.#events.readyState === 'open') {
            this.#events.send(JSON.stringify(event));
            return true;
        }
        return false;
    }

    close(): void {
        this.#closed = true;
        this.send({ type: 'session.close' });
        this.#route.stop();
        this.#events.close();
        this.#peer.close();
        this.#audio.srcObject = null;
    }
}

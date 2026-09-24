import type { SpeechBridge } from '@ruimte/desktop-bridge';
import { SpeechCapture } from '@/audio/capture';
import { ensureMicrophoneAccess, openMicrophoneStream } from '@/audio/microphone';
import { desktop } from '@/desktop/bridge';
import { DictationError, type DictationEngine, type DictationHandlers, type DictationOptions, type DictationSession } from './engine';

export interface Capture {
    start(stream: MediaStream): Promise<void>;
    finish(): Promise<void>;
    stop(): void;
}

export class HelperSession implements DictationSession {
    readonly #id = crypto.randomUUID();
    readonly #bridge: SpeechBridge;
    readonly #handlers: DictationHandlers;
    readonly #capture: Capture;
    readonly #release: () => void;
    #stream: MediaStream | null = null;
    #ended = false;
    #stopping = false;
    #ready = false;
    #queued = 0;
    #pending = Promise.resolve();

    constructor(
        options: DictationOptions,
        handlers: DictationHandlers,
        dependencies?: {
            bridge: SpeechBridge;
            requestMicrophoneAccess?(): Promise<boolean>;
            openMicrophone(deviceId: string): Promise<MediaStream>;
            capture(onSamples: (samples: Float32Array) => void, onBands?: (bands: number[]) => void): Capture;
        }
    ) {
        const bridge = dependencies?.bridge ?? desktop()?.speech;
        if (!bridge?.onEvent) {
            throw new DictationError('noBridge');
        }
        this.#bridge = bridge;
        this.#handlers = handlers;
        const onSamples = (samples: Float32Array): void => {
            if (this.#ended) {
                return;
            }
            if (++this.#queued > 64) {
                this.#fail(new DictationError('overrun'));
                return;
            }
            this.#pending = this.#pending
                .then(async () => {
                    if (!this.#ended) {
                        await bridge.samples(this.#id, samples);
                    }
                })
                .catch((error: unknown) => this.#fail(error))
                .finally(() => {
                    this.#queued--;
                });
        };
        this.#capture = dependencies ? dependencies.capture(onSamples, handlers.onBands) : new SpeechCapture(onSamples, handlers.onBands);
        this.#release = bridge.onEvent((event) => {
            if (this.#ended || event.sessionId !== this.#id) {
                return;
            }
            if (event.type === 'transcript') {
                handlers.onChunk({ text: event.text, final: event.final });
            } else if (event.type === 'failed') {
                this.#fail(new DictationError('recognition', event.message));
            } else if (event.type === 'ended') {
                this.#end();
            }
        });
        void this.#run(options, dependencies?.requestMicrophoneAccess, dependencies?.openMicrophone ?? openMicrophoneStream).catch((error: unknown) =>
            this.#fail(error)
        );
    }

    async #run(
        options: DictationOptions,
        requestAccess: (() => Promise<boolean>) | undefined,
        open: (deviceId: string) => Promise<MediaStream>
    ): Promise<void> {
        // Before the model loads, so the system's prompt shows at the press and a refusal never starts the helper.
        await ensureMicrophoneAccess(requestAccess);
        if (this.#ended) {
            return;
        }
        await this.#bridge.start(this.#id, options.language);
        if (this.#ended) {
            return;
        }
        const stream = await open(options.deviceId ?? 'default');
        if (this.#ended) {
            stream.getTracks().forEach((track) => track.stop());
            return;
        }
        this.#stream = stream;
        await this.#capture.start(stream);
        if (this.#ended) {
            this.#capture.stop();
            return;
        }
        this.#ready = true;
        this.#handlers.onReady?.();
    }

    #end(): void {
        if (this.#ended) {
            return;
        }
        this.#ended = true;
        this.#stream?.getTracks().forEach((track) => track.stop());
        this.#stream = null;
        this.#capture.stop();
        this.#release();
        this.#handlers.onEnd();
    }

    #fail(error: unknown): void {
        if (this.#ended) {
            return;
        }
        this.#handlers.onError(error instanceof Error ? error : new Error(String(error)));
        this.cancel();
    }

    stop(): void {
        if (this.#ended || this.#stopping) {
            return;
        }
        if (!this.#ready) {
            this.cancel();
            return;
        }
        this.#stopping = true;
        this.#stream?.getTracks().forEach((track) => track.stop());
        this.#stream = null;
        void this.#finish().catch((error: unknown) => this.#fail(error));
    }

    async #finish(): Promise<void> {
        await this.#capture.finish();
        this.#capture.stop();
        await this.#pending;
        if (!this.#ended) {
            await this.#bridge.stop(this.#id);
        }
    }

    cancel(): void {
        if (this.#ended) {
            return;
        }
        this.#end();
        void this.#bridge.cancel(this.#id).catch(() => undefined);
    }
}

export const helperEngine: DictationEngine = {
    start: (options, handlers) => new HelperSession(options, handlers)
};

/*
 * Pulls raw samples off a microphone at the rate a speech model wants. The `AudioContext` does the
 * resampling: asking it for 16 kHz is how a 48 kHz microphone becomes something a model can read,
 * and doing it here means no other file has to know the rate.
 */

import { SPEECH_SPECTRUM_BAND_COUNT, spectrumBands, easeBands } from '@/audio/waveform';

export const SPEECH_SAMPLE_RATE = 16_000;

/*
 * The worklet is a file of its own and loaded by URL. A blob would be simpler but the policy in
 * `packages/csp` allows a script from this origin only, and a worklet is a script.
 */
const WORKLET_URL = new URL('./speech-tap.js', import.meta.url);

/*
 * Reads a stream until `stop`. The samples handed over are a copy, because the shell serializes them
 * on its own schedule and the worklet reuses nothing it has already sent.
 *
 * The spectrum uses the same microphone graph as recognition.
 */
export class SpeechCapture {
    readonly #onSamples: (samples: Float32Array) => void;
    readonly #onBands: ((bands: number[]) => void) | undefined;
    #bands: number[] = Array(SPEECH_SPECTRUM_BAND_COUNT).fill(0);
    #context: AudioContext | null = null;
    #source: MediaStreamAudioSourceNode | null = null;
    #tap: AudioWorkletNode | null = null;
    #stopped = false;
    #flushed: (() => void) | null = null;

    constructor(onSamples: (samples: Float32Array) => void, onBands?: (bands: number[]) => void) {
        this.#onSamples = onSamples;
        this.#onBands = onBands;
    }

    async start(stream: MediaStream): Promise<void> {
        const context = new AudioContext({ sampleRate: SPEECH_SAMPLE_RATE });
        this.#context = context;
        await context.audioWorklet.addModule(WORKLET_URL.href);
        if (this.#stopped) {
            this.stop();
            return;
        }
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0;
        const spectrum = new Float32Array(analyser.frequencyBinCount);
        const tap = new AudioWorkletNode(context, 'speech-tap');
        tap.port.onmessage = (event: MessageEvent<Float32Array | string>) => {
            if (event.data === 'flushed') {
                this.#flushed?.();
                this.#flushed = null;
                return;
            }
            if (!(event.data instanceof Float32Array) || this.#stopped) {
                return;
            }
            if (this.#onBands) {
                analyser.getFloatFrequencyData(spectrum);
                this.#bands = easeBands(this.#bands, spectrumBands(spectrum, context.sampleRate));
                this.#onBands([...this.#bands]);
            }
            this.#onSamples(event.data);
        };
        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.connect(tap);
        // A worklet with nothing downstream is not pulled, and the destination would echo the
        // microphone back into the room. A gain of zero keeps the graph running and silent.
        const silence = context.createGain();
        silence.gain.value = 0;
        tap.connect(silence);
        silence.connect(context.destination);
        this.#source = source;
        this.#tap = tap;
        await context.resume();
    }

    async finish(): Promise<void> {
        if (!this.#tap || this.#stopped) {
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                this.#flushed = null;
                reject(new Error('Microphone did not finish'));
            }, 2000);
            this.#flushed = () => {
                window.clearTimeout(timeout);
                resolve();
            };
            this.#tap!.port.postMessage('flush');
        });
    }

    stop(): void {
        this.#stopped = true;
        this.#flushed?.();
        this.#flushed = null;
        this.#tap?.port.close();
        this.#tap?.disconnect();
        this.#source?.disconnect();
        void this.#context?.close();
        this.#context = null;
        this.#source = null;
        this.#tap = null;
    }
}
